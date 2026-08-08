import { Router } from "express";
import { db } from "../config/db.js";
import { auth, adminOnly } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const r = Router();

// ── Public: list all active discovery sets ───────────────────────────────────
r.get("/", async (_, res) => {
  try {
    const [sets] = await db.query(
      `SELECT * FROM discovery_sets WHERE is_active=1 ORDER BY display_order, created_at DESC`,
    );
    for (const s of sets) {
      const [items] = await db.query(
        `SELECT dsi.display_order, p.id, p.name, p.slug, p.price, p.discount_price,
           p.description, p.fragrance_notes, p.burn_time,
           (SELECT url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC LIMIT 1) AS image_url,
           col.name AS collection_name
         FROM discovery_set_items dsi
         JOIN products p ON p.id = dsi.product_id
         LEFT JOIN collections col ON col.id = p.collection_id
         WHERE dsi.discovery_set_id = ?
         ORDER BY dsi.display_order`,
        [s.id],
      );
      s.products = items;
    }
    res.json(sets);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Public: single discovery set by slug ─────────────────────────────────────
r.get("/:slug", async (req, res) => {
  try {
    const [[set]] = await db.query(
      `SELECT * FROM discovery_sets WHERE slug=? AND is_active=1`,
      [req.params.slug],
    );
    if (!set) return res.status(404).json({ error: "Not found" });

    const [items] = await db.query(
      `SELECT dsi.display_order, p.id, p.name, p.slug, p.price, p.discount_price,
         p.description, p.fragrance_notes, p.burn_time,
         (SELECT url FROM product_images WHERE product_id=p.id ORDER BY is_primary DESC LIMIT 1) AS image_url,
         col.name AS collection_name
       FROM discovery_set_items dsi
       JOIN products p ON p.id = dsi.product_id
       LEFT JOIN collections col ON col.id = p.collection_id
       WHERE dsi.discovery_set_id = ?
       ORDER BY dsi.display_order`,
      [set.id],
    );
    set.products = items;
    res.json(set);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: list all (including inactive) ─────────────────────────────────────
r.get("/admin/all", auth(), adminOnly, async (_, res) => {
  try {
    const [sets] = await db.query(
      `SELECT * FROM discovery_sets ORDER BY display_order, created_at DESC`,
    );
    for (const s of sets) {
      const [items] = await db.query(
        `SELECT dsi.product_id, dsi.display_order, p.name
         FROM discovery_set_items dsi
         JOIN products p ON p.id = dsi.product_id
         WHERE dsi.discovery_set_id = ?
         ORDER BY dsi.display_order`,
        [s.id],
      );
      s.product_ids = items.map((i) => i.product_id);
      s.products = items;
    }
    res.json(sets);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── Admin: create ─────────────────────────────────────────────────────────────
r.post(
  "/",
  auth(),
  adminOnly,
  upload.single("banner_image"),
  async (req, res) => {
    const {
      name,
      slug,
      description,
      price,
      is_active,
      display_order,
      product_ids,
    } = req.body;
    if (!name || !slug)
      return res.status(400).json({ error: "name and slug required" });

    const base = process.env.PUBLIC_URL || "";
    const banner_image = req.file
      ? `${base}/uploads/${req.file.filename}`
      : req.body.banner_image || null;

    try {
      const [result] = await db.query(
        `INSERT INTO discovery_sets (name, slug, description, price, banner_image, is_active, display_order)
       VALUES (?,?,?,?,?,?,?)`,
        [
          name,
          slug,
          description || null,
          price || 0,
          banner_image,
          is_active !== undefined
            ? is_active == "true" || is_active == 1
              ? 1
              : 0
            : 1,
          display_order || 0,
        ],
      );
      const setId = result.insertId;

      // Insert product links
      const ids = Array.isArray(product_ids)
        ? product_ids
        : product_ids
          ? JSON.parse(product_ids)
          : [];

      for (let i = 0; i < ids.length; i++) {
        await db.query(
          `INSERT INTO discovery_set_items (discovery_set_id, product_id, display_order) VALUES (?,?,?)`,
          [setId, ids[i], i],
        );
      }

      res.json({ id: setId });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "Slug already exists" });
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// ── Admin: update ─────────────────────────────────────────────────────────────
r.put(
  "/:id",
  auth(),
  adminOnly,
  upload.single("banner_image"),
  async (req, res) => {
    const {
      name,
      slug,
      description,
      price,
      is_active,
      display_order,
      product_ids,
    } = req.body;

    const base = process.env.PUBLIC_URL || "";
    const banner_image = req.file
      ? `${base}/uploads/${req.file.filename}`
      : req.body.banner_image;

    try {
      const fields = [];
      const vals = [];

      if (name !== undefined) {
        fields.push("name=?");
        vals.push(name);
      }
      if (slug !== undefined) {
        fields.push("slug=?");
        vals.push(slug);
      }
      if (description !== undefined) {
        fields.push("description=?");
        vals.push(description || null);
      }
      if (price !== undefined) {
        fields.push("price=?");
        vals.push(price);
      }
      if (banner_image !== undefined) {
        fields.push("banner_image=?");
        vals.push(banner_image);
      }
      if (is_active !== undefined) {
        fields.push("is_active=?");
        vals.push(is_active == "true" || is_active == 1 ? 1 : 0);
      }
      if (display_order !== undefined) {
        fields.push("display_order=?");
        vals.push(display_order);
      }

      if (fields.length) {
        vals.push(req.params.id);
        await db.query(
          `UPDATE discovery_sets SET ${fields.join(",")} WHERE id=?`,
          vals,
        );
      }

      // Replace product links if provided
      if (product_ids !== undefined) {
        const ids = Array.isArray(product_ids)
          ? product_ids
          : product_ids
            ? JSON.parse(product_ids)
            : [];

        await db.query(
          `DELETE FROM discovery_set_items WHERE discovery_set_id=?`,
          [req.params.id],
        );
        for (let i = 0; i < ids.length; i++) {
          await db.query(
            `INSERT INTO discovery_set_items (discovery_set_id, product_id, display_order) VALUES (?,?,?)`,
            [req.params.id, ids[i], i],
          );
        }
      }

      res.json({ ok: true });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "Slug already exists" });
      console.error(e);
      res.status(500).json({ error: "Server error" });
    }
  },
);

// ── Admin: delete ─────────────────────────────────────────────────────────────
r.delete("/:id", auth(), adminOnly, async (req, res) => {
  try {
    await db.query(`DELETE FROM discovery_sets WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

export default r;
