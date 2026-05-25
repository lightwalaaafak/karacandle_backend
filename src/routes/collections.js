import { Router } from 'express';
import { db } from '../config/db.js';
const r = Router();
r.get('/', async (_, res) => {
  const [rows] = await db.query('SELECT * FROM collections ORDER BY display_order');
  res.json(rows);
});
r.get('/:slug', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM collections WHERE slug=?', [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});
export default r;
