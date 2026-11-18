# Genie Sevai — API

The REST API for **Genie Sevai**, a home-services platform. It serves the [customer web app](https://github.com/iamselva3/genie-sevai-frontend) and the [admin panel + professional portal](https://github.com/iamselva3/genie-sevai-admin).

Stack: Node, Express 5, MongoDB (Mongoose), Zod validation, JWT, TypeScript, and Jest + Supertest.

## Run

```bash
npm install
npm run dev:memory   # no MongoDB needed: in-memory database, seeded with demo data, on :5100
```

With a real database:

```bash
cp .env.example .env               # set MONGO_URI, JWT_SECRET, CORS_ORIGIN...
docker compose up -d mongo         # optional local MongoDB (or use Atlas)
npm run dev                        # watch mode
npm run seed                       # seed an empty database (add -- --reset to wipe first)
npm run build && npm start         # production
npm test                           # 65 tests on an in-memory MongoDB
npm run typecheck
```

An empty database is seeded on start-up outside production (`SEED_ON_BOOT`). The seed contains:
- 6 cities (Salem is switched off)
- 10 categories and 63 services (one is unavailable, one hidden, one limited to certain cities)
- 101 professionals
- 3 coupons: `WELCOME100`, `GENIE20`, `COOL200`
- 4 home page banners (two services, two coupons) in solid colours, using built-in illustrations
- staff accounts and a few demo bookings

### Demo logins

| Who | Login |
| --- | --- |
| Admin | `admin@sevai.in` / `Admin@12345` (change with `ADMIN_EMAIL` / `ADMIN_PASSWORD`) |
| Manager | `ops@sevai.in` / `Ops@12345` |
| Professional | `9000000001` / `Pro@12345`; every seeded pro uses `Pro@12345` |
| Customer | any mobile number via OTP. Outside production the code is returned as `devCode` and printed to the log |

## API (`/api/v1`)

| Area | Endpoints |
| --- | --- |
| Catalogue | `GET /cities`, `/catalog/home?city=` (categories, live banners, shelves), `/catalog/categories`, `/catalog/categories/:slug`, `/catalog/services/:slug`, `/catalog/search?q=`, `/slots?city=&category=`, `/coupons` |
| Customer auth | `POST /auth/otp/send`, `POST /auth/otp/verify` |
| Profile | `GET/PATCH /me`, `POST/PATCH/DELETE /me/addresses/:id` |
| Bookings | `POST /bookings/quote`, `POST /bookings`, `GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/cancel`, `/reschedule`, `/review` |
| Support | `POST /enquiries`, `POST /pro-applications` |
| Professional portal | `POST /pro/auth/login`, `GET /pro/me`, `GET /pro/jobs?scope=active\|history`, `POST /pro/jobs/:id/status` (starting a job needs the customer's PIN) |
| Admin | `POST /admin/auth/login`; dashboard; categories, services (`PATCH /admin/services/:id/status`: active / unavailable / hidden), cities; bookings (eligible professionals, assign, unassign, status, cancel, reschedule); professionals, customers, coupons, reviews, enquiries, applications, staff; banners (`/admin/banners`, `POST /admin/banners/reorder`) |
| Uploads | `POST /admin/uploads`: the request body is the picture (`Content-Type` PNG, JPEG, WebP or AVIF, up to 3 MB). It returns `{ url: '/uploads/<name>' }`, served publicly from the API host with a one-year cache |

Business rules live in `src/services/`:
- `pricing.ts`: quotes, coupons, visit fee.
- `slots.ts`: availability from professional capacity.
- `banners.ts`: which banners a customer sees. A banner must be switched on, inside its start/end dates and meant for the customer's city (or all cities). A banner is dropped when the service, category or coupon it points to is no longer available.
- `bookingFlow.ts`: status transitions, PIN start, and assignment checks (same city, trained for the category, no clashing job, with a travel buffer).

Booking codes look like `GS7K2Q9P`.

## Going live

- Set `NODE_ENV=production`, a long random `JWT_SECRET`, `MONGO_URI`, `CORS_ORIGIN` (the web app and admin origins), and `SEED_ON_BOOT=false`.
- Connect an SMS gateway in `src/services/otp.ts` (`deliver`). In production, codes are never returned or logged.
- Change the seeded staff passwords.
- Uploaded pictures are written to `UPLOAD_DIR` (default `./uploads`). On hosts with a temporary disk, mount a persistent volume there. Alternatively, put a CDN or object storage in front and use https picture links in banners.
