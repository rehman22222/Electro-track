const crypto = require("crypto");

const DEFAULT_EMAIL_PROVIDER_ORDER = ["smtp", "gmail-api", "sendgrid", "resend", "brevo", "brevo-smtp"];
const SUPPORTED_EMAIL_PROVIDERS = new Set(DEFAULT_EMAIL_PROVIDER_ORDER);
const FALLBACK_ENABLED_VALUES = new Set(["1", "true", "yes"]);

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

function maskEmailAddress(value) {
  const [localPart, domain] = String(value || "").split("@");
  if (!localPart || !domain) return null;

  return `${localPart.slice(0, 2)}***@${domain}`;
}

function getEmailConfig() {
  const requiredProvider = getRequiredEmailProvider();
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = String(process.env.SMTP_PASS || "").replace(/\s+/g, "");
  const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const smtpDisabled =
    String(process.env.EMAIL_DISABLE_SMTP || "false").toLowerCase() === "true" && requiredProvider !== "smtp";
  const allowProviderFallbacks = FALLBACK_ENABLED_VALUES.has(
    String(process.env.EMAIL_ALLOW_PROVIDER_FALLBACKS || "").toLowerCase()
  );
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  const sendgridApiKey = String(process.env.SENDGRID_API_KEY || "").trim();
  const brevoApiKey = String(process.env.BREVO_API_KEY || "").trim();
  const brevoSmtpLogin = String(process.env.BREVO_SMTP_LOGIN || "").trim();
  const brevoSmtpKey = String(process.env.BREVO_SMTP_KEY || "").replace(/\s+/g, "");
  const brevoSmtpPort = Number(process.env.BREVO_SMTP_PORT || 2525);
  const gmailClientId = String(process.env.GMAIL_CLIENT_ID || "").trim();
  const gmailClientSecret = String(process.env.GMAIL_CLIENT_SECRET || "").trim();
  const gmailRefreshToken = String(process.env.GMAIL_REFRESH_TOKEN || "").trim();
  const fromEmail = process.env.SMTP_FROM_EMAIL || smtpUser || "no-reply@powertrack.local";
  const gmailFromEmail = process.env.GMAIL_FROM_EMAIL || fromEmail;
  const resendFromEmail = process.env.RESEND_FROM_EMAIL || fromEmail;
  const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL || fromEmail;
  const brevoFromEmail = process.env.BREVO_FROM_EMAIL || fromEmail;
  const fromName = process.env.SMTP_FROM_NAME || "PowerTrack";

  return {
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpSecure,
    smtpDisabled,
    resendApiKey,
    sendgridApiKey,
    brevoApiKey,
    brevoSmtpLogin,
    brevoSmtpKey,
    brevoSmtpPort,
    gmailClientId,
    gmailClientSecret,
    gmailRefreshToken,
    fromEmail,
    gmailFromEmail,
    resendFromEmail,
    sendgridFromEmail,
    brevoFromEmail,
    fromName,
    requiredProvider,
    allowProviderFallbacks,
    providerOrder: getEmailProviderOrder(),
  };
}

function getRequiredEmailProvider() {
  const provider = String(process.env.EMAIL_REQUIRED_PROVIDER || process.env.EMAIL_PRIMARY_PROVIDER || "")
    .trim()
    .toLowerCase();

  return SUPPORTED_EMAIL_PROVIDERS.has(provider) ? provider : null;
}

function getEmailProviderOrder() {
  const configured = String(process.env.EMAIL_PROVIDER_ORDER || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!configured.length) {
    return DEFAULT_EMAIL_PROVIDER_ORDER;
  }

  const seen = new Set();
  const providerOrder = configured.filter((provider) => {
    if (!SUPPORTED_EMAIL_PROVIDERS.has(provider) || seen.has(provider)) {
      return false;
    }

    seen.add(provider);
    return true;
  });

  return providerOrder.length ? providerOrder : DEFAULT_EMAIL_PROVIDER_ORDER;
}

function hasSmtpConfig(config) {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
}

function hasBrevoSmtpConfig(config) {
  return Boolean(config.brevoSmtpLogin && config.brevoSmtpKey);
}

function hasGmailApiConfig(config) {
  return Boolean(config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken && config.gmailFromEmail);
}

function canUseEmailProvider(provider, config) {
  switch (provider) {
    case "gmail-api":
      return hasGmailApiConfig(config);
    case "smtp":
      return hasSmtpConfig(config) && !config.smtpDisabled;
    case "sendgrid":
      return Boolean(config.sendgridApiKey);
    case "resend":
      return Boolean(config.resendApiKey);
    case "brevo":
      return Boolean(config.brevoApiKey);
    case "brevo-smtp":
      return hasBrevoSmtpConfig(config);
    default:
      return false;
  }
}

function getProviderLogName(provider) {
  return {
    "gmail-api": "Gmail API",
    smtp: "SMTP",
    sendgrid: "SendGrid",
    resend: "Resend",
    brevo: "Brevo",
    "brevo-smtp": "Brevo SMTP",
  }[provider] || provider;
}

function getMissingProviderConfigMessage(provider) {
  switch (provider) {
    case "smtp":
      return "SMTP is required for OTP email, but SMTP_HOST, SMTP_USER, or SMTP_PASS is missing.";
    case "gmail-api":
      return "Gmail API is required for OTP email, but GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, or GMAIL_FROM_EMAIL is missing.";
    case "sendgrid":
      return "SendGrid is required for OTP email, but SENDGRID_API_KEY is missing.";
    case "resend":
      return "Resend is required for OTP email, but RESEND_API_KEY is missing.";
    case "brevo":
      return "Brevo API is required for OTP email, but BREVO_API_KEY is missing.";
    case "brevo-smtp":
      return "Brevo SMTP is required for OTP email, but BREVO_SMTP_LOGIN or BREVO_SMTP_KEY is missing.";
    default:
      return "Required email provider is not configured.";
  }
}

function getEmailDiagnostics() {
  const config = getEmailConfig();

  return {
    requiredProvider: config.requiredProvider,
    allowProviderFallbacks: config.allowProviderFallbacks,
    providerOrder: config.providerOrder,
    providers: Object.fromEntries(
      DEFAULT_EMAIL_PROVIDER_ORDER.map((provider) => [provider, canUseEmailProvider(provider, config)])
    ),
    smtp: {
      configured: hasSmtpConfig(config),
      disabled: config.smtpDisabled,
      host: config.smtpHost || null,
      port: config.smtpPort,
      secure: config.smtpSecure,
      user: maskEmailAddress(config.smtpUser),
      fromEmail: maskEmailAddress(config.fromEmail),
    },
  };
}

async function sendWithEmailProvider(provider, config, message) {
  switch (provider) {
    case "gmail-api":
      return sendWithGmailApi(config, message);
    case "smtp":
      return sendWithSmtp(config, message);
    case "sendgrid":
      return sendWithSendGrid(config, message);
    case "resend":
      return sendWithResend(config, message);
    case "brevo":
      return sendWithBrevo(config, message);
    case "brevo-smtp":
      return sendWithBrevoSmtp(config, message);
    default:
      throw new Error(`Unsupported email provider: ${provider}`);
  }
}

function getPublicEmailError(details = []) {
  const providerDetails = details.length ? ` Details: ${details.join(" | ")}` : "";

  if (process.env.NODE_ENV === "production") {
    return "Could not send the verification email right now. Please try again later.";
  }

  return `Could not send the verification email.${providerDetails}`;
}

async function readProviderResponse(response) {
  const rawBody = await response.text();
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    return { rawBody };
  }
}

function assertSmtpAccepted(info, provider) {
  const accepted = Array.isArray(info.accepted) ? info.accepted : [];
  const rejected = Array.isArray(info.rejected) ? info.rejected : [];

  if (!accepted.length || rejected.length) {
    throw new Error(
      `${provider} did not accept all recipients. accepted=${accepted.join(",") || "none"} rejected=${rejected.join(",") || "none"}`
    );
  }
}

function encodeMimeHeader(value) {
  return String(value || "").replace(/[\r\n]/g, " ").trim();
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createMimeMessage({ fromName, fromEmail, to, subject, text, html }) {
  const boundary = `powertrack-${crypto.randomBytes(12).toString("hex")}`;
  const entityRefId = `powertrack-${crypto.randomBytes(16).toString("hex")}`;
  const fromLabel = encodeMimeHeader(fromName);
  const cleanFromEmail = encodeMimeHeader(fromEmail);
  const cleanTo = encodeMimeHeader(to);
  const cleanSubject = encodeMimeHeader(subject);

  return [
    `From: ${fromLabel ? `"${fromLabel}" ` : ""}<${cleanFromEmail}>`,
    `To: ${cleanTo}`,
    `Subject: ${cleanSubject}`,
    `Reply-To: ${cleanFromEmail}`,
    `X-Entity-Ref-ID: ${entityRefId}`,
    "X-Auto-Response-Suppress: All",
    "X-Priority: 1",
    "Importance: high",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function createEmailHeaders() {
  return {
    "X-Entity-Ref-ID": `powertrack-${crypto.randomBytes(16).toString("hex")}`,
    "X-Auto-Response-Suppress": "All",
    "X-Priority": "1",
    Importance: "high",
  };
}

async function getGmailAccessToken(config) {
  const fetch = require("node-fetch");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.gmailClientId,
      client_secret: config.gmailClientSecret,
      refresh_token: config.gmailRefreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const data = await readProviderResponse(response);
  if (!response.ok || !data.access_token) {
    throw new Error(`Gmail token refresh failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function sendWithGmailApi(config, message) {
  const fetch = require("node-fetch");
  const accessToken = await getGmailAccessToken(config);
  const raw = encodeBase64Url(
    createMimeMessage({
      fromName: config.fromName,
      fromEmail: config.gmailFromEmail,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  );

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  const data = await readProviderResponse(response);
  if (!response.ok) {
    throw new Error(`Gmail API email failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return {
    delivered: true,
    preview: false,
    provider: "gmail-api",
    providerMessageId: data.id,
    threadId: data.threadId,
  };
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
      reply_to: config.resendFromEmail,
      headers: message.headers,
    }),
  });

  if (!response.ok) {
    const errorBody = await readProviderResponse(response);
    throw new Error(`Resend email failed (${response.status}): ${JSON.stringify(errorBody)}`);
  }

  const data = await readProviderResponse(response);
  return {
    delivered: true,
    preview: false,
    provider: "resend",
    providerMessageId: data.id,
  };
}

async function sendWithSendGrid(config, message) {
  const fetch = require("node-fetch");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.sendgridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: message.to }],
          headers: message.headers,
        },
      ],
      from: {
        email: config.sendgridFromEmail,
        name: config.fromName,
      },
      reply_to: {
        email: config.sendgridFromEmail,
        name: config.fromName,
      },
      subject: message.subject,
      content: [
        {
          type: "text/plain",
          value: message.text,
        },
        {
          type: "text/html",
          value: message.html,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await readProviderResponse(response);
    throw new Error(`SendGrid email failed (${response.status}): ${JSON.stringify(errorBody)}`);
  }

  return {
    delivered: true,
    preview: false,
    provider: "sendgrid",
    providerMessageId: response.headers.get("x-message-id") || undefined,
  };
}

async function sendWithBrevo(config, message) {
  const fetch = require("node-fetch");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.brevoApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: config.brevoFromEmail,
        name: config.fromName,
      },
      replyTo: {
        email: config.brevoFromEmail,
        name: config.fromName,
      },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      headers: message.headers,
    }),
  });

  if (!response.ok) {
    const errorBody = await readProviderResponse(response);
    throw new Error(`Brevo email failed (${response.status}): ${JSON.stringify(errorBody)}`);
  }

  const data = await readProviderResponse(response);
  return {
    delivered: true,
    preview: false,
    provider: "brevo",
    providerMessageId: data.messageId,
  };
}

async function sendWithBrevoSmtp(config, message) {
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (error) {
    throw new Error("nodemailer is not installed.");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: config.brevoSmtpPort,
    secure: false,
    requireTLS: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: config.brevoSmtpLogin,
      pass: config.brevoSmtpKey,
    },
  });

  const info = await transporter.sendMail({
    from: `"${config.fromName}" <${config.brevoFromEmail}>`,
    replyTo: config.brevoFromEmail,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    priority: "high",
  });
  assertSmtpAccepted(info, "Brevo SMTP");

  return {
    delivered: true,
    preview: false,
    provider: "brevo-smtp",
    providerMessageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
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

  const info = await transporter.sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    replyTo: config.fromEmail,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    priority: "high",
    envelope: {
      from: config.fromEmail,
      to: [message.to],
    },
  });
  assertSmtpAccepted(info, "SMTP");

  return {
    delivered: true,
    preview: false,
    provider: "smtp",
    providerMessageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
  };
}

async function sendEmailMessage(message) {
  const config = getEmailConfig();
  const failures = [];
  let attemptedProvider = false;
  const providerOrder = config.requiredProvider
    ? [config.requiredProvider, ...config.providerOrder.filter((provider) => provider !== config.requiredProvider)]
    : config.providerOrder;

  if (config.requiredProvider && !canUseEmailProvider(config.requiredProvider, config)) {
    failures.push(getMissingProviderConfigMessage(config.requiredProvider));
    throw new EmailDeliveryError(getPublicEmailError(failures), failures);
  }

  for (const provider of providerOrder) {
    if (!canUseEmailProvider(provider, config)) {
      continue;
    }

    attemptedProvider = true;
    try {
      return await sendWithEmailProvider(provider, config, message);
    } catch (error) {
      failures.push(error.message);
      console.error(`${getProviderLogName(provider)} email failed for ${message.to}: ${error.message}`);

      if (config.requiredProvider === provider && !config.allowProviderFallbacks) {
        throw new EmailDeliveryError(getPublicEmailError(failures), failures);
      }
    }
  }

  if (!attemptedProvider) {
    if (process.env.NODE_ENV === "production") {
      failures.push("Email is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS; or GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN; or SENDGRID_API_KEY, BREVO_API_KEY, BREVO_SMTP_LOGIN and BREVO_SMTP_KEY, or RESEND_API_KEY.");
      throw new EmailDeliveryError(getPublicEmailError(failures), failures);
    }

    console.log(`[DEV EMAIL] ${message.subject} for ${message.to}`);
    return {
      delivered: false,
      preview: true,
      devOtpPreview: message.devOtpPreview,
    };
  }

  throw new EmailDeliveryError(getPublicEmailError(failures), failures);
}

async function sendVerificationOtpEmail({ to, name, otp }) {
  const subject = `${otp} is your PowerTrack verification code`;
  const text = [
    `Your PowerTrack verification code is ${otp}.`,
    "It expires in 10 minutes.",
    "If you did not request this account, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
        Your PowerTrack verification code is ${otp}. It expires in 10 minutes.
      </div>
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

  return sendEmailMessage({
    to,
    subject,
    html,
    text,
    headers: createEmailHeaders(),
    devOtpPreview: process.env.NODE_ENV === "production" ? undefined : otp,
  });
}

async function sendEmailDeliveryTest({ to }) {
  const subject = "PowerTrack email delivery test";
  const text = "This is a PowerTrack email delivery test. If you received it, transactional email delivery is working.";
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin-bottom: 8px;">PowerTrack email delivery test</h2>
      <p>This message confirms that transactional email delivery is working.</p>
      <p>No action is required.</p>
    </div>
  `;

  return sendEmailMessage({ to, subject, html, text, headers: createEmailHeaders() });
}

module.exports = {
  EmailDeliveryError,
  createOtpCode,
  getEmailDiagnostics,
  hashOtp,
  sendEmailDeliveryTest,
  sendVerificationOtpEmail,
};
