// backend/src/routes/orders.js
import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";

const r = Router();

const genOrderNumber = () =>
  "KARA-" +
  Date.now().toString(36).toUpperCase() +
  Math.random().toString(36).slice(2, 6).toUpperCase();

// ── Create order — works for guests AND logged-in users ──────────────────────
r.post("/", auth(false), async (req, res) => {
  try {
    const {
      items,
      shipping_address,
      billing_address,
      coupon_code,
      payment_provider = "razorpay",
      guest_name,
      guest_email,
      guest_phone,
    } = req.body;

    if (!items?.length) return res.status(400).json({ error: "No items" });

    const orderEmail = req.user?.email || guest_email;
    const orderName = req.user?.name || guest_name;
    if (!orderEmail)
      return res.status(400).json({ error: "Email is required" });
    if (!orderName) return res.status(400).json({ error: "Name is required" }); // Recompute server-side

    const ids = items.map((i) => i.product_id);
    const [products] = await db.query(
      `SELECT id, name, price, discount_price, stock,
       (SELECT url FROM product_images WHERE product_id=products.id LIMIT 1) AS image_url
       FROM products WHERE id IN (?)`,
      [ids],
    );
    const map = new Map(products.map((p) => [p.id, p]));

    let subtotal = 0;
    const lineItems = [];

    for (const i of items) {
      const p = map.get(i.product_id);
      if (!p) {
        return res
          .status(400)
          .json({ error: `Invalid product_id: ${i.product_id}` });
      }

      const basePrice = Number(p.discount_price || p.price); // ── Apply active offer discount per item ────────────────────────────

      const [[activeOffer]] = await db.query(
        `SELECT * FROM offers
         WHERE is_active=1 AND starts_at<=NOW() AND ends_at>=NOW()
           AND (product_id IS NULL OR product_id=?)
         ORDER BY product_id DESC LIMIT 1`,
        [i.product_id],
      );

      let unit_price = basePrice;
      let item_offer_discount = 0;

      if (activeOffer) {
        let discounted = basePrice;
        if (activeOffer.discount_pct) {
          discounted =
            basePrice - (basePrice * Number(activeOffer.discount_pct)) / 100;
        } else if (activeOffer.discount_amt) {
          discounted = Math.max(
            0,
            basePrice - Number(activeOffer.discount_amt),
          );
        }
        item_offer_discount = (basePrice - discounted) * i.quantity;
        unit_price = discounted;
      }

      const sub = unit_price * i.quantity;
      subtotal += sub;

      lineItems.push({
        ...p,
        quantity: i.quantity,
        unit_price,
        subtotal: sub,
        offer_id: activeOffer?.id || null,
        item_offer_discount,
      });
    } // Total offer discount across all line items

    const offer_discount = lineItems.reduce(
      (s, li) => s + li.item_offer_discount,
      0,
    ); // ── Coupon discount (applied on post-offer subtotal) ────────────────────

    let discount = 0;
    if (coupon_code) {
      const [[c]] = await db.query(
        "SELECT * FROM coupons WHERE code=? AND is_active=1",
        [coupon_code],
      );
      if (c && subtotal >= Number(c.min_order)) {
        discount =
          c.type === "percent"
            ? (subtotal * Number(c.value)) / 100
            : Number(c.value);
        if (c.max_discount)
          discount = Math.min(discount, Number(c.max_discount));
      }
    }

    const shipping = subtotal - discount >= 50 ? 0 : 5;
    const total = subtotal - discount + shipping;
    const order_number = genOrderNumber();

    const [result] = await db.query(
      `INSERT INTO orders
         (order_number, user_id, email, name, phone, subtotal, offer_discount, discount, shipping, total,
          coupon_code, payment_provider, shipping_address, billing_address)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        order_number,
        req.user?.id || null,
        orderEmail,
        orderName,
        req.user?.phone || guest_phone || null,
        subtotal,
        offer_discount,
        discount,
        shipping,
        total,
        coupon_code || null,
        payment_provider,
        JSON.stringify(shipping_address),
        JSON.stringify(billing_address || shipping_address),
      ],
    );

    const orderId = result.insertId;

    for (const li of lineItems) {
      await db.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, product_image, unit_price, quantity, subtotal)
         VALUES (?,?,?,?,?,?,?)`,
        [
          orderId,
          li.id,
          li.name,
          li.image_url,
          li.unit_price,
          li.quantity,
          li.subtotal,
        ],
      );
    } // ── Track coupon usage ───────────────────────────────────────────────────

    if (coupon_code && discount > 0) {
      await db.query(
        `UPDATE coupons SET used_count = used_count + 1 WHERE code = ?`,
        [coupon_code],
      );
      await db.query(
        `INSERT INTO order_coupons (order_id, coupon_code, discount_amount) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE discount_amount = VALUES(discount_amount)`,
        [orderId, coupon_code, discount],
      );
    } // ── Track offer usage per order item ────────────────────────────────────

    for (const li of lineItems) {
      if (li.offer_id) {
        await db.query(
          `UPDATE offers SET used_count = COALESCE(used_count, 0) + 1 WHERE id = ?`,
          [li.offer_id],
        );
      }
    } // Clear DB cart if logged in

    if (req.user?.id) {
      await db.query("DELETE FROM cart WHERE user_id=?", [req.user.id]);
    }

    res.json({ id: orderId, order_number, total, currency: "USD" });
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(500).json({ error: "Could not create order" });
  }
});

// ── My orders — logged-in users only ────────────────────────────────────────
r.get("/me", auth(), async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC",
      [req.user.id],
    );
    res.json(rows);
  } catch (err) {
    console.error("Fetch my orders failed:", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
});

// ── Guest order lookup by order_number + email ───────────────────────────────
r.get("/track", async (req, res) => {
  try {
    const { order_number, email } = req.query;
    if (!order_number || !email)
      return res.status(400).json({ error: "order_number and email required" });

    const [[order]] = await db.query(
      "SELECT * FROM orders WHERE order_number=? AND email=?",
      [order_number, email],
    );
    if (!order) return res.status(404).json({ error: "Order not found" });

    const [items] = await db.query(
      "SELECT * FROM order_items WHERE order_id=?",
      [order.id],
    );
    res.json({ ...order, items });
  } catch (err) {
    console.error("Track order failed:", err);
    res.status(500).json({ error: "Could not track order" });
  }
});

// ── Single order ─────────────────────────────────────────────────────────────
r.get("/:id", auth(false), async (req, res) => {
  try {
    if (!req.user)
      return res
        .status(401)
        .json({ error: "Use /orders/track for guest orders" });

    const [[order]] = await db.query(
      "SELECT * FROM orders WHERE id=? AND (user_id=? OR ?=1)",
      [req.params.id, req.user.id, req.user.isAdmin ? 1 : 0],
    );
    if (!order) return res.status(404).json({ error: "Not found" });

    const [items] = await db.query(
      "SELECT * FROM order_items WHERE order_id=?",
      [order.id],
    );
    res.json({ ...order, items });
  } catch (err) {
    console.error("Fetch order failed:", err);
    res.status(500).json({ error: "Could not fetch order" });
  }
});

// ── Admin: list all ──────────────────────────────────────────────────────────
r.get("/", auth(), adminOnly, async (_, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 200",
    );
    res.json(rows);
  } catch (err) {
    console.error("Fetch all orders failed:", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
});

// ── Admin: update status / tracking ─────────────────────────────────────────
r.put("/:id/status", auth(), adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE orders SET status=?, tracking_number=? WHERE id=?", [
      req.body.status,
      req.body.tracking_number || null,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Update order status failed:", err);
    res.status(500).json({ error: "Could not update order" });
  }
});

export default r;
