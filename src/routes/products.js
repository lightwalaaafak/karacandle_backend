// backend/src/routes/products.js
import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const r = Router();

// ── Public: list products ────────────────────────────────────────────────────
r.get("/", async (req, res) => {
  const {
    collection,
    category,
    search,
    sort = "newest",
    featured,
    best_seller,
  } = req.query;

  const where = ["p.is_active = 1"];
  const params = [];

  if (collection) {
    where.push("c.slug = ?");
    params.push(collection);
  }
  if (category) {
    where.push("cat.slug = ?");
    params.push(category);
  }
  if (search) {
    where.push("p.name LIKE ?");
    params.push(`%${search}%`);
  }
  if (featured) where.push("p.is_featured = 1");
  if (best_seller) where.push("p.is_best_seller = 1");

  const orderBy =
    {
      newest: "p.created_at DESC",
      price_asc: "p.price ASC",
      price_desc: "p.price DESC",
      rating: "p.rating_avg DESC",
    }[sort] || "p.created_at DESC";

  try {
    const [rows] = await db.query(
      `SELECT p.*,
          c.name   AS collection_name,
          c.slug   AS collection_slug,
          cat.id   AS category_id,
          cat.name AS category_name,
          cat.slug AS category_slug,
          (SELECT url FROM product_images
           WHERE product_id = p.id
           ORDER BY is_primary DESC, display_order
           LIMIT 1) AS image_url,
          (SELECT o.title FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_title,
          (SELECT o.discount_pct FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_pct,
          (SELECT o.discount_amt FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_amt
       FROM products p
       LEFT JOIN collections c   ON c.id = p.collection_id
       LEFT JOIN categories  cat ON cat.id = p.category_id
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}`,
      params,
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Public: single product by slug ──────────────────────────────────────────
r.get("/:slug([a-z0-9-]+)", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*,
          c.name   AS collection_name,
          c.slug   AS collection_slug,
          cat.name AS category_name,
          cat.slug AS category_slug,
          (SELECT o.title FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_title,
          (SELECT o.discount_pct FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_pct,
          (SELECT o.discount_amt FROM offers o
           WHERE o.is_active=1 AND o.starts_at<=NOW() AND o.ends_at>=NOW()
             AND (o.product_id IS NULL OR o.product_id=p.id)
           ORDER BY o.product_id DESC LIMIT 1) AS offer_discount_amt
       FROM products p
       LEFT JOIN collections c   ON c.id = p.collection_id
       LEFT JOIN categories  cat ON cat.id = p.category_id
       WHERE p.slug = ? AND p.is_active = 1`,
      [req.params.slug],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });

    const product = rows[0];
    const [images] = await db.query(
      "SELECT * FROM product_images WHERE product_id=? ORDER BY is_primary DESC, display_order",
      [product.id],
    );
    const [reviews] = await db.query(
      "SELECT * FROM reviews WHERE product_id=? AND is_approved=1 ORDER BY created_at DESC LIMIT 20",
      [product.id],
    );
    const [related] = await db.query(
      `SELECT p.*,
          (SELECT url FROM product_images
           WHERE product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS image_url
       FROM products p
       WHERE p.collection_id = ? AND p.id <> ? AND p.is_active = 1
       LIMIT 4`,
      [product.collection_id, product.id],
    );

    res.json({ ...product, images, reviews, related });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: get images by numeric product id ───────────────────────────────────
r.get("/:id(\\d+)/images", auth(), adminOnly, async (req, res) => {
  try {
    const [images] = await db.query(
      "SELECT * FROM product_images WHERE product_id=? ORDER BY is_primary DESC, display_order",
      [req.params.id],
    );
    res.json(images);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: create product ────────────────────────────────────────────────────
r.post("/", auth(), adminOnly, async (req, res) => {
  const {
    name,
    slug,
    description,
    fragrance_notes,
    burn_time,
    price,
    discount_price,
    stock,
    sku,
    category_id,
    collection_id,
    is_featured,
    is_best_seller,
    is_active,
  } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO products
         (name, slug, description, fragrance_notes, burn_time,
          price, discount_price, stock, sku,
          category_id, collection_id,
          is_featured, is_best_seller, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        name,
        slug,
        description || null,
        fragrance_notes || null,
        burn_time || null,
        price,
        discount_price || null,
        stock || 0,
        sku || null,
        category_id || null,
        collection_id || null,
        is_featured ? 1 : 0,
        is_best_seller ? 1 : 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
      ],
    );
    res.json({ id: result.insertId });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Slug already exists" });
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: update product ────────────────────────────────────────────────────
r.put("/:id", auth(), adminOnly, async (req, res) => {
  const allowed = [
    "name",
    "slug",
    "description",
    "fragrance_notes",
    "burn_time",
    "price",
    "discount_price",
    "stock",
    "sku",
    "category_id",
    "collection_id",
    "is_featured",
    "is_best_seller",
    "is_active",
  ];
  const set = [],
    vals = [];
  allowed.forEach((f) => {
    if (f in req.body) {
      set.push(`${f}=?`);
      vals.push(req.body[f] === "" ? null : req.body[f]);
    }
  });
  if (!set.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    await db.query(`UPDATE products SET ${set.join(",")} WHERE id=?`, vals);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Slug already exists" });
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: soft-delete product ───────────────────────────────────────────────
r.delete("/:id", auth(), adminOnly, async (req, res) => {
  try {
    await db.query("UPDATE products SET is_active=0 WHERE id=?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: upload images ─────────────────────────────────────────────────────
r.post(
  "/:id/images",
  auth(),
  adminOnly,
  upload.array("images", 12),
  async (req, res) => {
    try {
      const base = process.env.PUBLIC_URL || "";
      const productId = req.params.id;

      const [[{ cnt }]] = await db.query(
        "SELECT COUNT(*) AS cnt FROM product_images WHERE product_id=?",
        [productId],
      );

      for (let i = 0; i < req.files.length; i++) {
        const f = req.files[i];
        const isPrimary = cnt === 0 && i === 0 ? 1 : 0;
        await db.query(
          "INSERT INTO product_images (product_id, url, display_order, is_primary) VALUES (?,?,?,?)",
          [
            productId,
            `${base}/uploads/${f.filename}`,
            Number(cnt) + i,
            isPrimary,
          ],
        );
      }
      res.json({ ok: true, count: req.files.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// ── Admin: delete a single image ─────────────────────────────────────────────
r.delete("/:productId/images/:imageId", auth(), adminOnly, async (req, res) => {
  try {
    const { productId, imageId } = req.params;
    const [[img]] = await db.query(
      "SELECT * FROM product_images WHERE id=? AND product_id=?",
      [imageId, productId],
    );
    if (!img) return res.status(404).json({ error: "Image not found" });

    await db.query("DELETE FROM product_images WHERE id=?", [imageId]);

    if (img.is_primary) {
      await db.query(
        "UPDATE product_images SET is_primary=1 WHERE product_id=? ORDER BY display_order LIMIT 1",
        [productId],
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: set primary image ─────────────────────────────────────────────────
r.put(
  "/:productId/images/:imageId/primary",
  auth(),
  adminOnly,
  async (req, res) => {
    const { productId, imageId } = req.params;
    try {
      await db.query(
        "UPDATE product_images SET is_primary=0 WHERE product_id=?",
        [productId],
      );
      await db.query(
        "UPDATE product_images SET is_primary=1 WHERE id=? AND product_id=?",
        [imageId, productId],
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  },
);

export default r;
