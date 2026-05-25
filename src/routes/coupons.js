import { Router } from 'express';
import { db } from '../config/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
const r = Router();

r.post('/validate', async (req, res) => {
  const [[c]] = await db.query('SELECT * FROM coupons WHERE code=? AND is_active=1', [req.body.code]);
  if (!c) return res.status(404).json({ error: 'Invalid coupon' });
  res.json(c);
});

r.get('/', auth(), adminOnly, async (_, res) => {
  const [rows] = await db.query('SELECT * FROM coupons ORDER BY id DESC');
  res.json(rows);
});

r.post('/', auth(), adminOnly, async (req, res) => {
  const { code, type, value, min_order, max_discount, usage_limit, starts_at, expires_at } = req.body;
  const [result] = await db.query('INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, starts_at, expires_at) VALUES (?,?,?,?,?,?,?,?)',
    [code, type, value, min_order || 0, max_discount || null, usage_limit || null, starts_at || null, expires_at || null]);
  res.json({ id: result.insertId });
});

export default r;
