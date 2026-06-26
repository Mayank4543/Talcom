import nodemailer from "nodemailer";

const PHONEXA_CONFIG = {
  apiId: process.env.PHONEXA_API_ID || "",
  apiPassword: process.env.PHONEXA_API_PASSWORD || "",
  productId: process.env.PHONEXA_PRODUCT_ID || "191",
  price: process.env.PHONEXA_PRICE || "0.01",
};

function digitsOnly(value) {
  return (value || "").toString().replace(/\D/g, "");
}

function buildTParString(tPar) {
  if (!tPar || typeof tPar !== "object") return "";
  return Object.entries(tPar)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `tPar[${k}]=${encodeURIComponent(v)}`)
    .join("&");
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

    // --- Required fields per Phonexa Lab 115 - Talcum spec ---
    const phoneNumber = digitsOnly(data?.phoneNumber);
    const requiredErrors = {};
    if (!data?.firstName) requiredErrors.firstName = "required";
    if (!data?.lastName) requiredErrors.lastName = "required";
    if (!data?.email) requiredErrors.email = "required";
    if (!data?.trustedFormURL) requiredErrors.trustedFormURL = "required";
    if (!(phoneNumber.length === 10 || phoneNumber.length === 11)) {
      requiredErrors.phoneNumber = "required, must be 10-11 digits";
    }
    if (!PHONEXA_CONFIG.apiId || !PHONEXA_CONFIG.apiPassword) {
      requiredErrors.apiId = "missing server credentials (PHONEXA_API_ID / PHONEXA_API_PASSWORD env vars)";
    }

    if (Object.keys(requiredErrors).length) {
      return res.status(400).json({ status: 4, errors: [requiredErrors] });
    }

    const userIp = data?.userIp || getClientIp(req);
    const tParString = buildTParString(data?.tPar);

    // Full lead, mapped exactly to Phonexa field names, ready to be
    // posted to https://leads-inst603-client.phonexa.com/lead/ if/when
    // you switch from email delivery to a direct server-side API call.
    const phonexaLead = {
      apiId: PHONEXA_CONFIG.apiId,
      apiPassword: PHONEXA_CONFIG.apiPassword,
      productId: PHONEXA_CONFIG.productId,
      price: PHONEXA_CONFIG.price,
      phoneNumber,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      trustedFormURL: data.trustedFormURL,
      zip: data.zip || "",
      state: data.state || "",
      city: data.city || "",
      address: data.address || "",

      userIp,
      testMode: data.testMode === "1" ? "1" : "",

    };

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const message = `
New Talc Lead (Phonexa Lab 115 spec)

REQUIRED FIELDS
First Name: ${phonexaLead.firstName}
Last Name: ${phonexaLead.lastName}
Phone Number: ${phonexaLead.phoneNumber}
Email: ${phonexaLead.email}
Trusted Form URL: ${phonexaLead.trustedFormURL}



User IP: ${phonexaLead.userIp || "N/A"}
Test Mode: ${phonexaLead.testMode || "0"}



ACCOUNT (for reference if posting to Phonexa manually)
productId: ${phonexaLead.productId}
price: ${phonexaLead.price}
`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEAD_RECEIVER_EMAIL || "mailtoakash@gmail.com",
      subject: `New Talc Lead - ${phonexaLead.firstName} ${phonexaLead.lastName}`.trim(),
      text: message,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Email failed" });
  }
}