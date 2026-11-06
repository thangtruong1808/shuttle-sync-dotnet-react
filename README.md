# Shuttle Sync

Shuttle Sync is a badminton court booking platform. Players find a free court, join a public social, pay with Stripe, and spend reward points. Venue staff run courts, prices, closures, promotions, and incentives from a dashboard. An on-site assistant uses live availability, rather than invented times, to walk a player through a booking.

The browser app is React 18, TypeScript, and Vite. The API is ASP.NET Core on .NET 10 with MySQL. Images go to Cloudinary. Court artwork and the booking assistant use Gemini. Sign-in can use email, Google, or GitHub.

## What a player can do

- Search a venue, see which courts are free, and book a session
- Hold a court and pay now, or pay later when the session is more than 24 hours away
- Join a public social, add friends, and waitlist a full session
- Apply a promotion code and redeem reward points
- Read business hours, rewards, and the cancellation rules
- Ask the assistant for a court. It asks for duration, then a start time, then offers courts the API returned

## What staff can do

- Manage venue details, courts, slots, hourly rates, and reward incentives
- Close a court or the whole venue for one block of time, or for the same hours every day
- Review bookings, payments, promotions, users, and activity

## Local development

Install Node.js 22, the .NET 10 SDK, and MySQL 8.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill in `backend/.env`. These values are required for the API process to start:

| Variable | Purpose |
| --- | --- |
| `ConnectionStrings__Default` | MySQL connection string |
| `JWT_SIGNING_KEY` | At least 32 characters. Use a key that is not the one from any deployed server |
| `JWT_ISSUER` | Token issuer, for example `shuttle-sync` |
| `JWT_AUDIENCE` | Token audience, for example `shuttle-sync-web` |
| `ACCESS_TOKEN_MINUTES` | Access-token lifetime |
| `REFRESH_TOKEN_DAYS` | Refresh-token lifetime |

Leave `frontend/.env` as `VITE_API_URL=` so the Vite dev server proxies `/api` to the API. Set `ASPNETCORE_ENVIRONMENT=Development` in `backend/.env` if you want that file loaded. The API reads `backend/.env` only in Development. Production reads real environment variables and does not open that file.

Create the `shuttle_sync` database and apply `database/schema/shuttle-sync_schema.sql` from a working copy. That folder is gitignored.

```bash
npm install
npm run dev
```

The API listens on `http://localhost:5284`. The site listens on `http://localhost:5173`.

Optional integrations, each left blank until you have an account:

| Variables | Feature that stays off when they are empty |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google sign-in |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` | GitHub sign-in |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Profile photos and court images |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card checkout. Use test keys for a demo |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Booking assistant and generated court artwork |

`COOKIE_SECURE=true` needs HTTPS. Local HTTP can use `false`. `FRONTEND_ORIGIN` is the site origin with no trailing slash, such as `http://localhost:5173`.

## Production

A push to `main` builds the API image, pushes it to GitHub Container Registry, builds the static site with an empty `VITE_API_URL`, and copies both onto the VPS.

| Path on the server | Contents |
| --- | --- |
| `/opt/projects/badminton-booking-ai/docker-compose.yml` | API container definition, copied by the workflow |
| `/opt/projects/badminton-booking-ai/.env` | Production variables. Never committed |
| `/opt/projects/badminton-booking-ai/www` | Built frontend |
| `/opt/backups/badminton-booking-ai` | Database dumps |

The API container publishes `127.0.0.1:8080` only. From inside that container, MySQL on the host is `host.docker.internal`. Nginx on the same machine is the public HTTPS entry: it serves `www` and proxies `/api` to port 8080, so the browser stays on one origin and the session cookies keep working.

GitHub Actions needs three repository secrets:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | Server address |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Private deploy key, the file without a `.pub` suffix |

`deploy/api.env.example` lists every production variable name. On the server those values live in `/opt/projects/badminton-booking-ai/.env`. `JWT_SIGNING_KEY` on the server must be its own 32+ character string. The names and the reason for each one are the tables in Local development above. Set `ASPNETCORE_ENVIRONMENT=Production`, `PORT=8080`, and `COOKIE_SECURE=true` once the site is served over HTTPS. `FRONTEND_ORIGIN` is the public `https` origin. OAuth redirect URIs use that same origin plus `/api/auth/google/callback` or `/api/auth/github/callback`. The Stripe webhook path is `/api/stripe/webhook`.

The first deploy stops if `.env` is not on the server yet.

## Repository layout

| Path | Role |
| --- | --- |
| `frontend/` | React application |
| `backend/` | ASP.NET Core API |
| `deploy/` | Compose file and the production variable template |
| `.github/workflows/deploy.yml` | Build and deploy on `main` |
| `backend/Dockerfile` | API image |
