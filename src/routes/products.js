import { Router } from 'express';
import { db } from '../config/db.js';
import { auth, adminOnly } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const r = Router();

r.get('/', async (req, res) => {
  const { collection, category, search, sort = 'newest', featured, best_seller } = req.query;
  const where = ['p.is_active = 1'];
  const params = [];
  if (collection) { where.push('c.slug = ?'); params.push(collection); }
  if (category) { where.push('cat.slug = ?'); params.push(category); }
  if (search) { where.push('p.name LIKE ?'); params.push(`%${search}%`); }
  if (featured) where.push('p.is_featured = 1');
  if (best_seller) where.push('p.is_best_seller = 1');
  const orderBy = { newest: 'p.created_at DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', rating: 'p.rating_avg DESC' }[sort] || 'p.created_at DESC';
  const [rows] = await db.query(`
    SELECT p.*, c.name AS collection_name, c.slug AS collection_slug,
      (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1) AS image_url
    FROM products p
    LEFT JOIN collections c ON c.id = p.collection_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
  `, params);
  res.json(rows);
});

r.get('/:slug', async (req, res) => {
  const [rows] = await db.query(`
    SELECT p.*, c.name AS collection_name, c.slug AS collection_slug
    FROM products p LEFT JOIN collections c ON c.id = p.collection_id
    WHERE p.slug = ? AND p.is_active = 1
  `, [req.params.slug]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const product = rows[0];
  const [images] = await db.query('SELECT * FROM product_images WHERE product_id=? ORDER BY display_order', [product.id]);
  const [reviews] = await db.query('SELECT * FROM reviews WHERE product_id=? AND is_approved=1 ORDER BY created_at DESC LIMIT 20', [product.id]);
  const [related] = await db.query(`
    SELECT p.*, (SELECT url FROM product_images WHERE product_id=p.id LIMIT 1) AS image_url
    FROM products p WHERE p.collection_id=? AND p.id<>? AND p.is_active=1 LIMIT 4
  `, [product.collection_id, product.id]);
  res.json({ ...product, images, reviews, related });
});

// Admin
r.post('/', auth(), adminOnly, async (req, res) => {
  const { name, slug, description, fragrance_notes, burn_time, price, discount_price, stock, category_id, collection_id, is_featured, is_best_seller } = req.body;
  const [result] = await db.query(
    `INSERT INTO products (name, slug, description, fragrance_notes, burn_time, price, discount_price, stock, category_id, collection_id, is_featured, is_best_seller)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [name, slug, description, fragrance_notes, burn_time, price, discount_price || null, stock || 0, category_id || null, collection_id || null, !!is_featured, !!is_best_seller]
  );
  res.json({ id: result.insertId });
});

r.put('/:id', auth(), adminOnly, async (req, res) => {
  const fields = ['name','slug','description','fragrance_notes','burn_time','price','discount_price','stock','category_id','collection_id','is_featured','is_best_seller','is_active'];
  const set = [], vals = [];
  fields.forEach(f => { if (f in req.body) { set.push(`${f}=?`); vals.push(req.body[f]); }});
  if (!set.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await db.query(`UPDATE products SET ${set.join(',')} WHERE id=?`, vals);
  res.json({ ok: true });
});

r.delete('/:id', auth(), adminOnly, async (req, res) => {
  await db.query('UPDATE products SET is_active=0 WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

r.post('/:id/images', auth(), adminOnly, upload.array('images', 8), async (req, res) => {
  const base = process.env.PUBLIC_URL || '';
  for (const f of req.files) {
    await db.query('INSERT INTO product_images (product_id, url) VALUES (?,?)', [req.params.id, `${base}/uploads/${f.filename}`]);
  }
  res.json({ ok: true, count: req.files.length });
});

export default r;
