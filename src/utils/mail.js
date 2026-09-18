import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendContactEmail({ name, email, subject, message }) {
  await transporter.sendMail({
    from: `"The Kara Candle Website" <${process.env.SMTP_USER}>`,
    to: process.env.CONTACT_EMAIL,

    // Very useful: when you click Reply in Gmail/Webmail,
    // it replies directly to the customer.
    replyTo: email,

    subject: `Contact Form: ${subject || "General enquiry"}`,

    text: `
New message from The Kara Candle website

Name: ${name}
Customer Email: ${email}
Subject: ${subject || "General enquiry"}

Message:
${message}
    `,

    html: `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: auto;">
        <h2 style="color:#4a1f14;">New Contact Form Message</h2>

        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject || "General enquiry"}</p>

        <hr />

        <h3>Message</h3>

        <p style="white-space:pre-wrap;">
          ${message}
        </p>

        <hr />

        <p style="color:#777;font-size:12px;">
          This message was submitted through
          The Kara Candle website.
        </p>
      </div>
    `,
  });
}
