const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const router = express.Router();

const auth = require("../middleware/auth");
const User = require("../models/User");
const Area = require("../models/Area");
const Outage = require("../models/Outage");
const { EmailDeliveryError, createOtpCode, hashOtp, sendVerificationOtpEmail } = require("../utils/emailOtp");

const PREMIUM_ROLES = new Set(["premium", "admin"]);

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function serializeArea(area) {
  if (!area) return null;

  return {
    _id: String(area._id || area.id),
    name: area.name,
    city: area.city || "Karachi",
  };
}

function serializeUser(user) {
  const area = user.areaId && typeof user.areaId === "object" && user.areaId.name ? user.areaId : null;
  const watchedAreas = Array.isArray(user.watchedAreaIds)
    ? user.watchedAreaIds
        .map((item) => (item && typeof item === "object" && item.name ? serializeArea(item) : null))
        .filter(Boolean)
    : [];

  const watchedAreaIds = watchedAreas.length
    ? watchedAreas.map((item) => item._id)
    : Array.isArray(user.watchedAreaIds)
      ? user.watchedAreaIds.map((item) => String(item))
      : [];

  return {
    id: String(user._id || user.id),
    username: user.username,
    email: user.email,
    phoneNumber: user.phoneNumber || "",
    role: user.role,
    emailVerified: user.emailVerified !== false,
    emailVerifiedAt: user.emailVerifiedAt || null,
    areaId: area ? area._id : user.areaId ? String(user.areaId) : null,
    area,
    watchedAreaIds,
    watchedAreas,
    areaSelectedAt: user.areaSelectedAt || null,
    lastAreaChangeAt: user.lastAreaChangeAt || null,
    alertPreferences: user.alertPreferences || {
      enabled: false,
      minutesBefore: 15,
      browserPermission: "default",
    },
    location: user.location || null,
    canManageMultipleAreas: PREMIUM_ROLES.has(user.role),
    freeAreaLocked: user.role === "free" && Boolean(user.areaId),
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function isValidPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  return /^\+?\d{10,15}$/.test(normalized);
}

async function persistAndSendVerificationOtp(user) {
  const otp = createOtpCode();
  user.emailVerificationOtpHash = hashOtp(otp);
  user.emailVerificationOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  user.emailVerificationOtpSentAt = new Date();
  await user.save();

  return sendVerificationOtpEmail({
    to: user.email,
    name: user.username,
    otp,
  });
}

function handleAuthRouteError(res, err) {
  if (err instanceof EmailDeliveryError || err.name === "EmailDeliveryError") {
    return res.status(err.status || 503).json({ message: err.message });
  }

  return res.status(500).json({ message: "Server error", error: err.message });
}

function comparableName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function loadUserForResponse(userId) {
  return User.findById(userId)
    .select("-password")
    .populate("areaId", "name city")
    .populate("watchedAreaIds", "name city");
}

async function resolveCanonicalAreaId(areaId) {
  if (!mongoose.isValidObjectId(areaId)) {
    return areaId;
  }

  const selectedArea = await Area.findById(areaId).lean();
  if (!selectedArea) {
    return areaId;
  }

  const siblingAreas = await Area.find({ city: selectedArea.city }).select("_id name city").lean();
  const targetKey = comparableName(selectedArea.name);
  const candidates = siblingAreas.filter((area) => comparableName(area.name) === targetKey);

  if (candidates.length <= 1) {
    return areaId;
  }

  const outageCounts = await Outage.aggregate([
    { $match: { areaId: { $in: candidates.map((area) => area._id) } } },
    { $group: { _id: "$areaId", count: { $sum: 1 } } },
  ]);

  const countMap = new Map(outageCounts.map((item) => [String(item._id), item.count]));
  const canonical = candidates.sort((a, b) => {
    const aCount = countMap.get(String(a._id)) || 0;
    const bCount = countMap.get(String(b._id)) || 0;
    if (bCount !== aCount) {
      return bCount - aCount;
    }
    return a.name.length - b.name.length;
  })[0];

  return canonical?._id || areaId;
}

function ensurePremiumAccess(user) {
  return PREMIUM_ROLES.has(user.role);
}

function normalizeAlertPreferences(payload = {}) {
  return {
    enabled: Boolean(payload.enabled),
    minutesBefore: Number.isFinite(Number(payload.minutesBefore))
      ? Math.min(120, Math.max(5, Number(payload.minutesBefore)))
      : 15,
    browserPermission: ["default", "granted", "denied"].includes(payload.browserPermission)
      ? payload.browserPermission
      : "default",
  };
}

router.post("/register", async (req, res) => {
  try {
    const { username, name, email, phoneNumber, password } = req.body;
    const finalUsername = (username || name || "").trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!finalUsername || !normalizedEmail || !normalizedPhoneNumber || !password) {
      return res.status(400).json({ message: "name, email, phone number and password are required" });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    if (!isValidPhoneNumber(normalizedPhoneNumber)) {
      return res.status(400).json({ message: "Please enter a valid phone number" });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters long" });
    }

    let user = await User.findOne({ email: normalizedEmail });
    const hashedPassword = await bcrypt.hash(password, 10);

    if (user && user.emailVerified !== false) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    if (!user) {
      user = await User.create({
        username: finalUsername,
        email: normalizedEmail,
        phoneNumber: normalizedPhoneNumber,
        password: hashedPassword,
        emailVerified: false,
        emailVerifiedAt: null,
        role: "free",
        watchedAreaIds: [],
        alertPreferences: {
          enabled: false,
          minutesBefore: 15,
          browserPermission: "default",
        },
      });
    } else {
      user.username = finalUsername;
      user.email = normalizedEmail;
      user.phoneNumber = normalizedPhoneNumber;
      user.password = hashedPassword;
      user.emailVerified = false;
      user.emailVerifiedAt = null;
    }

    const emailDispatch = await persistAndSendVerificationOtp(user);

    return res.status(201).json({
      message: "Verification code sent to your email",
      requiresVerification: true,
      email: user.email,
      ...(emailDispatch.devOtpPreview ? { devOtpPreview: emailDispatch.devOtpPreview } : {}),
    });
  } catch (err) {
    return handleAuthRouteError(res, err);
  }
});

router.post("/verify-email-otp", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: "email and otp are required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.emailVerified !== false) {
      const hydratedUser = await loadUserForResponse(user._id);
      const token = signToken(user._id);
      return res.json({
        message: "Email already verified",
        user: serializeUser(hydratedUser),
        token,
      });
    }

    if (!user.emailVerificationOtpHash || !user.emailVerificationOtpExpiresAt) {
      return res.status(400).json({ message: "No verification code is active for this account" });
    }

    if (user.emailVerificationOtpExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: "Verification code has expired. Request a new code." });
    }

    if (hashOtp(otp) !== user.emailVerificationOtpHash) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationOtpHash = null;
    user.emailVerificationOtpExpiresAt = null;
    user.emailVerificationOtpSentAt = null;
    await user.save();

    const hydratedUser = await loadUserForResponse(user._id);
    const token = signToken(user._id);

    return res.json({
      message: "Email verified successfully",
      user: serializeUser(hydratedUser),
      token,
    });
  } catch (err) {
    return handleAuthRouteError(res, err);
  }
});

router.post("/resend-email-otp", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail) {
      return res.status(400).json({ message: "email is required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.emailVerified !== false) {
      return res.status(400).json({ message: "This email is already verified" });
    }

    if (user.emailVerificationOtpSentAt && Date.now() - user.emailVerificationOtpSentAt.getTime() < 60 * 1000) {
      return res.status(429).json({ message: "Please wait a minute before requesting a new code" });
    }

    const emailDispatch = await persistAndSendVerificationOtp(user);

    return res.json({
      message: "A new verification code has been sent",
      ...(emailDispatch.devOtpPreview ? { devOtpPreview: emailDispatch.devOtpPreview } : {}),
    });
  } catch (err) {
    return handleAuthRouteError(res, err);
  }
});

router.post("/login", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: "email and password are required" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.emailVerified === false) {
      return res.status(403).json({
        message: "Please verify your email with the OTP code before signing in",
        requiresVerification: true,
        email: user.email,
      });
    }

    const hydratedUser = await loadUserForResponse(user._id);
    const token = signToken(user._id);

    return res.json({
      message: "Login successful",
      user: serializeUser(hydratedUser),
      token,
    });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.get("/profile", auth, async (req, res) => {
  try {
    const user = await loadUserForResponse(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: serializeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const user = await loadUserForResponse(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: serializeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.put("/profile", auth, async (req, res) => {
  try {
    const { username, email, phoneNumber, password } = req.body;
    const updateFields = {};

    if (username) updateFields.username = username;
    if (email) updateFields.email = normalizeEmail(email);
    if (phoneNumber) {
      const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
      if (!isValidPhoneNumber(normalizedPhoneNumber)) {
        return res.status(400).json({ message: "Please enter a valid phone number" });
      }
      updateFields.phoneNumber = normalizedPhoneNumber;
    }
    if (password) {
      updateFields.password = await bcrypt.hash(password, 10);
    }

    const user = await User.findByIdAndUpdate(req.userId, { $set: updateFields }, { new: true })
      .select("-password")
      .populate("areaId", "name city")
      .populate("watchedAreaIds", "name city");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ message: "Profile updated successfully", user: serializeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.put("/update-area", auth, async (req, res) => {
  try {
    const { areaId } = req.body;
    if (!areaId) {
      return res.status(400).json({ msg: "areaId is required" });
    }

    const canonicalAreaId = await resolveCanonicalAreaId(areaId);
    if (!mongoose.isValidObjectId(canonicalAreaId)) {
      return res.status(400).json({ msg: "Invalid area selection" });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const selectedAreaString = String(canonicalAreaId);
    const currentAreaString = user.areaId ? String(user.areaId) : null;

    if (user.role === "free" && currentAreaString && currentAreaString !== selectedAreaString) {
      return res.status(403).json({
        msg: "Free plan users can keep one active area only. Upgrade to premium to change or manage more areas.",
      });
    }

    user.areaId = canonicalAreaId;
    user.areaSelectedAt = user.areaSelectedAt || new Date();
    user.lastAreaChangeAt = new Date();

    if (ensurePremiumAccess(user)) {
      const exists = user.watchedAreaIds.some((item) => String(item) === selectedAreaString);
      if (!exists) {
        user.watchedAreaIds.push(canonicalAreaId);
      }
    }

    await user.save();

    const hydratedUser = await loadUserForResponse(user._id);
    return res.json({ msg: "Area updated successfully", user: serializeUser(hydratedUser) });
  } catch (err) {
    return res.status(500).json({ msg: "Server error", error: err.message });
  }
});

router.put("/preferences", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { alertPreferences, location } = req.body;

    if (alertPreferences) {
      if (alertPreferences.enabled && !ensurePremiumAccess(user)) {
        return res.status(403).json({
          message: "15-minute alert reminders are available for premium users only.",
        });
      }

      user.alertPreferences = normalizeAlertPreferences(alertPreferences);
    }

    if (location && typeof location === "object") {
      user.location = {
        lat: Number(location.lat),
        lng: Number(location.lng),
        city: location.city || user.location?.city || undefined,
      };
    }

    await user.save();

    const hydratedUser = await loadUserForResponse(user._id);
    return res.json({ message: "Preferences updated successfully", user: serializeUser(hydratedUser) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.post("/watch-areas", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!ensurePremiumAccess(user)) {
      return res.status(403).json({
        message: "Multiple watched areas are available on the premium plan.",
      });
    }

    const { areaId } = req.body;
    if (!areaId) {
      return res.status(400).json({ message: "areaId is required" });
    }

    const canonicalAreaId = await resolveCanonicalAreaId(areaId);
    if (!mongoose.isValidObjectId(canonicalAreaId)) {
      return res.status(400).json({ message: "Invalid area selection" });
    }

    const alreadyExists = user.watchedAreaIds.some((item) => String(item) === String(canonicalAreaId));
    if (!alreadyExists) {
      user.watchedAreaIds.push(canonicalAreaId);
      await user.save();
    }

    const hydratedUser = await loadUserForResponse(user._id);
    return res.json({ message: "Watch area added successfully", user: serializeUser(hydratedUser) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

router.delete("/watch-areas/:areaId", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!ensurePremiumAccess(user)) {
      return res.status(403).json({
        message: "Multiple watched areas are available on the premium plan.",
      });
    }

    user.watchedAreaIds = user.watchedAreaIds.filter((item) => String(item) !== String(req.params.areaId));
    await user.save();

    const hydratedUser = await loadUserForResponse(user._id);
    return res.json({ message: "Watch area removed successfully", user: serializeUser(hydratedUser) });
  } catch (err) {
    return res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
