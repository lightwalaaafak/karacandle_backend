import { Router } from "express";
import { db } from "../config/db.js";
import { auth } from "../middleware/auth.js";
const r = Router();

r.get("/", auth(), async (req, res) => {
  const [rows] = await db.query(
    `
    SELECT c.id, c.quantity, p.id AS product_id, p.name, p.slug, p.price, p.discount_price, p.stock,
      (SELECT url FROM product_images WHERE product_id=p.id LIMIT 1) AS image_url
    FROM cart c JOIN products p ON p.id=c.product_id WHERE c.user_id=?
  `,
    [req.user.id],
  );
  res.json(rows);
});

r.post("/", auth(), async (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  await db.query(
    `
    INSERT INTO cart (user_id, product_id, quantity) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,
    [req.user.id, product_id, quantity],
  );
  res.json({ ok: true });
});

r.put("/:id", auth(), async (req, res) => {
  await db.query("UPDATE cart SET quantity=? WHERE id=? AND user_id=?", [
    req.body.quantity,
    req.params.id,
    req.user.id,
  ]);
  res.json({ ok: true });
});

r.delete("/:id", auth(), async (req, res) => {
  await db.query("DELETE FROM cart WHERE id=? AND user_id=?", [
    req.params.id,
    req.user.id,
  ]);
  res.json({ ok: true });
});

export default r;
