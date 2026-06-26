import { Router } from "express";
import { db } from "../config/db.js";
import { auth } from "../middleware/auth.js";

const r = Router();

r.get("/", auth(false), async (req, res) => {
  if (!req.user) return res.json([]);
  try {
    const [rows] = await db.query(
      `SELECT 
        c.id, c.quantity,
        p.id AS product_id, p.name, p.slug, p.price, p.discount_price, p.stock,
        p.burn_time,
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
      WHERE c.user_id=?`,
      [req.user.id],
    );

    const enriched = rows.map((item) => {
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

    res.json(enriched);
  } catch (e) {
    console.error("Cart GET failed:", e);
    res.status(500).json({ error: "Could not load cart" });
  }
});

r.post("/", auth(false), async (req, res) => {
  if (!req.user) return res.json({ ok: true });
  try {
    const { product_id, quantity = 1 } = req.body;
    await db.query(
      `INSERT INTO cart (user_id, product_id, quantity) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
      [req.user.id, product_id, quantity],
    );
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
