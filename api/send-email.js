import nodemailer from "nodemailer";

const PHONEXA_CONFIG = {
  apiId: process.env.PHONEXA_API_ID || "",
  apiPassword: process.env.PHONEXA_API_PASSWORD || "",
  productId: process.env.PHONEXA_PRODUCT_ID || "191",
  price: process.env.PHONEXA_PRICE || "0.01",
};

const PHONEXA_POST_URL = "https://leads-inst603-client.phonexa.com/lead/";

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
      return res
        .status(500)
        .json({ error: "Missing EMAIL_USER or EMAIL_PASS env vars" });
    }

    const data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const phoneNumber = digitsOnly(data?.phoneNumber);
    const requiredErrors = {};

    if (!data?.firstName) requiredErrors.firstName = "required";
    if (!data?.lastName) requiredErrors.lastName = "required";
    if (!data?.email) requiredErrors.email = "required";
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

    const userIp = data?.userIp || getClientIp(req);
    const state = (data?.state || "").toUpperCase();

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
      state,
      city: data.city || "",
      address: data.address || "",
      userIp,
    };

    // ── POST to Phonexa ──────────────────────────────────────────
    const formBody = new URLSearchParams();
    Object.entries(phonexaLead).forEach(([key, value]) => {
      if (value !== "") formBody.append(key, value);
    });

    let postStatus = "",
      postResponse = "";
    let postRes;
    try {
      postRes = await fetch(PHONEXA_POST_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (compatible; LeadPoster/1.0)",
        },
        body: formBody.toString(),
      });
    } catch (networkErr) {
      console.error("Phonexa POST network error:", networkErr.message);
      return res.status(502).json({
        error: "Network error – could not reach Phonexa endpoint.",
        detail: networkErr.message,
      });
    }

    postResponse = await postRes.text();
    postStatus = `HTTP ${postRes.status} – ${postRes.statusText}`;
    console.log("Phonexa POST result:", postStatus, "|", postResponse);

    if (!postRes.ok) {
      return res.status(502).json({
        error: "Phonexa endpoint rejected.",
        status: postStatus,
        response: postResponse,
      });
    }

    // ── Email ────────────────────────────────────────────────────
    const or = (v) => v || "—";

    const message = `
New Talc Lead (Phonexa Lab 115 – Talcum spec)
Post URL: ${PHONEXA_POST_URL}

━━━ LEAD POST RESULT ━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:            ${postStatus}
Response:          ${postResponse || "—"}

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
    `.trim();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEAD_RECEIVER_EMAIL || "mailtoakash@gmail.com",
      subject:
        `New Talc Lead – ${phonexaLead.firstName} ${phonexaLead.lastName}`.trim(),
      text: message,
    });

    return res.status(200).json({
      success: true,
      leadPostStatus: postStatus,
      leadPostResponse: postResponse,
    });
  } catch (error) {
    console.error("send-email handler error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
