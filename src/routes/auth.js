import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../config/db.js";

const r = Router();

r.post("/register", async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Missing fields" });
  const hash = await bcrypt.hash(password, 10);
  try {
    const [result] = await db.query(
      "INSERT INTO users (name, email, password_hash, phone) VALUES (?,?,?,?)",
      [name, email, hash, phone || null],
    );
    const token = jwt.sign(
      { id: result.insertId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );
    res.json({ token, user: { id: result.insertId, name, email } });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Server error" });
  }
});

r.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN },
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
  });
});

r.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await db.query("SELECT * FROM admin_users WHERE email=?", [
    email,
  ]);
  const admin = rows[0];
  if (!admin || !(await bcrypt.compare(password, admin.password_hash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role, isAdmin: true },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );
  res.json({
    token,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  });
});

r.post("/admin/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "Missing fields" });
  if (password.length < 8)
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });

  // Only allow if no admins exist yet, OR require a superadmin invite token
  // For now: restrict to a whitelist domain or a secret signup key
  const ADMIN_SIGNUP_SECRET = process.env.ADMIN_SIGNUP_SECRET;
  const { secret } = req.body;
  if (ADMIN_SIGNUP_SECRET && secret !== ADMIN_SIGNUP_SECRET)
    return res.status(403).json({ error: "Invalid signup secret" });

  const hash = await bcrypt.hash(password, 10);
  try {
    const [result] = await db.query(
      "INSERT INTO admin_users (name, email, password_hash, role) VALUES (?,?,?,?)",
      [name, email, hash, "admin"],
    );
    const token = jwt.sign(
      { id: result.insertId, email, role: "admin", isAdmin: true },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );
    res.json({
      token,
      admin: { id: result.insertId, name, email, role: "admin" },
    });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Server error" });
  }
});
export default r;
