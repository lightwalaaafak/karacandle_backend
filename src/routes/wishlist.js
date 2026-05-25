import { Router } from 'express';
import { db } from '../config/db.js';
import { auth } from '../middleware/auth.js';
const r = Router();

r.get('/', auth(), async (req, res) => {
  const [rows] = await db.query(`
    SELECT w.id, p.id AS product_id, p.name, p.slug, p.price, p.discount_price,
      (SELECT url FROM product_images WHERE product_id=p.id LIMIT 1) AS image_url
    FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=?
  `, [req.user.id]);
  res.json(rows);
});
r.post('/', auth(), async (req, res) => {
  await db.query('INSERT IGNORE INTO wishlist (user_id, product_id) VALUES (?,?)', [req.user.id, req.body.product_id]);
  res.json({ ok: true });
});
r.delete('/:product_id', auth(), async (req, res) => {
  await db.query('DELETE FROM wishlist WHERE user_id=? AND product_id=?', [req.user.id, req.params.product_id]);
  res.json({ ok: true });
});
export default r;
