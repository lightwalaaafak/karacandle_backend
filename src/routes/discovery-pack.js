// backend/src/routes/discovery-pack.js

import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
const r = Router();

// ── Public: active pack configs ───────────────────────────────────────────
r.get("/config", async (_, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, pack_size, price, banner_image, description FROM discovery_pack_settings WHERE is_active=1 ORDER BY pack_size ASC",
    );
    res.json({ packs: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load pack config" });
  }
});

// ── Public: eligible products for pack builder ────────────────────────────
r.get("/products", async (_, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.id, p.name, p.slug, p.stock, p.burn_time,
         col.name AS collection_name,
         (SELECT pi.url FROM product_images pi
          WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC LIMIT 1) AS image_url
       FROM products p
       LEFT JOIN collections col ON col.id = p.collection_id
       WHERE p.is_active = 1 AND p.stock > 0
       ORDER BY p.name ASC`,
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load products" });
  }
});

// ── Auth(false): add custom pack to cart ──────────────────────────────────
r.post("/cart", auth(false), async (req, res) => {
  const { pack_size, selections } = req.body;

  // Shape validation
  if (!pack_size || !Array.isArray(selections) || selections.length === 0)
    return res.status(400).json({ error: "pack_size and selections required" });
  if (!Number.isInteger(Number(pack_size)) || Number(pack_size) <= 0)
    return res.status(400).json({ error: "Invalid pack_size" });

  for (const s of selections) {
    if (!s.product_id || !s.quantity || s.quantity <= 0)
      return res.status(400).json({
        error: "Each selection needs product_id and positive quantity",
      });
  }

  const totalQty = selections.reduce((sum, s) => sum + Number(s.quantity), 0);
  if (totalQty !== Number(pack_size))
    return res.status(400).json({
      error: `Total quantity (${totalQty}) must equal pack size (${pack_size})`,
    });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Fetch trusted pack price
    const [[packConfig]] = await conn.query(
      "SELECT price, is_active FROM discovery_pack_settings WHERE pack_size = ? FOR SHARE",
      [Number(pack_size)],
    );
    if (!packConfig)
      return conn
        .rollback()
        .then(() =>
          res.status(400).json({ error: "This pack size is not available" }),
        );
    if (!packConfig.is_active)
      return conn
        .rollback()
        .then(() =>
          res.status(400).json({ error: "This pack is currently unavailable" }),
        );

    // Aggregate selections (in case duplicates sent)
    const agg = new Map();
    for (const s of selections)
      agg.set(
        Number(s.product_id),
        (agg.get(Number(s.product_id)) || 0) + Number(s.quantity),
      );

    // Validate products
    const productIds = [...agg.keys()];
    const [products] = await conn.query(
      "SELECT id, name, stock, is_active FROM products WHERE id IN (?)",
      [productIds],
    );
    const prodMap = new Map(products.map((p) => [p.id, p]));

    for (const [pid, qty] of agg) {
      const p = prodMap.get(pid);
      if (!p)
        return conn
          .rollback()
          .then(() =>
            res.status(400).json({ error: `Product ID ${pid} not found` }),
          );
      if (!p.is_active)
        return conn
          .rollback()
          .then(() =>
            res.status(400).json({ error: `"${p.name}" is not available` }),
          );
      if (p.stock < qty)
        return conn
          .rollback()
          .then(() =>
            res
              .status(400)
              .json({ error: `"${p.name}" only has ${p.stock} in stock` }),
          );
    }

    // Build selections array
    const selectionsToStore = [];
    for (const [pid, qty] of agg) {
      selectionsToStore.push({ product_id: pid, quantity: qty });
    }

    const packPrice = Number(packConfig.price);
    const userId = req.user?.id || null;

    // Insert into cart with item_type = 'custom_pack'
    const [result] = await conn.query(
      `INSERT INTO cart (user_id, item_type, pack_size, pack_price, pack_selections, quantity)
       VALUES (?, 'custom_pack', ?, ?, ?, 1)`,
      [userId, Number(pack_size), packPrice, JSON.stringify(selectionsToStore)],
    );

    await conn.commit();
    res.json({ ok: true, cart_id: result.insertId, pack_price: packPrice });
  } catch (e) {
    await conn.rollback();
    console.error("Pack cart add error:", e);
    res.status(500).json({ error: "Could not add pack to cart" });
  } finally {
    conn.release();
  }
});

// ── Admin: get all pack configs ───────────────────────────────────────────
r.get("/admin/config", auth(), adminOnly, async (_, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM discovery_pack_settings ORDER BY pack_size ASC",
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: upsert pack config ─────────────────────────────────────────────
r.post("/admin/config", auth(), adminOnly, async (req, res) => {
  const { pack_size, price, is_active } = req.body;
  if (!pack_size || price === undefined)
    return res.status(400).json({ error: "pack_size and price required" });
  if (Number(price) <= 0)
    return res.status(400).json({ error: "Price must be positive" });
  try {
    await db.query(
      `INSERT INTO discovery_pack_settings (pack_size, price, is_active)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE price=VALUES(price), is_active=VALUES(is_active)`,
      [Number(pack_size), Number(price), is_active ? 1 : 0],
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not save config" });
  }
});

// In discovery-pack.js — replace the PUT /admin/config/:id route:
r.put(
  "/admin/config/:id",
  auth(),
  adminOnly,
  upload.single("banner_image"),
  async (req, res) => {
    const { price, is_active, description } = req.body;
    if (price !== undefined && Number(price) <= 0)
      return res.status(400).json({ error: "Price must be positive" });
    try {
      const fields = [],
        vals = [];
      if (price !== undefined) {
        fields.push("price=?");
        vals.push(Number(price));
      }
      if (is_active !== undefined) {
        fields.push("is_active=?");
        vals.push(is_active ? 1 : 0);
      }
      if (description !== undefined) {
        fields.push("description=?");
        vals.push(description || null);
      }
      if (req.file) {
        const base = process.env.PUBLIC_URL || "";
        fields.push("banner_image=?");
        vals.push(`${base}/uploads/${req.file.filename}`);
      }
      if (!fields.length) return res.json({ ok: true });
      vals.push(req.params.id);
      await db.query(
        `UPDATE discovery_pack_settings SET ${fields.join(",")} WHERE id=?`,
        vals,
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Could not update config" });
    }
  },
);

export default r;
