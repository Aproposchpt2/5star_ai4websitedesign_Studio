declare const Netlify: any;
declare const Buffer: any;

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function env(name: string): string {
  try {
    if (typeof Netlify !== "undefined" && Netlify.env && typeof Netlify.env.get === "function") {
      return Netlify.env.get(name) || "";
    }
  } catch (_) {}
  return "";
}

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status, headers: HEADERS });
}

function clean(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim();
}

function escapeHtml(value: unknown): string {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function filenameFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "ai4-website";
  return `${slug}.html`;
}

async function sendResendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: string }>;
}) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("RESEND_FROM_EMAIL");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  if (!from) {
    throw new Error("RESEND_FROM_EMAIL is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: options.attachments || []
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend error: ${text}`);
  }

  return response.json();
}

function customerEmailHtml(input: { firstName: string; businessName: string }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#050912;color:#eaf6ff;padding:28px;border-radius:16px;max-width:680px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#5BD3FF;font-weight:700;margin-bottom:12px;">AI4 Website Design Studio</div>
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.1;color:#ffffff;">Your selected website file is ready.</h1>
      <p style="font-size:15px;line-height:1.7;color:#b8c7da;margin:0 0 18px;">
        Hi ${escapeHtml(input.firstName || "there")}, attached is the selected website file for
        <strong style="color:#ffffff;">${escapeHtml(input.businessName || "your website")}</strong>.
      </p>
      <p style="font-size:14px;line-height:1.7;color:#b8c7da;margin:0;">
        Save the attachment as <strong>index.html</strong>. You can send it to your host, keep it as a backup, or reply to this email for launch support.
      </p>
    </div>
  `;
}

function ownerEmailHtml(record: Record<string, string>) {
  const rows = [
    ["Website", record.businessName],
    ["Member", record.fullName],
    ["Email", record.email],
    ["Phone", record.phone || "Not provided"],
    ["Style", record.style || "Not provided"],
    ["Layout", record.layout || "Not provided"],
    ["Palette", record.palette || "Not provided"],
    ["Treatment", record.treatment || "Not provided"],
    ["Submitted", record.submittedAt]
  ];

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#071225;color:#eaf6ff;padding:28px;border-radius:16px;max-width:760px;">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#5BD3FF;font-weight:700;margin-bottom:12px;">AI4 White Label Site Selected</div>
      <h2 style="margin:0 0 16px;color:#ffffff;">${escapeHtml(record.businessName || "Website Build")}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="padding:8px 0;color:#89a2bf;border-bottom:1px solid rgba(255,255,255,.08);">${escapeHtml(label)}</td>
            <td style="padding:8px 0;color:#ffffff;border-bottom:1px solid rgba(255,255,255,.08);">${escapeHtml(value)}</td>
          </tr>
        `).join("")}
      </table>
      <p style="color:#89a2bf;font-size:13px;line-height:1.6;margin:18px 0 0;">The selected HTML file is attached.</p>
    </div>
  `;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: HEADERS });
  }

  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed." });
  }

  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return json(400, { success: false, error: "Invalid JSON body." });
  }

  const email = clean(body.email).toLowerCase();
  const firstName = clean(body.first_name || body.firstName);
  const lastName = clean(body.last_name || body.lastName);
  const fullName = clean(body.full_name || body.fullName || `${firstName} ${lastName}`);
  const businessName = clean(body.business_name || body.businessName || "AI4 Website");
  const phone = clean(body.phone);
  const builtHtml = clean(body.built_html || body.builtHtml || body.html);

  if (!firstName || !lastName || !fullName) {
    return json(400, { success: false, error: "First name and last name are required." });
  }

  if (!isEmail(email)) {
    return json(400, { success: false, error: "A valid member email is required." });
  }

  if (!builtHtml || !builtHtml.includes("<html")) {
    return json(400, { success: false, error: "Selected website HTML was not included." });
  }

  const fileName = filenameFromTitle(businessName);
  const attachment = {
    filename: fileName,
    content: Buffer.from(builtHtml, "utf8").toString("base64")
  };
  const ownerEmail = env("AI4_INTERNAL_NOTIFICATION_EMAIL") || env("RESEND_TO_EMAIL");
  const submittedAt = new Date().toISOString();

  if (!ownerEmail) {
    return json(502, { success: false, error: "AI4 owner notification email is not configured." });
  }

  const record = {
    businessName,
    fullName,
    email,
    phone,
    style: clean(body.style),
    layout: clean(body.layout),
    palette: clean(body.palette),
    treatment: clean(body.treatment),
    submittedAt
  };

  try {
    await sendResendEmail({
      to: email,
      subject: `Your ${businessName} website file is ready`,
      html: customerEmailHtml({ firstName, businessName }),
      attachments: [attachment]
    });

    await sendResendEmail({
      to: ownerEmail,
      subject: `AI4 website selected - ${businessName}`,
      html: ownerEmailHtml(record),
      attachments: [attachment]
    });

    return json(200, {
      success: true,
      message: "Website file sent to the member and AI4 owner inbox.",
      ownerEmail,
      fileName
    });
  } catch (error: any) {
    console.error("Selected site delivery failed:", error);
    return json(502, {
      success: false,
      error: error && error.message ? error.message : "Email delivery failed."
    });
  }
};

export const config = {
  path: "/api/deliver-selected-site",
  method: ["POST", "OPTIONS"]
};
