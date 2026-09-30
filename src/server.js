// backend/src/server.js

import "dotenv/config";

import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import categoryRoutes from "./routes/categories.js";
import collectionRoutes from "./routes/collections.js";
import cartRoutes from "./routes/cart.js";
import wishlistRoutes from "./routes/wishlist.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes, { stripeWebhookHandler } from "./routes/payments.js";
import reviewRoutes from "./routes/reviews.js";
import couponRoutes from "./routes/coupons.js";
import cmsRoutes from "./routes/cms.js";
import adminRoutes from "./routes/admin.js";
import customOrdersRouter from "./routes/custom-orders.js";
import offersRouter from "./routes/offers.js";
import discoverySetRoutes from "./routes/discovery-sets.js";
import contactRoutes from "./routes/contact.js";
import discoveryPackRoutes from "./routes/discovery-pack.js";

import { initSocket } from "./socket.js";

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

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS blocked: " + origin));
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.options("*", cors());

// --------------------------------------------------
// STRIPE WEBHOOK — must be registered BEFORE express.json()
// --------------------------------------------------
// Stripe signs the exact raw bytes of the request body. If express.json()
// runs first, the body is already parsed/re-serialized and the signature
// check in stripeWebhookHandler will always fail. So this one route gets
// its own raw-body parser and is mounted directly on `app`, ahead of the
// global json() middleware below — it is deliberately NOT part of the
// paymentRoutes router (which is mounted after json() further down).
app.post(
  "/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

app.use(express.json({ limit: "5mb" }));

app.use(morgan("tiny"));

app.use(
  "/api/",
  rateLimit({
    windowMs: 60_000,
    max: 200,
  }),
);

const uploadsPath = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "uploads");

app.use("/uploads", express.static(uploadsPath));

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/api/health", (_, res) =>
  res.json({
    ok: true,
    name: "Kara Candle API",
  }),
);

// --------------------------------------------------
// API ROUTES
// --------------------------------------------------

app.use("/api/auth", authRoutes);

app.use("/api/products", productRoutes);

app.use("/api/categories", categoryRoutes);

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

app.use("/api/discovery-sets", discoverySetRoutes);

app.use("/api/discovery-pack", discoveryPackRoutes); //new updated discovery pack route
// --------------------------------------------------
// CONTACT FORM
// --------------------------------------------------

app.use("/api/contact", contactRoutes);

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("API ERROR:", err);

  res.status(err.status || 500).json({
    error: err.message || "Server error",
  });
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

// Socket.IO
const httpServer = http.createServer(app);

initSocket(httpServer, allowedOrigins);

httpServer.listen(PORT, () => {
  console.log(`Kara Candle API running on port ${PORT}`);
});
