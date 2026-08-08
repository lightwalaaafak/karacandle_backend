import { Router } from "express";
import { db } from "../config/db.js";
import { auth } from "../middleware/auth.js";

const r = Router();

r.get("/", auth(false), async (req, res) => {
  if (!req.user) return res.json([]);
  try {
    // ── product cart rows ──────────────────────────────────────────────────
    const [productRows] = await db.query(
      `SELECT 
        c.id, c.quantity, 'product' AS item_type,
        p.id AS product_id, NULL AS discovery_set_id,
        p.name, p.slug, p.price, p.discount_price, p.stock, p.burn_time,
        col.name AS collection_name,
        (SELECT url FROM product_images WHERE product_id=p.id LIMIT 1) AS image_url,
        (SELECT o.id FROM offers o 
         WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
           AND (o.product_id IS NULL OR o.product_id=p.id)
         ORDER BY o.product_id DESC LIMIT 1) AS offer_id,
        (SELECT o.title FROM offers o 
         WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
           AND (o.product_id IS NULL OR o.product_id=p.id)
         ORDER BY o.product_id DESC LIMIT 1) AS offer_title,
        (SELECT o.discount_pct FROM offers o 
         WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
           AND (o.product_id IS NULL OR o.product_id=p.id)
         ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_pct,
        (SELECT o.discount_amt FROM offers o 
         WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
           AND (o.product_id IS NULL OR o.product_id=p.id)
         ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_amt
      FROM cart c
      JOIN products p ON p.id = c.product_id
      LEFT JOIN collections col ON col.id = p.collection_id
      WHERE c.user_id=? AND c.item_type='product'`,
      [req.user.id],
    );

    const enrichedProducts = productRows.map((item) => {
      const basePrice = Number(item.discount_price || item.price);
      let offerPrice = null;
      if (item.offer_discount_pct) {
        offerPrice =
          basePrice - (basePrice * Number(item.offer_discount_pct)) / 100;
      } else if (item.offer_discount_amt) {
        offerPrice = Math.max(0, basePrice - Number(item.offer_discount_amt));
      }
      return {
        ...item,
        effective_price: offerPrice ?? basePrice,
        offer_saving: offerPrice ? basePrice - offerPrice : 0,
      };
    });

    // ── discovery-set cart rows ──────────────────────────────────────────────
    const [setRows] = await db.query(
      `SELECT c.id, c.quantity, 'discovery_set' AS item_type,
        NULL AS product_id, ds.id AS discovery_set_id,
        ds.name, ds.slug, ds.price, NULL AS discount_price, NULL AS stock, NULL AS burn_time,
        'Discovery Set' AS collection_name,
        ds.banner_image AS image_url,
        NULL AS offer_id, NULL AS offer_title, NULL AS offer_discount_pct, NULL AS offer_discount_amt,
        ds.price AS effective_price, 0 AS offer_saving
       FROM cart c
       JOIN discovery_sets ds ON ds.id = c.discovery_set_id
       WHERE c.user_id=? AND c.item_type='discovery_set'`,
      [req.user.id],
    );

    // attach included product names for display in the cart line
    for (const s of setRows) {
      const [items] = await db.query(
        `SELECT p.name FROM discovery_set_items dsi
         JOIN products p ON p.id = dsi.product_id
         WHERE dsi.discovery_set_id=? ORDER BY dsi.display_order`,
        [s.discovery_set_id],
      );
      s.included_products = items.map((i) => i.name);
    }

    res.json([...enrichedProducts, ...setRows]);
  } catch (e) {
    console.error("Cart GET failed:", e);
    res.status(500).json({ error: "Could not load cart" });
  }
});

r.post("/", auth(false), async (req, res) => {
  if (!req.user) return res.json({ ok: true });
  try {
    const {
      item_type = "product",
      product_id,
      discovery_set_id,
      quantity = 1,
    } = req.body;

    if (item_type === "discovery_set") {
      if (!discovery_set_id)
        return res.status(400).json({ error: "discovery_set_id required" });
      await db.query(
        `INSERT INTO cart (user_id, discovery_set_id, item_type, quantity) VALUES (?,?,'discovery_set',?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [req.user.id, discovery_set_id, quantity],
      );
    } else {
      if (!product_id)
        return res.status(400).json({ error: "product_id required" });
      await db.query(
        `INSERT INTO cart (user_id, product_id, item_type, quantity) VALUES (?,?,'product',?)
         ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
        [req.user.id, product_id, quantity],
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("Cart POST failed:", e);
    res.status(500).json({ error: "Could not add to cart" });
  }
});

r.put("/:id", auth(false), async (req, res) => {
  if (!req.user) return res.json({ ok: true });
  try {
    await db.query("UPDATE cart SET quantity=? WHERE id=? AND user_id=?", [
      req.body.quantity,
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error("Cart PUT failed:", e);
    res.status(500).json({ error: "Could not update cart" });
  }
});

r.delete("/:id", auth(false), async (req, res) => {
  if (!req.user) return res.json({ ok: true });
  try {
    await db.query("DELETE FROM cart WHERE id=? AND user_id=?", [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error("Cart DELETE failed:", e);
    res.status(500).json({ error: "Could not remove from cart" });
  }
});

export default r;
