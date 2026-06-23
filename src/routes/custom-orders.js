import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";

const r = Router();

// Public — submit a custom order request
r.post("/", async (req, res) => {
  const { name, email, phone, occasion, quantity, message } = req.body;
  if (!name || !email || !message)
    return res
      .status(400)
      .json({ error: "Name, email and message are required." });
  try {
    await db.query(
      `INSERT INTO custom_orders (name, email, phone, occasion, quantity, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, phone || null, occasion || null, quantity || null, message],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — list all custom order requests
r.get("/", auth(), adminOnly, async (_, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM custom_orders ORDER BY created_at DESC",
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — update status
r.put("/:id/status", auth(), adminOnly, async (req, res) => {
  const { status } = req.body;
  try {
    await db.query("UPDATE custom_orders SET status=? WHERE id=?", [
      status,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

export default r;
