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
    if (!orderName) return res.status(400).json({ error: "Name is required" });

    const productItems = items.filter(
      (i) => (i.item_type || "product") === "product",
    );
    const setItems = items.filter((i) => i.item_type === "discovery_set");

    // ── fetch products for direct product items ─────────────────────────────
    const productMap = new Map();
    if (productItems.length) {
      const ids = productItems.map((i) => i.product_id);
      const [products] = await db.query(
        `SELECT id, name, price, discount_price, stock,
         (SELECT url FROM product_images WHERE product_id=products.id LIMIT 1) AS image_url
         FROM products WHERE id IN (?)`,
        [ids],
      );
      products.forEach((p) => productMap.set(p.id, p));
    }

    // ── fetch discovery sets + their included products ───────────────────────
    const setMap = new Map();
    if (setItems.length) {
      const setIds = setItems.map((i) => i.discovery_set_id);
      const [sets] = await db.query(
        `SELECT * FROM discovery_sets WHERE id IN (?)`,
        [setIds],
      );
      for (const s of sets) {
        const [contents] = await db.query(
          `SELECT dsi.product_id, p.name AS product_name
           FROM discovery_set_items dsi
           JOIN products p ON p.id = dsi.product_id
           WHERE dsi.discovery_set_id=?`,
          [s.id],
        );
        s.contents = contents;
        setMap.set(s.id, s);
      }
    }

    let subtotal = 0;
    const lineItems = [];

    // ── regular products (with offer logic, unchanged) ───────────────────────
    for (const i of productItems) {
      const p = productMap.get(i.product_id);
      if (!p)
        return res
          .status(400)
          .json({ error: `Invalid product_id: ${i.product_id}` });

      const basePrice = Number(p.discount_price || p.price);
      let activeOffer = null;
      try {
        const [[found]] = await db.query(
          `SELECT * FROM offers
           WHERE is_active=1 AND starts_at<=NOW() AND ends_at>=NOW()
             AND (product_id IS NULL OR product_id=?)
           ORDER BY product_id DESC LIMIT 1`,
          [i.product_id],
        );
        activeOffer = found || null;
      } catch (e) {
        console.warn("Offer lookup failed (non-fatal):", e.message);
      }

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
        item_type: "product",
        product_id: p.id,
        discovery_set_id: null,
        name: p.name,
        image_url: p.image_url,
        quantity: i.quantity,
        unit_price,
        subtotal: sub,
        offer_id: activeOffer?.id || null,
        item_offer_discount,
        set_contents: null,
        stock_deductions: [{ product_id: p.id, quantity: i.quantity }],
      });
    }

    // ── discovery sets — flat price, no per-item offer, but stock deducts per candle ──
    for (const i of setItems) {
      const s = setMap.get(i.discovery_set_id);
      if (!s)
        return res
          .status(400)
          .json({ error: `Invalid discovery_set_id: ${i.discovery_set_id}` });

      const unit_price = Number(s.price);
      const sub = unit_price * i.quantity;
      subtotal += sub;

      lineItems.push({
        item_type: "discovery_set",
        product_id: null,
        discovery_set_id: s.id,
        name: s.name,
        image_url: s.banner_image,
        quantity: i.quantity,
        unit_price,
        subtotal: sub,
        offer_id: null,
        item_offer_discount: 0,
        set_contents: s.contents,
        stock_deductions: s.contents.map((c) => ({
          product_id: c.product_id,
          quantity: i.quantity, // 1 unit of each candle per set sold
        })),
      });
    }

    const offer_discount = lineItems.reduce(
      (s, li) => s + li.item_offer_discount,
      0,
    );

    let discount = 0;
    if (coupon_code) {
      try {
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
      } catch (e) {
        console.warn("Coupon lookup failed (non-fatal):", e.message);
      }
    }

    const shipping = subtotal - discount >= 50 ? 0 : 5;
    const total = subtotal - discount + shipping;
    const order_number = genOrderNumber();

    const [result] = await db.query(
      `INSERT INTO orders
         (order_number, user_id, email, name, phone,
          subtotal, offer_discount, discount, shipping, total,
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
      const [itemResult] = await db.query(
        `INSERT INTO order_items
           (order_id, product_id, item_type, discovery_set_id, product_name, product_image, unit_price, quantity, subtotal)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          orderId,
          li.product_id,
          li.item_type,
          li.discovery_set_id,
          li.name,
          li.image_url,
          li.unit_price,
          li.quantity,
          li.subtotal,
        ],
      );

      if (li.item_type === "discovery_set" && li.set_contents?.length) {
        for (const c of li.set_contents) {
          await db.query(
            `INSERT INTO order_item_set_products (order_item_id, product_id, product_name, quantity)
             VALUES (?,?,?,?)`,
            [itemResult.insertId, c.product_id, c.product_name, li.quantity],
          );
        }
      }
    }

    // ── coupon / offer usage tracking (unchanged) ─────────────────────────────
    if (coupon_code && discount > 0) {
      try {
        await db.query(
          `UPDATE coupons SET used_count = COALESCE(used_count, 0) + 1 WHERE code = ?`,
          [coupon_code],
        );
      } catch (e) {
        console.warn("Could not update coupon used_count:", e.message);
      }
      try {
        await db.query(
          `INSERT INTO order_coupons (order_id, coupon_code, discount_amount) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE discount_amount = VALUES(discount_amount)`,
          [orderId, coupon_code, discount],
        );
      } catch (e) {
        console.warn("order_coupons insert failed (non-fatal):", e.message);
      }
    }
    for (const li of lineItems) {
      if (li.offer_id) {
        try {
          await db.query(
            `UPDATE offers SET used_count = COALESCE(used_count, 0) + 1 WHERE id = ?`,
            [li.offer_id],
          );
        } catch (e) {
          console.warn("Could not update offer used_count:", e.message);
        }
      }
    }

    // ── stock deduction: every candle sold, whether solo or inside a set ────
    const deductions = new Map(); // product_id -> total qty
    for (const li of lineItems) {
      for (const d of li.stock_deductions) {
        deductions.set(
          d.product_id,
          (deductions.get(d.product_id) || 0) + d.quantity,
        );
      }
    }
    for (const [product_id, qty] of deductions) {
      await db.query(
        "UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id=?",
        [qty, product_id],
      );
    }

    // ── clear DB cart (both product + set rows) if logged in ────────────────
    if (req.user?.id) {
      try {
        await db.query("DELETE FROM cart WHERE user_id=?", [req.user.id]);
      } catch (e) {
        console.warn("Could not clear cart:", e.message);
      }
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

    for (const item of items) {
      if (item.item_type === "discovery_set") {
        const [setProducts] = await db.query(
          "SELECT product_id, product_name, quantity FROM order_item_set_products WHERE order_item_id=?",
          [item.id],
        );
        item.set_products = setProducts;
      }
    }

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
