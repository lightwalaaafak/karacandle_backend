import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";
const r = Router();

// GET /coupons/validate?code=NEW10&order_total=340
r.get("/validate", async (req, res) => {
  const { code, order_total } = req.query;
  if (!code) return res.status(400).json({ error: "Code is required" });

  const [[c]] = await db.query(
    "SELECT * FROM coupons WHERE code=? AND is_active=1",
    [code.toUpperCase()],
  );
  if (!c) return res.status(404).json({ error: "Invalid coupon code" });

  // Check min order
  if (c.min_order && Number(order_total) < Number(c.min_order)) {
    return res.status(400).json({
      error: `Minimum order of $${Number(c.min_order).toFixed(2)} required`,
    });
  }

  // Check expiry
  if (c.expires_at && new Date(c.expires_at) < new Date()) {
    return res.status(400).json({ error: "This coupon has expired" });
  }

  // Check usage limit
  if (c.usage_limit && c.used_count >= c.usage_limit) {
    return res.status(400).json({ error: "Coupon usage limit reached" });
  }

  res.json(c);
});

// Keep POST /validate if needed elsewhere
r.post("/validate", async (req, res) => {
  const [[c]] = await db.query(
    "SELECT * FROM coupons WHERE code=? AND is_active=1",
    [req.body.code],
  );
  if (!c) return res.status(404).json({ error: "Invalid coupon" });
  res.json(c);
});

r.get("/", auth(), adminOnly, async (_, res) => {
  const [rows] = await db.query("SELECT * FROM coupons ORDER BY id DESC");
  res.json(rows);
});

r.post("/", auth(), adminOnly, async (req, res) => {
  const {
    code,
    type,
    value,
    min_order,
    max_discount,
    usage_limit,
    starts_at,
    expires_at,
  } = req.body;
  const [result] = await db.query(
    "INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, starts_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      code,
      type,
      value,
      min_order || 0,
      max_discount || null,
      usage_limit || null,
      starts_at || null,
      expires_at || null,
    ],
  );
  res.json({ id: result.insertId });
});

export default r;
