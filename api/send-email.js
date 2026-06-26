import nodemailer from "nodemailer";

const PHONEXA_POST_URL = "https://leads-inst603-client.phonexa.com/lead/";

const PHONEXA_CONFIG = {
  apiId: process.env.PHONEXA_API_ID || "",
  apiPassword: process.env.PHONEXA_API_PASSWORD || "",
  productId: process.env.PHONEXA_PRODUCT_ID || "191",
  price: process.env.PHONEXA_PRICE || "0.01",
};

const ALLOWED_STATES = new Set([
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
]);

function digitsOnly(value) {
  return (value || "").toString().replace(/\D/g, "");
}

function getRealIp(req) {
  const sources = [
    req.headers["x-forwarded-for"],
    req.headers["x-real-ip"],
    req.headers["cf-connecting-ip"],
  ];
  for (const src of sources) {
    if (!src) continue;
    for (const candidate of src.split(",")) {
      const ip = candidate.trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) continue;
      const [a, b] = ip.split(".").map(Number);
      if (a === 10) continue;
      if (a === 127) continue;
      if (a === 172 && b >= 16 && b <= 31) continue;
      if (a === 192 && b === 168) continue;
      return ip;
    }
  }
  return "";
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
    const state = (data?.state || "").toUpperCase();
    const requiredErrors = {};

    if (!data?.firstName) requiredErrors.firstName = "required";
    if (!data?.lastName) requiredErrors.lastName = "required";
    if (!data?.email) requiredErrors.email = "required";
    if (!data?.trustedFormURL) requiredErrors.trustedFormURL = "required";
    if (!(phoneNumber.length === 10 || phoneNumber.length === 11)) {
      requiredErrors.phoneNumber = "required, must be 10–11 digits";
    }
    if (!state || !ALLOWED_STATES.has(state)) {
      requiredErrors.state = "required; must be a valid 2-letter US state";
    }
    if (!PHONEXA_CONFIG.apiId || !PHONEXA_CONFIG.apiPassword) {
      requiredErrors.credentials =
        "missing server credentials (PHONEXA_API_ID / PHONEXA_API_PASSWORD)";
    }

    if (Object.keys(requiredErrors).length) {
      return res.status(400).json({ status: 4, errors: [requiredErrors] });
    }

    const userIp = getRealIp(req);

    // ── Build Phonexa payload ──────────────────────────────────────
    // NOTE: testMode is NOT included — omitting it means live mode
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
      ...(userIp && { userIp }),
      // only include if we got a valid IP
      testMode: "1",
      testSold: "1",
    };

    // ── POST to Phonexa ────────────────────────────────────────────
    const formBody = new URLSearchParams();
    Object.entries(phonexaLead).forEach(([key, value]) => {
      if (value !== "") formBody.append(key, value);
    });

    let postStatus = "",
      postResponse = "",
      postRes;
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

    // ── Parse Phonexa response ─────────────────────────────────────
    // status 1 = sold (accepted)
    // status 2 = reject
    // status 4 = error/validation
    let phonexaResult = {};
    try {
      phonexaResult = JSON.parse(postResponse);
    } catch (_) {}

    const isSold =
      phonexaResult.status === 1 &&
      phonexaResult.status_text?.toLowerCase() === "sold";

    if (!isSold) {
      console.warn("Lead not sold:", phonexaResult);
      return res.status(502).json({
        error: "Phonexa did not accept the lead.",
        phonexaStatus: phonexaResult.status_text || "unknown",
        phonexaErrors: phonexaResult.errors || null,
        response: postResponse,
      });
    }

    // ── Email (only sent when lead is sold) ────────────────────────
    const or = (v) => v || "—";

    const message = `
New Talc Lead (Phonexa Lab 115 – Talcum spec)
Post URL: ${PHONEXA_POST_URL}

━━━ LEAD POST RESULT ━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:            ${postStatus}
Phonexa Status:    ${phonexaResult.status_text} (status ${phonexaResult.status})
Lead ID:           ${phonexaResult.lead_id || "—"}
Price:             ${phonexaResult.price || "—"}

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
Price Submitted:   ${phonexaLead.price}
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
        `✅ New Talc Lead SOLD – ${phonexaLead.firstName} ${phonexaLead.lastName}`.trim(),
      text: message,
    });

    return res.status(200).json({
      success: true,
      leadId: phonexaResult.lead_id,
      leadPostStatus: postStatus,
      leadPostResponse: postResponse,
    });
  } catch (error) {
    console.error("send-email handler error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
