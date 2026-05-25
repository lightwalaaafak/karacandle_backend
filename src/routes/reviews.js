import { Router } from 'express';
import { db } from '../config/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
const r = Router();

r.post('/', auth(false), async (req, res) => {
  const { product_id, rating, title, comment, name } = req.body;
  await db.query('INSERT INTO reviews (product_id, user_id, name, rating, title, comment) VALUES (?,?,?,?,?,?)',
    [product_id, req.user?.id || null, name || req.user?.email || 'Anonymous', rating, title, comment]);
  res.json({ ok: true });
});

r.put('/:id/approve', auth(), adminOnly, async (req, res) => {
  await db.query('UPDATE reviews SET is_approved=1 WHERE id=?', [req.params.id]);
  const [[rev]] = await db.query('SELECT product_id FROM reviews WHERE id=?', [req.params.id]);
  if (rev) {
    const [[agg]] = await db.query('SELECT AVG(rating) avg, COUNT(*) cnt FROM reviews WHERE product_id=? AND is_approved=1', [rev.product_id]);
    await db.query('UPDATE products SET rating_avg=?, rating_count=? WHERE id=?', [agg.avg || 0, agg.cnt, rev.product_id]);
  }
  res.json({ ok: true });
});

export default r;
