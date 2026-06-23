import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";

const r = Router();

// Public — active offers (for strip + shop badges)
r.get("/active", async (_, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*, p.name AS product_name, p.slug AS product_slug,
         (SELECT url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC LIMIT 1) AS product_image
       FROM offers o
       LEFT JOIN products p ON p.id = o.product_id
       WHERE o.is_active = 1
         AND o.starts_at <= NOW()
         AND o.ends_at   >= NOW()
       ORDER BY o.created_at DESC`,
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — list all
r.get("/", auth(), adminOnly, async (_, res) => {
  try {
    const [rows] = await db.query(
      `SELECT o.*, p.name AS product_name, p.slug AS product_slug
       FROM offers o
       LEFT JOIN products p ON p.id = o.product_id
       ORDER BY o.created_at DESC`,
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — create
r.post("/", auth(), adminOnly, async (req, res) => {
  const {
    title,
    description,
    discount_pct,
    discount_amt,
    coupon_code,
    product_id,
    starts_at,
    ends_at,
    is_active,
  } = req.body;
  if (!title || !starts_at || !ends_at)
    return res
      .status(400)
      .json({ error: "title, starts_at, ends_at required" });
  try {
    const [result] = await db.query(
      `INSERT INTO offers (title, description, discount_pct, discount_amt, coupon_code, product_id, starts_at, ends_at, is_active)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        title,
        description || null,
        discount_pct || null,
        discount_amt || null,
        coupon_code || null,
        product_id || null,
        starts_at,
        ends_at,
        is_active ?? 1,
      ],
    );
    res.json({ id: result.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — update
r.put("/:id", auth(), adminOnly, async (req, res) => {
  const fields = [
    "title",
    "description",
    "discount_pct",
    "discount_amt",
    "coupon_code",
    "product_id",
    "starts_at",
    "ends_at",
    "is_active",
  ];
  const set = [],
    vals = [];
  fields.forEach((f) => {
    if (f in req.body) {
      set.push(`${f}=?`);
      vals.push(req.body[f] === "" ? null : req.body[f]);
    }
  });
  if (!set.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    await db.query(`UPDATE offers SET ${set.join(",")} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// Admin — delete
r.delete("/:id", auth(), adminOnly, async (req, res) => {
  try {
    await db.query("DELETE FROM offers WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

export default r;
