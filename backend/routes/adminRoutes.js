const express = require("express");

const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const adminController = require("../controllers/adminController");
const { EmailDeliveryError, sendEmailDeliveryTest } = require("../utils/emailOtp");

const router = express.Router();

router.use(auth, requireRole("admin"));

router.get("/analytics", adminController.getAnalytics);

router.post("/email-test", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "A valid email is required" });
  }

  try {
    const result = await sendEmailDeliveryTest({ to: email });

    return res.json({
      message: "Email provider accepted the test message",
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      accepted: result.accepted,
      rejected: result.rejected,
      response: result.response,
    });
  } catch (err) {
    if (err instanceof EmailDeliveryError || err.name === "EmailDeliveryError") {
      return res.status(err.status || 503).json({
        message: err.message,
        details: err.details,
      });
    }

    return res.status(500).json({ message: "Email test failed", error: err.message });
  }
});

module.exports = router;
