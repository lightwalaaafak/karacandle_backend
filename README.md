# Kara Candle — Backend (Node + Express + MySQL)

## Setup
1. `cp .env.example .env` and fill values
2. Create the MySQL database using `/database/schema.sql`
3. `npm install`
4. `npm start`

## API
- `GET /api/health`
- `POST /api/auth/register` `/login` `/admin/login`
- `GET /api/products` `?collection=&search=&sort=&featured=1&best_seller=1`
- `GET /api/products/:slug`
- `GET /api/collections` `/:slug`
- `GET/POST/PUT/DELETE /api/cart`
- `GET/POST/DELETE /api/wishlist`
- `POST /api/orders` `GET /api/orders/me` `GET /api/orders/:id`
- `POST /api/payments/razorpay/order` `/verify`
- `POST /api/payments/stripe/checkout`
- `POST /api/reviews`
- `POST /api/coupons/validate`
- `GET /api/cms/banners` `/sections`
- `GET /api/admin/stats` `/users`
