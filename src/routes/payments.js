import { Router } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import Stripe from 'stripe';
import { db } from '../config/db.js';
import { auth } from '../middleware/auth.js';

const r = Router();

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

r.post('/razorpay/order', auth(), async (req, res) => {
  if (!razorpay) return res.status(500).json({ error: 'Razorpay not configured' });
  const { order_id } = req.body;
  const [[o]] = await db.query('SELECT * FROM orders WHERE id=? AND user_id=?', [order_id, req.user.id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const rzpOrder = await razorpay.orders.create({
    amount: Math.round(Number(o.total) * 100),
    currency: o.currency,
    receipt: o.order_number,
  });
  res.json({ order: rzpOrder, key: process.env.RAZORPAY_KEY_ID });
});

r.post('/razorpay/verify', auth(), async (req, res) => {
  const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  if (expected !== razorpay_signature) return res.status(400).json({ error: 'Invalid signature' });
  await db.query("UPDATE orders SET payment_status='paid', status='paid', payment_id=? WHERE id=?", [razorpay_payment_id, order_id]);
  res.json({ ok: true });
});

r.post('/stripe/checkout', auth(), async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { order_id } = req.body;
  const [[o]] = await db.query('SELECT * FROM orders WHERE id=? AND user_id=?', [order_id, req.user.id]);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: { currency: o.currency.toLowerCase(), product_data: { name: `Order ${o.order_number}` }, unit_amount: Math.round(Number(o.total) * 100) },
      quantity: 1,
    }],
    success_url: `${process.env.CLIENT_URL}/order/${o.id}?paid=1`,
    cancel_url: `${process.env.CLIENT_URL}/checkout?cancelled=1`,
    metadata: { order_id: String(o.id) },
  });
  res.json({ url: session.url });
});

export default r;
