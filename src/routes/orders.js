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
  const {
    items,
    shipping_address,
    billing_address,
    coupon_code,
    payment_provider = "razorpay",
    // guest fields — used when no user is logged in
    guest_name,
    guest_email,
    guest_phone,
  } = req.body;

  if (!items?.length) return res.status(400).json({ error: "No items" });

  // For guests, require name + email from body
  const orderEmail = req.user?.email || guest_email;
  const orderName = req.user?.name || guest_name;
  if (!orderEmail) return res.status(400).json({ error: "Email is required" });
  if (!orderName) return res.status(400).json({ error: "Name is required" });

  // recompute server-side
  const ids = items.map((i) => i.product_id);
  const [products] = await db.query(
    `SELECT id, name, price, discount_price, stock,
     (SELECT url FROM product_images WHERE product_id=products.id LIMIT 1) AS image_url
     FROM products WHERE id IN (?)`,
    [ids],
  );
  const map = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const lineItems = items.map((i) => {
    const p = map.get(i.product_id);
    if (!p) throw new Error("Invalid product");
    const unit = Number(p.discount_price || p.price);
    const sub = unit * i.quantity;
    subtotal += sub;
    return { ...p, quantity: i.quantity, unit_price: unit, subtotal: sub };
  });

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
      if (c.max_discount) discount = Math.min(discount, Number(c.max_discount));
    }
  }

  const shipping = subtotal - discount >= 50 ? 0 : 5;
  const total = subtotal - discount + shipping;
  const order_number = genOrderNumber();

  const [result] = await db.query(
    `INSERT INTO orders
       (order_number, user_id, email, name, phone, subtotal, discount, shipping, total,
        coupon_code, payment_provider, shipping_address, billing_address)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      order_number,
      req.user?.id || null,
      orderEmail,
      orderName,
      req.user?.phone || guest_phone || null,
      subtotal,
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
  }

  // Clear DB cart if logged in
  if (req.user?.id) {
    await db.query("DELETE FROM cart WHERE user_id=?", [req.user.id]);
  }

  res.json({ id: orderId, order_number, total, currency: "USD" });
});

// ── My orders — logged-in users only ────────────────────────────────────────
r.get("/me", auth(), async (req, res) => {
  const [rows] = await db.query(
    "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC",
    [req.user.id],
  );
  res.json(rows);
});

// ── Guest order lookup by order_number + email ───────────────────────────────
r.get("/track", async (req, res) => {
  const { order_number, email } = req.query;
  if (!order_number || !email)
    return res.status(400).json({ error: "order_number and email required" });
  const [[order]] = await db.query(
    "SELECT * FROM orders WHERE order_number=? AND email=?",
    [order_number, email],
  );
  if (!order) return res.status(404).json({ error: "Order not found" });
  const [items] = await db.query("SELECT * FROM order_items WHERE order_id=?", [
    order.id,
  ]);
  res.json({ ...order, items });
});

// ── Single order ─────────────────────────────────────────────────────────────
r.get("/:id", auth(false), async (req, res) => {
  // logged-in: own orders or admin; guest: no access by ID (use /track instead)
  if (!req.user)
    return res
      .status(401)
      .json({ error: "Use /orders/track for guest orders" });
  const [[order]] = await db.query(
    "SELECT * FROM orders WHERE id=? AND (user_id=? OR ?=1)",
    [req.params.id, req.user.id, req.user.isAdmin ? 1 : 0],
  );
  if (!order) return res.status(404).json({ error: "Not found" });
  const [items] = await db.query("SELECT * FROM order_items WHERE order_id=?", [
    order.id,
  ]);
  res.json({ ...order, items });
});

// ── Admin: list all ──────────────────────────────────────────────────────────
r.get("/", auth(), adminOnly, async (_, res) => {
  const [rows] = await db.query(
    "SELECT * FROM orders ORDER BY created_at DESC LIMIT 200",
  );
  res.json(rows);
});

// ── Admin: update status ─────────────────────────────────────────────────────
r.put("/:id/status", auth(), adminOnly, async (req, res) => {
  await db.query("UPDATE orders SET status=?, tracking_number=? WHERE id=?", [
    req.body.status,
    req.body.tracking_number || null,
    req.params.id,
  ]);
  res.json({ ok: true });
});

export default r;
