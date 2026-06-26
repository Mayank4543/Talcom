import nodemailer from "nodemailer";
const PHONEXA_CONFIG = {
  apiId:       process.env.PHONEXA_API_ID       || "",
  apiPassword: process.env.PHONEXA_API_PASSWORD || "",
  productId:   process.env.PHONEXA_PRODUCT_ID   || "191",
  price:       process.env.PHONEXA_PRICE        || "0.01",
};

function digitsOnly(value) {
  return (value || "").toString().replace(/\D/g, "");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return res.status(500).json({ error: "Missing EMAIL_USER or EMAIL_PASS env vars" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ── Required-field validation per Phonexa Lab 115 – Talcum spec ──
    const phoneNumber = digitsOnly(data?.phoneNumber);
    const requiredErrors = {};

    if (!data?.firstName)      requiredErrors.firstName      = "required";
    if (!data?.lastName)       requiredErrors.lastName       = "required";
    if (!data?.email)          requiredErrors.email          = "required";
    if (!data?.trustedFormURL) requiredErrors.trustedFormURL = "required";
    if (!(phoneNumber.length === 10 || phoneNumber.length === 11)) {
      requiredErrors.phoneNumber = "required, must be 10–11 digits";
    }
    if (!PHONEXA_CONFIG.apiId || !PHONEXA_CONFIG.apiPassword) {
      requiredErrors.credentials =
        "missing server credentials (PHONEXA_API_ID / PHONEXA_API_PASSWORD env vars)";
    }

    if (Object.keys(requiredErrors).length) {
      return res.status(400).json({ status: 4, errors: [requiredErrors] });
    }

    // ── Optional field helpers ─────────────────────────────────────
    const userIp = data?.userIp || getClientIp(req);
    const state  = (data?.state || "").toUpperCase(); // spec: two capital letters

    // Full payload mapped to Phonexa field names.
    // Switch the comment block below to POST directly instead of emailing.
    const phonexaLead = {
      apiId:          PHONEXA_CONFIG.apiId,
      apiPassword:    PHONEXA_CONFIG.apiPassword,
      productId:      PHONEXA_CONFIG.productId,
      price:          PHONEXA_CONFIG.price,
      // Required
      phoneNumber,
      firstName:      data.firstName,
      lastName:       data.lastName,
      email:          data.email,
      trustedFormURL: data.trustedFormURL,
      // Optional – address
      zip:            data.zip     || "",
      state,
      city:           data.city    || "",
      address:        data.address || "",
      // Optional – userIp (auto-detected server-side if not provided)
      userIp,
    };

    // ── Email body – all fields included ──────────────────────────
    const or = (v) => v || "—";

    const message = `
New Talc Lead (Phonexa Lab 115 – Talcum spec)

━━━ REQUIRED FIELDS ━━━━━━━━━━━━━━━━━━━━━━━━━━━
First Name:        ${or(phonexaLead.firstName)}
Last Name:         ${or(phonexaLead.lastName)}
Phone Number:      ${or(phonexaLead.phoneNumber)}
Email:             ${or(phonexaLead.email)}
Trusted Form URL:  ${or(phonexaLead.trustedFormURL)}

━━━ OPTIONAL – ADDRESS ━━━━━━━━━━━━━━━━━━━━━━━━
Zip:               ${or(phonexaLead.zip)}
State:             ${or(phonexaLead.state)}
City:              ${or(phonexaLead.city)}
Address:           ${or(phonexaLead.address)}

━━━ OPTIONAL – TRACKING ━━━━━━━━━━━━━━━━━━━━━━━
User IP:           ${or(phonexaLead.userIp)}


API ID:            ${phonexaLead.apiId}
Product ID:        ${phonexaLead.productId}
Price:             ${phonexaLead.price}

https://leads-inst603-client.phonexa.com/lead/
`.trim();

    // ── Send email ────────────────────────────────────────────────
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from:    process.env.EMAIL_USER,
      to:      process.env.LEAD_RECEIVER_EMAIL || "mailtoakash@gmail.com",
      subject: `New Talc Lead – ${phonexaLead.firstName} ${phonexaLead.lastName}`.trim(),
      text:    message,
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("send-email handler error:", error);
    return res.status(500).json({ error: "Email failed" });
  }
}