import { Router } from "express";
import { sendContactEmail } from "../utils/mail.js";

const r = Router();

r.post("/", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({
        message: "Name, email and message are required.",
      });
    }

    await sendContactEmail({
      name,
      email,
      subject,
      message,
    });

    res.json({
      ok: true,
      message: "Message sent successfully.",
    });
  } catch (error) {
    console.error("Contact email error:", error);

    res.status(500).json({
      message: "Unable to send message. Please try again later.",
    });
  }
});

export default r;
