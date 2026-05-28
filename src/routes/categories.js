// backend/src/routes/categories.js
// Full CRUD — public list + single, admin create/update/delete
// Register in server.js:  app.use("/api/categories", categoryRoutes);

import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";

const r = Router();

// ── Public: list all categories ──────────────────────────────────────────────
r.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, slug, description, image_url FROM categories ORDER BY name",
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Public: single category + its active products ────────────────────────────
r.get("/:slug", async (req, res) => {
  try {
    const [[cat]] = await db.query("SELECT * FROM categories WHERE slug = ?", [
      req.params.slug,
    ]);
    if (!cat) return res.status(404).json({ error: "Not found" });

    const [products] = await db.query(
      `SELECT p.*,
          col.name AS collection_name,
          col.slug AS collection_slug,
          (SELECT url FROM product_images
           WHERE product_id = p.id
           ORDER BY is_primary DESC, display_order
           LIMIT 1) AS image_url
       FROM products p
       LEFT JOIN collections col ON col.id = p.collection_id
       WHERE p.category_id = ? AND p.is_active = 1
       ORDER BY p.created_at DESC`,
      [cat.id],
    );

    res.json({ ...cat, products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: create category ───────────────────────────────────────────────────
r.post("/", auth(), adminOnly, async (req, res) => {
  const { name, slug, description, image_url } = req.body;
  if (!name || !slug)
    return res.status(400).json({ error: "name and slug are required" });

  try {
    const [result] = await db.query(
      "INSERT INTO categories (name, slug, description, image_url) VALUES (?,?,?,?)",
      [name, slug, description || null, image_url || null],
    );
    res.json({ id: result.insertId });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Slug already exists" });
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: update category ───────────────────────────────────────────────────
r.put("/:id", auth(), adminOnly, async (req, res) => {
  const { name, slug, description, image_url } = req.body;
  if (!name || !slug)
    return res.status(400).json({ error: "name and slug are required" });

  try {
    await db.query(
      "UPDATE categories SET name=?, slug=?, description=?, image_url=? WHERE id=?",
      [name, slug, description || null, image_url || null, req.params.id],
    );
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Slug already exists" });
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: delete category (unlinks products, does not delete them) ───────────
r.delete("/:id", auth(), adminOnly, async (req, res) => {
  try {
    await db.query(
      "UPDATE products SET category_id = NULL WHERE category_id = ?",
      [req.params.id],
    );
    await db.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

export default r;
