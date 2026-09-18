# Vivat Bus

Public passenger booking: `/book` or `/book/{tenant-slug}`. The Ukrainian page searches database-backed city pairs and departures, then creates a cash-on-boarding booking without login or an IBAN. Staff can open it from the profile menu. See [public booking](docs/public-booking.md) for API boundaries, migration and verification.

## Local Docker preview

Run the complete local stack (frontend, Go API, PostgreSQL, Redis, and migrations):

```powershell
docker compose up --build
```

The web BFF resolves the company slug from the authenticated Go session on every tenant-scoped call. `vivat-bus` remains only the local demo tenant and does not need to be compiled into a future customer's frontend deployment. The CRM shell also resolves the signed-in tenant, its saved logo and default accent/theme; a company without a logo receives a neutral route mark instead of another tenant's logo.

The interface customizer follows the same boundary: company owners set the shared logo, primary colour and default theme in **Настройки**, while each staff member’s accent, theme, density, radius, scale and sidebar layout are saved against their membership and follow them to another browser or device.

The local Compose API also creates three clearly marked future demo departures only when the local demo tenant has no future trips. This makes the Telegram booking flow testable immediately. Production Compose does not set this flag and never generates demo operational data.

Then open [http://localhost:3001](http://localhost:3001). Health checks:

```powershell
Invoke-WebRequest http://localhost:8080/healthz
Invoke-WebRequest http://localhost:8080/readyz
```

Run the non-destructive local acceptance check after a rebuild. It verifies API health, protected CRM routes, the authenticated CRM BFF, and an owner/driver role boundary without printing credentials:

```powershell
.\scripts\verify-local.ps1
```

## Production Docker Compose

Use the separate `docker-compose.production.yml` on the server. It exposes only Caddy on ports 80/443; PostgreSQL, Redis, the Go API, and Next.js remain on the private Compose network. Caddy terminates HTTPS and keeps certificates in persistent Docker volumes, which is required for the phone PWA and GPS permission flow.

1. Point the public DNS record for the chosen CRM domain to the server and open ports 80 and 443 in the firewall.
2. Copy `.env.production.example` to a private `.env.production` on the server and replace every placeholder with unique secrets. Set `VIVAT_DOMAIN` to the actual domain. Use URL-safe `POSTGRES_PASSWORD` and `REDIS_PASSWORD` values (letters, digits, `-` and `_`) because the API and bot receive them inside connection URLs.
3. Start the product from the repository root:

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build --remove-orphans
```

4. When the Telegram token has been set, include the bot profile:

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml --profile bot up -d --build --remove-orphans
```

Caddy issues and renews certificates automatically once DNS and public ports are correct. Do not expose database or Redis ports on the host; Redis also requires its private production password. Before every server update, take a PostgreSQL backup and verify it can be restored in a separate database:

If the VPS already uses Coolify's Traefik proxy on ports 80/443, do not run a second public Caddy instance. Use the supplied override instead; it joins only the web service to the existing `coolify` network, routes the configured `VIVAT_DOMAIN`, and lets the existing proxy manage HTTPS:

```sh
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.vps.yml \
  --profile bot up -d --build --remove-orphans
```

```sh
mkdir -p /srv/vivat-backups
sh deploy/backup-postgres.sh /srv/vivat-backups/vivat-$(date +%F).dump
```

The helper refuses to overwrite a dump and writes it with owner-only permissions. Restore in a separate verification database first with `pg_restore --clean --if-exists --no-owner`.

### GitHub deployment

The repository contains `.github/workflows/deploy.yml`. A push to `main` (or **Run workflow**) securely synchronizes the source to the server and runs the production Compose stack. It uses `docker-compose.vps.yml`, so it is ready for the existing Coolify/Traefik VPS proxy and does not bind a second process to ports 80/443. Create a protected GitHub Environment named `production` and add these GitHub Secrets:

- `DEPLOY_HOST` — server hostname or IP;
- `DEPLOY_USER` — non-root SSH user allowed to run Docker;
- `DEPLOY_PATH` — absolute server directory that contains the private `.env.production` file;
- `DEPLOY_SSH_KEY` — deploy-only private SSH key;
- `DEPLOY_KNOWN_HOSTS` — the exact server host key from `ssh-keyscan`, reviewed before saving.

The workflow deliberately excludes `.env.production` from synchronization, so server credentials and Telegram tokens are never copied from GitHub. The first deployment directory and its private environment file must be created on the server manually; subsequent deployments are one push to `main`.

## Local access and staff roles

The web console is protected by an HttpOnly session cookie. Before starting a shared or server deployment, copy `.env.example` to `.env` and set your own `BOOTSTRAP_OWNER_EMAIL` and strong `BOOTSTRAP_OWNER_PASSWORD`; the initial password must have at least 12 characters. For HTTPS deployments set `SESSION_COOKIE_SECURE=true`.

If a local bootstrap password was changed after the first start, set `BOOTSTRAP_OWNER_RESET_PASSWORD=true` together with the intended password for exactly one `docker compose up -d --build api` run. It revokes that owner's sessions and replaces the password. Set the flag back to `false` immediately afterwards; it is deliberately opt-in and disabled in production by default.

Authentication is rate-limited in Redis per company, email, and connection source: after 8 failed attempts, the account path is paused for 15 minutes. A successful login clears prior failed attempts. The web and API set `nosniff`, frame-denial, no-referrer, restrictive permissions, and same-site resource headers. TLS termination should also set HSTS at the public reverse proxy; the Go API adds it automatically when it receives a TLS request directly.

After signing in, the owner or administrator can open [Команда](http://localhost:3001/team) to add staff and assign roles:

- **Владелец** — full company control, including other owners;
- **Администратор** — operations and company configuration;
- **Диспетчер** — trips, bookings, routes, customers, and fleet operations;
- **Водитель** — only trip status and GPS telemetry.

An administrator cannot change an owner or administrator. Deactivating a staff member immediately revokes their active sessions; the company cannot lose its final active owner.

The current local API slice is tenant-aware and includes:

- `GET /api/v1/tenants/vivat-bus/trips?date=YYYY-MM-DD`
- `GET /api/v1/tenants/vivat-bus/dashboard`
- `GET /api/v1/tenants/vivat-bus/trip-resources`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/fleet`
- `POST /api/v1/tenants/vivat-bus/trips`
- `PATCH /api/v1/tenants/vivat-bus/trips/{tripID}`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/customers`
- `POST /api/v1/tenants/vivat-bus/customers/import`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/custom-fields`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/team`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/bookings`
- `POST /api/v1/tenants/vivat-bus/gps-points`
- `GET`, `POST`, `PATCH /api/v1/tenants/vivat-bus/routes`
- `GET`, `POST`, `DELETE /api/v1/tenants/vivat-bus/availability-blocks`
- `GET /api/v1/tenants/vivat-bus/finance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /api/v1/tenants/vivat-bus/finance/driver-cash`
- `GET /api/v1/tenants/vivat-bus/driver/cash-summary`
- `POST /api/v1/tenants/vivat-bus/driver/cash-received`

Trip creation uses the tenant's timezone, derives vehicle capacity and base currency from PostgreSQL, accepts a dispatcher-entered price per passenger or per booking, and rejects overlapping active assignments for either the vehicle or driver. Regular route templates can also carry a default price and pricing mode that are prefilled when the route is selected; the dispatcher can still change both for the individual departure. The final price is copied to every booking as a financial snapshot, so later changes to a route or trip do not rewrite historical revenue.
Status updates allow only the dispatch workflow `new → assigned → in_progress → completed` or cancellation.

The overview is a live tenant-scoped operational summary for the company’s local day: scheduled trips, booked passengers, active fleet, expected booking revenue, the next departures, and each active vehicle’s booked-seat load. It intentionally shows an empty state when there are no current-day trips instead of fabricated dashboard metrics.

The desktop trip planner renders every active vehicle, including free vehicles with no trip that day. A dispatcher can drag a draft, new, or assigned trip onto another vehicle and a 15-minute time slot; the current driver is kept, and the Go API rejects any resulting vehicle or driver overlap.

For a regular route, the planner can also create a weekly schedule through a chosen end date and weekday set. The server creates from 1 to 90 departures atomically: an unavailable period or a vehicle/driver conflict rejects the entire series, so a partial timetable is never left in the database.

## SaaS subscription boundary

`trial` and `active` tenants may create or edit working data. For `past_due` and `suspended`, the API returns `402 Payment Required` for new trips, routes, customers, imports, bookings, manager cash entries, and branding changes. Read access, GPS telemetry, a driver’s exact cash-receipt confirmation for an already active trip, and in-progress trip status changes remain available so that passengers, vehicles, and money already collected are not left without an operational record.

The future central subscription backend can provision a company through `POST /api/v1/control/tenants`, then update its entitlement through `PUT /api/v1/tenants/{slug}/subscription`. Set a unique `SAAS_CONTROL_SECRET` in `.env` and send it in `X-SaaS-Control-Token`; provisioning atomically creates the tenant, branding and owner membership, and safely replays by slug. A new owner needs a password of at least 12 characters; an already known user is attached without changing their credential. Subscription changes are stored in `subscription_events`, and `externalEventId` makes retries idempotent. Both control endpoints are intentionally unavailable when the secret is absent.

Dispatcher fleet view: [http://localhost:3001/fleet](http://localhost:3001/fleet). Owners and administrators can add, update, temporarily deactivate, and reactivate vehicles there. Deactivation is rejected while a vehicle has an assigned or in-progress trip. The page includes an interactive Leaflet/OpenStreetMap map with drag, zoom, touch controls and a popup for every reporting vehicle; precise coordinates, accuracy, and freshness remain visible in the vehicle list.

The phone-first driver GPS page is [http://localhost:3001/driver](http://localhost:3001/driver). It is an installable PWA: open it over HTTPS in a phone browser and choose **Add to Home Screen** / **Install app**. The app includes a service-worker offline screen and stores up to 5,000 unsent GPS points in membership-scoped IndexedDB; acknowledged points are removed individually and transient failures retry with backoff. The server deduplicates retried points. See [GPS operation, migration and acceptance checks](docs/gps-pwa.md) for screen-lock limitations and recovery behavior. Only public application assets are cached — CRM pages and passenger data are not stored in the PWA cache. Add a driver from the **Команда** screen with their international phone number: this creates a linked driver profile. A driver session sees only its assigned vehicle and can transmit GPS only for its own assigned or in-progress trip. It asks for the browser's location permission only after the driver presses a transmission button. During an active trip it also shows the exact cash-on-boarding total; **«Деньги получены»** records that exact amount once in the driver cash ledger. A trip with cash-on-boarding bookings cannot be completed until the receipt is confirmed, and both cash and paid bookings become completed with the trip. Telegram launch authentication remains a separate integration step.

Finance view: [http://localhost:3001/finance](http://localhost:3001/finance). It reads confirmed booking revenue and driver cash directly from PostgreSQL, records fuel, driver-pay, amortisation, marketing, and other operational expenses, and shows net profit in the tenant's base currency. Cash and expenses can be recorded in EUR or UAH; the report keeps a separate complete total for each currency and never silently mixes or converts them. The cash ledger also shows every driver's current outstanding balance across the entire cash history, so a manager can record a precise hand-in to the company cash desk. A manager can manually confirm a bank transfer; the booking then becomes confirmed and the linked payment becomes paid.

The dispatcher booking journal is [http://localhost:3001/bookings](http://localhost:3001/bookings). It filters by passenger, route, status, and trip date, and lets a dispatcher create a manual cash-on-boarding booking by choosing the trip, booking contact, seats, the actual passenger's name, international phone and date of birth, plus the tenant's configured booking fields. The actual passenger can differ from the booking contact; their data are preserved on the booking. The trip's total price and currency are captured as an immutable booking snapshot. Cancellation is transactional: it is blocked once a trip is underway and otherwise returns the seats to the trip immediately.

Individual-transfer enquiries from Telegram are collected separately at [http://localhost:3001/requests](http://localhost:3001/requests). The passenger chooses pickup, destination, future date and time, passenger data, quantity and an optional comment; no unagreed price or payment is created. A dispatcher can add an internal note, take the enquiry into work, close it after arranging the trip in the planner, or reject it. Each transition is tenant-scoped and validated by the Go API; a changed status is queued transactionally for delivery back to the originating Telegram chat.

PostgreSQL also enforces one active (`pending`, `awaiting_payment`, `cash_on_boarding`, or `confirmed`) booking per passenger and trip. New bookings are accepted only while a trip is `new` or `assigned`; boarding and an active trip close sales at the server boundary. A bank-transfer hold expires after 30 minutes and then releases its seats. While the Telegram bot is running it sweeps expired holds once a minute and marks the matching uncompleted internal payment as cancelled; retrying a booking also performs that cleanup within the same transaction. This protects against duplicate Telegram updates, double clicks, and concurrent requests; after an expiry or cancellation the passenger may book the trip again.

The company settings screen includes typed, tenant-scoped fields for customers, trips, and bookings: text, number, date, boolean, or a controlled list. Values are validated by the Go API and stored in PostgreSQL JSONB. Trip fields appear in the dispatcher trip form; booking fields appear in the manual-booking form and are collected by Telegram when configured as required.

Customer import accepts `.csv` and `.xlsx` files up to 10 MB / 5,000 rows. It recognises Russian and English headers, BOM, comma/semicolon/tab CSV delimiters, and upserts by international phone number. Custom customer fields may be supplied as columns named either by their stable key or their visible label; import validates their type and reports invalid rows without discarding valid ones. At most 100 row-level issues are returned in one response to keep large imports responsive.

The **Клиенты** screen also exports the complete tenant customer base as `.xlsx`, including fixed CRM columns and every configured or imported custom field. This is a server-side export, so it is not limited by the current search or the visible page of results.

Availability is managed at [http://localhost:3001/availability](http://localhost:3001/availability). A block can be global or assigned to one regular route. It prevents new trip planning and hides matching blocked trips from Telegram booking search and suggested alternative dates.

## Telegram booking bot

The bot is a separate Go process in the same Compose project. It is intentionally behind the optional `bot` profile, so the standard local stack runs without a Telegram secret. Add `TELEGRAM_BOT_TOKEN` and `BOT_TENANT_SLUG` to `.env`, then start it with:

```powershell
docker compose --profile bot up --build -d
```

For SaaS mode, one bot container can run several company bots safely. Set `TELEGRAM_BOTS_JSON` to a private JSON array of `{ "token", "tenantSlug" }` bindings; every tenant must appear once and every token must be unique. This supersedes the legacy single-bot variables, while leaving them supported for a simple local installation. Redis booking state is namespaced by tenant, so the same Telegram customer cannot mix booking sessions between companies.

## Оплата в Telegram-боте

In **Settings → Payment**, an owner or administrator enters the merchant name, Ukrainian IBAN, EDRPOU/INN, bank name and optional logo. No payment intermediary is used.

After a booking, the bot shows inline buttons **«Сплатити зараз»** and **«Оплатити при посадці»**. For a transfer it offers monobank, Приват24, ПУМБ, А-Банк and an additional-bank list, then sends a QR image and all payment details directly in Telegram. The QR uses the NBU payment-QR format and includes the IBAN, recipient, recipient code, amount and booking purpose. Bank transfer is available only in UAH; cash is available in the trip currency, including UAH and EUR. The bot records the selected payment method and bank; a manager confirms the received transfer from the CRM. A transfer hold expires after 30 minutes, while cash-on-boarding remains a separate unpaid booking status.

The Russian flow supports `/start` → route → inline calendar date selection → available trips → passenger name, phone and date of birth → passenger count → booking. A first-time customer may share their Telegram contact; a booking may be created for another passenger. The main menu also contains **«Мои поездки»** (the passenger's active and recent bookings, with safe inline cancellation before the trip starts) and **«Связь с диспетчером»**, configured in **Settings → Company**. Booking state is short-lived in Redis. If the company marked booking fields as required, the bot asks them in sequence before confirmation, including controlled-list and yes/no answers. If the requested date has no trip, the bot suggests dates from the next 14 days.

The main menu also offers **«Индивидуальный трансфер»**. This is an enquiry rather than a booking: the bot collects both points, an inline-calendar future date and time, passenger name, international phone, date of birth, passenger count and an optional note, then asks the passenger to confirm. The request is stored in PostgreSQL and appears in the dispatcher queue; a manager confirms availability and creates the actual individual trip only after agreeing its conditions.

When a dispatcher moves a booked trip to a new operational status, the API atomically queues a Telegram update for every linked paid or cash-on-boarding passenger. The bot delivers that durable queue with the route, departure time, vehicle, and driver contact; short Telegram outages or bot restarts therefore do not discard the update.

Stop it with:

```powershell
docker compose down
```
