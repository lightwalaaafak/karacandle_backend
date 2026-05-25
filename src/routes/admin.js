import { Router } from 'express';
import { db } from '../config/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
const r = Router();
r.use(auth(), adminOnly);

r.get('/stats', async (_, res) => {
  const [[rev]] = await db.query("SELECT COALESCE(SUM(total),0) revenue FROM orders WHERE payment_status='paid'");
  const [[ord]] = await db.query('SELECT COUNT(*) count FROM orders');
  const [[usr]] = await db.query('SELECT COUNT(*) count FROM users');
  const [best] = await db.query(`SELECT p.id, p.name, SUM(oi.quantity) sold
    FROM order_items oi JOIN products p ON p.id=oi.product_id
    GROUP BY p.id ORDER BY sold DESC LIMIT 5`);
  res.json({ revenue: rev.revenue, orders: ord.count, users: usr.count, bestSellers: best });
});

r.get('/users', async (_, res) => {
  const [rows] = await db.query('SELECT id, name, email, phone, created_at FROM users ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});

export default r;
