// backend/src/server.js  ← UPDATED: added /api/categories route

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import categoryRoutes from "./routes/categories.js"; // ← NEW
import collectionRoutes from "./routes/collections.js";
import cartRoutes from "./routes/cart.js";
import wishlistRoutes from "./routes/wishlist.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes from "./routes/payments.js";
import reviewRoutes from "./routes/reviews.js";
import couponRoutes from "./routes/coupons.js";
import cmsRoutes from "./routes/cms.js";
import adminRoutes from "./routes/admin.js";
import customOrdersRouter from "./routes/custom-orders.js";
import offersRouter from "./routes/offers.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const allowedOrigins = [
  "https://thekaracandle.com",
  "https://www.thekaracandle.com",
  "https://admin.thekaracandle.com",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.options("*", cors());
app.use(express.json({ limit: "5mb" }));
app.use(morgan("tiny"));
app.use("/api/", rateLimit({ windowMs: 60_000, max: 200 }));

// Replace the current static middleware with:
const uploadsPath = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");

app.use("/uploads", express.static(uploadsPath));

app.get("/api/health", (_, res) =>
  res.json({ ok: true, name: "Kara Candle API" }),
);

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes); // ← NEW
app.use("/api/collections", collectionRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/cms", cmsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/custom-orders", customOrdersRouter);
app.use("/api/offers", offersRouter);

app.use((err, req, res, next) => {
  console.error("API ERROR:", err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Kara Candle API on :${PORT}`));
