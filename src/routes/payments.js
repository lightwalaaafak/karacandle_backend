import { Router } from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import Stripe from "stripe";
import { db } from "../config/db.js";
import { auth } from "../middleware/auth.js";
import { emitEvent } from "../socket.js";

const r = Router();

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const findOrder = async (order_id, user) => {
  if (user?.isAdmin) {
    const [[o]] = await db.query("SELECT * FROM orders WHERE id=?", [order_id]);
    return o;
  }
  if (user?.id) {
    const [[o]] = await db.query(
      "SELECT * FROM orders WHERE id=? AND user_id=?",
      [order_id, user.id],
    );
    return o;
  }
  const [[o]] = await db.query("SELECT * FROM orders WHERE id=?", [order_id]);
  return o;
};

// Shared by both Razorpay verify and the Stripe webhook so an order can
// only ever be marked paid once, from whichever provider confirms first.
const markOrderPaid = async (order_id, payment_id) => {
  const [result] = await db.query(
    "UPDATE orders SET payment_status='paid', status='paid', payment_id=? WHERE id=? AND payment_status<>'paid'",
    [payment_id, order_id],
  );
  if (result.affectedRows > 0) {
    emitEvent("order:paid", { id: Number(order_id), payment_id });
  }
};

// ────────────────────────────────────────────────────────────────────────
// Razorpay
// ────────────────────────────────────────────────────────────────────────

r.post("/razorpay/order", auth(false), async (req, res) => {
  if (!razorpay)
    return res.status(500).json({ error: "Razorpay not configured" });
  const o = await findOrder(req.body.order_id, req.user);
  if (!o) return res.status(404).json({ error: "Order not found" });
  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(Number(o.total) * 100),
    currency: o.currency || "USD",
    receipt: o.order_number,
  });
  res.json({ order: rzpOrder, key: process.env.RAZORPAY_KEY_ID });
});

r.post("/razorpay/verify", auth(false), async (req, res) => {
  const {
    order_id,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  if (expected !== razorpay_signature)
    return res.status(400).json({ error: "Invalid signature" });

  await markOrderPaid(order_id, razorpay_payment_id);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────────────────
// Stripe
// ────────────────────────────────────────────────────────────────────────

r.post("/stripe/checkout", auth(false), async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe not configured" });
  const o = await findOrder(req.body.order_id, req.user);
  if (!o) return res.status(404).json({ error: "Order not found" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: (o.currency || "USD").toLowerCase(),
            product_data: { name: `Order ${o.order_number}` },
            unit_amount: Math.round(Number(o.total) * 100),
          },
          quantity: 1,
        },
      ],
      // metadata is what lets the webhook below find its way back to this
      // order — Stripe echoes it back untouched on the completed session.
      metadata: { order_id: String(o.id) },
      success_url: `${process.env.CLIENT_URL}/order/${o.id}?paid=1`,
      cancel_url: `${process.env.CLIENT_URL}/checkout?cancelled=1`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout session failed:", e);
    res.status(500).json({ error: "Could not start Stripe checkout" });
  }
});

// NOTE: this handler is intentionally NOT mounted with `r.post(...)` here.
// It needs the raw, unparsed request body to verify Stripe's signature, but
// this router only gets attached to the app *after* express.json() has
// already parsed the body. So it's exported and mounted directly on `app`
// in server.js, before the json() middleware runs. See server.js below.
export const stripeWebhookHandler = async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe not configured");

  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const order_id = session.metadata?.order_id;
      const payment_id = session.payment_intent;
      if (order_id) await markOrderPaid(order_id, payment_id);
    }
    res.json({ received: true });
  } catch (e) {
    console.error("Stripe webhook handling failed:", e);
    // Return 500 so Stripe retries the delivery instead of silently dropping it
    res.status(500).json({ error: "Webhook handler failed" });
  }
};

export default r;
