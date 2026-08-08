import { Router } from "express";
import { db } from "../config/db.js";
import { auth } from "../middleware/auth.js";

const r = Router();

r.get("/", auth(), async (req, res) => {
  const [products] = await db.query(
    `SELECT w.id, 'product' AS item_type, p.id AS product_id, p.name, p.slug, p.price, p.discount_price,
      (SELECT url FROM product_images WHERE product_id=p.id LIMIT 1) AS image_url
     FROM wishlist w JOIN products p ON p.id=w.product_id
     WHERE w.user_id=? AND w.item_type='product'`,
    [req.user.id],
  );

  const [sets] = await db.query(
    `SELECT w.id, 'discovery_set' AS item_type, ds.id AS discovery_set_id, ds.name, ds.slug,
      ds.price, NULL AS discount_price, ds.banner_image AS image_url,
      (SELECT COUNT(*) FROM discovery_set_items WHERE discovery_set_id=ds.id) AS product_count
     FROM wishlist w JOIN discovery_sets ds ON ds.id=w.discovery_set_id
     WHERE w.user_id=? AND w.item_type='discovery_set'`,
    [req.user.id],
  );

  res.json([...products, ...sets]);
});

r.post("/", auth(), async (req, res) => {
  const { item_type = "product", product_id, discovery_set_id } = req.body;
  if (item_type === "discovery_set") {
    await db.query(
      "INSERT IGNORE INTO wishlist (user_id, discovery_set_id, item_type) VALUES (?,?,'discovery_set')",
      [req.user.id, discovery_set_id],
    );
  } else {
    await db.query(
      "INSERT IGNORE INTO wishlist (user_id, product_id, item_type) VALUES (?,?,'product')",
      [req.user.id, product_id],
    );
  }
  res.json({ ok: true });
});

r.delete("/:product_id", auth(), async (req, res) => {
  await db.query(
    "DELETE FROM wishlist WHERE user_id=? AND product_id=? AND item_type='product'",
    [req.user.id, req.params.product_id],
  );
  res.json({ ok: true });
});

r.delete("/set/:discovery_set_id", auth(), async (req, res) => {
  await db.query(
    "DELETE FROM wishlist WHERE user_id=? AND discovery_set_id=? AND item_type='discovery_set'",
    [req.user.id, req.params.discovery_set_id],
  );
  res.json({ ok: true });
});

export default r;
