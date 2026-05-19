const crypto = require("crypto");

class EmailDeliveryError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "EmailDeliveryError";
    this.status = 503;
    this.details = details;
  }
}

function createOtpCode() {
  return `${crypto.randomInt(0, 1000000)}`.padStart(6, "0");
}

function hashOtp(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function getEmailConfig() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = String(process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  const fromEmail = process.env.SMTP_FROM_EMAIL || smtpUser || "no-reply@powertrack.local";
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || fromEmail;
  const fromName = process.env.SMTP_FROM_NAME || "PowerTrack";

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpSecure,
    resendApiKey,
    fromEmail,
    resendFromEmail,
    fromName,
  };
}

function hasSmtpConfig(config) {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function getPublicEmailError(details = []) {
  const providerDetails = details.length ? ` Details: ${details.join(" | ")}` : "";

  if (process.env.NODE_ENV === "production") {
    return "Could not send the verification email right now. Please try again later.";
  }

  return `Could not send the verification email.${providerDetails}`;
}

async function sendWithResend(config, message) {
  const fetch = require("node-fetch");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "loadshedding-tracker/1.0",
    },
    body: JSON.stringify({
      from: `"${config.fromName}" <${config.resendFromEmail}>`,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend email failed (${response.status}): ${errorBody}`);
  }

  return {
    delivered: true,
    preview: false,
    provider: "resend",
  };
}

async function sendWithSmtp(config, message) {
  let nodemailer;
  try {
    // Lazy require keeps local development working even if the package is not installed yet.
    nodemailer = require("nodemailer");
  } catch (error) {
    throw new Error("nodemailer is not installed.");
  }

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: !config.smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  return {
    delivered: true,
    preview: false,
    provider: "smtp",
  };
}

async function sendVerificationOtpEmail({ to, name, otp }) {
  const config = getEmailConfig();

  const subject = "Your PowerTrack verification code";
  const text = `Your PowerTrack verification code is ${otp}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin-bottom: 8px;">Verify your email</h2>
      <p>Hello ${name || "there"},</p>
      <p>Use the verification code below to finish creating your PowerTrack account:</p>
      <div style="margin: 24px 0; display: inline-block; font-size: 28px; letter-spacing: 8px; font-weight: 700; background: #f3f4f6; padding: 14px 18px; border-radius: 10px;">
        ${otp}
      </div>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not request this account, you can ignore this email.</p>
    </div>
  `;
  const message = { to, subject, html, text };
  const failures = [];

  if (hasSmtpConfig(config)) {
    try {
      return await sendWithSmtp(config, message);
    } catch (error) {
      failures.push(error.message);
      console.error(`SMTP verification email failed for ${to}: ${error.message}`);
    }
  }

  if (config.resendApiKey) {
    try {
      return await sendWithResend(config, message);
    } catch (error) {
      failures.push(error.message);
      console.error(`Resend verification email failed for ${to}: ${error.message}`);
    }
  }

  if (!config.resendApiKey && !hasSmtpConfig(config)) {
    if (process.env.NODE_ENV === "production") {
      failures.push("Email is not configured. Set RESEND_API_KEY or SMTP_HOST, SMTP_USER, and SMTP_PASS.");
      throw new EmailDeliveryError(getPublicEmailError(failures), failures);
    }

    console.log(`[DEV OTP] Verification code for ${to}: ${otp}`);
    return {
      delivered: false,
      preview: true,
      devOtpPreview: process.env.NODE_ENV === "production" ? undefined : otp,
    };
  }

  throw new EmailDeliveryError(getPublicEmailError(failures), failures);
}

module.exports = {
  EmailDeliveryError,
  createOtpCode,
  hashOtp,
  sendVerificationOtpEmail,
};
