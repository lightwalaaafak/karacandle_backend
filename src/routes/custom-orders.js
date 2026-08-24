import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";
import { emitEvent } from "../socket.js";

const r = Router();

r.post("/", async (req, res) => {
  const { name, email, phone, occasion, quantity, message } = req.body;
  if (!name || !email || !message)
    return res
      .status(400)
      .json({ error: "Name, email and message are required." });
  try {
    const [result] = await db.query(
      `INSERT INTO custom_orders (name, email, phone, occasion, quantity, message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, email, phone || null, occasion || null, quantity || null, message],
    );
    emitEvent("custom_order:new", {
      id: result.insertId,
      name,
      email,
      occasion: occasion || null,
      created_at: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

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

r.put("/:id/status", auth(), adminOnly, async (req, res) => {
  const { status } = req.body;
  try {
    await db.query("UPDATE custom_orders SET status=? WHERE id=?", [
      status,
      req.params.id,
    ]);
    emitEvent("custom_order:updated", { id: Number(req.params.id), status });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

export default r;
