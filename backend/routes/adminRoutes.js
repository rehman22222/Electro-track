const express = require("express");

const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const adminController = require("../controllers/adminController");
const { EmailDeliveryError, getEmailDiagnostics, sendEmailDeliveryTest } = require("../utils/emailOtp");

const router = express.Router();
const EMAIL_TEST_PROVIDERS = new Set(["gmail-api", "resend", "sendgrid", "brevo", "smtp", "brevo-smtp"]);

router.use(auth, requireRole("admin"));

router.get("/analytics", adminController.getAnalytics);

router.get("/email-status", (req, res) => {
  return res.json(getEmailDiagnostics());
});

router.post("/email-test", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const provider = String(req.body?.provider || "").trim().toLowerCase() || undefined;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: "A valid email is required" });
  }

  if (provider && !EMAIL_TEST_PROVIDERS.has(provider)) {
    return res.status(400).json({ message: "Unsupported email provider" });
  }

  try {
    const result = await sendEmailDeliveryTest({ to: email, provider });

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
