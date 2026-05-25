import { Router } from 'express';
import { db } from '../config/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
const r = Router();

r.get('/banners', async (_, res) => {
  const [rows] = await db.query('SELECT * FROM banners WHERE is_active=1 ORDER BY display_order');
  res.json(rows);
});
r.get('/sections', async (_, res) => {
  const [rows] = await db.query('SELECT * FROM homepage_sections WHERE is_active=1');
  res.json(rows);
});

r.post('/banners', auth(), adminOnly, upload.single('video'), async (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  const video_url = req.file ? `${base}/uploads/${req.file.filename}` : req.body.video_url;
  const { title, subtitle, cta_text, cta_link, display_order } = req.body;
  const [r1] = await db.query('INSERT INTO banners (title, subtitle, video_url, cta_text, cta_link, display_order) VALUES (?,?,?,?,?,?)',
    [title, subtitle, video_url, cta_text, cta_link, display_order || 0]);
  res.json({ id: r1.insertId });
});

r.put('/sections/:key', auth(), adminOnly, async (req, res) => {
  const { heading, body, image_url, meta } = req.body;
  await db.query(`INSERT INTO homepage_sections (section_key, heading, body, image_url, meta) VALUES (?,?,?,?,?)
    ON DUPLICATE KEY UPDATE heading=VALUES(heading), body=VALUES(body), image_url=VALUES(image_url), meta=VALUES(meta)`,
    [req.params.key, heading, body, image_url, meta ? JSON.stringify(meta) : null]);
  res.json({ ok: true });
});

export default r;
