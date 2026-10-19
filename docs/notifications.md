# Notifications and realtime

The profile at `/profile/notifications` contains a React Bits Pro notifications-3 delivery matrix for **Push and Telegram**, per-device Push enrollment and quiet hours. The bell uses notifications-6 with All/Unread filters, read-all and a notification-center link. CRM inboxes work even when both external channels are disabled. Drivers receive their assigned trip/booking events; dispatchers do not receive finance or team-access events; every inbox and socket is scoped to the authenticated membership/company.

Company settings have separate routes under `/settings`: company, payments, finance, fields and integrations. The shared secondary navigation also links personal, notification, security and app settings. Payment/integration secrets remain limited to owners and developers. The SaaS subscription state still controls access, but is no longer presented as a branding setting.

## Preferences and Telegram linking

- Migration `000040_notification_delivery` adds independent channel preferences for 12 events: booking created/changed/cancelled, request created/changed, trip assigned/changed/cancelled, payment received/failed/changed, and staff access changed. Cancellation/payment events recognize custom statuses through their semantic phase. Legacy category preferences seed the Push defaults; inbox history is independent of delivery preferences.
- Quiet hours select weekdays, local start/end and an IANA time zone. Overnight periods belong to their starting weekday, including DST transitions. Both channels defer until the end; explicit delivery tests bypass quiet hours. Delivery rechecks current membership, permissions and preferences before sending, and discards events older than 24 hours.
- An owner/developer first configures the company bot token in `/settings/integrations`. Each employee clicks **Connect Telegram** in their own profile, opens the generated bot link and presses Start. A random one-use token expires in ten minutes; only its SHA-256 hash is stored. The link is bound to the active company and membership and can only be claimed in a private chat through that company's bot. Re-linking replaces the connection and old pending jobs. Disconnecting deletes the connection, outstanding links and queued deliveries.
- The API never returns the bot token or chat ID to the profile. `getMe` runs only when creating a link. A separate leased worker sends Telegram messages with bounded timeouts and retries transient errors; a blocked bot removes the connection. Telegram outages cannot block CRM requests or Push delivery. Notifications contain generic event text and an allowlisted CRM link rather than passenger personal data.

## Delivery

- Migration `000031_notifications` captures changes from Go API, Telegram, imports and database writes using transactional triggers. Rolled-back writes do not generate events.
- PostgreSQL holds inboxes, subscription/session bindings, pending realtime events and durable delivery jobs. Two bounded Push consumers and one independent Telegram consumer use leased `SKIP LOCKED` claims, retry transient failures with backoff and discard expired jobs. Push HTTP 404/410 removes the device subscription. Preferences, permissions and session validity are checked before sending.
- Redis carries minimal entity invalidations, never customer records. WebSocket `/api/realtime` proxies to Go `/api/v1/realtime` using the HttpOnly session cookie, an explicit origin allowlist, bounded connections, heartbeat and session revalidation. Reconnect and periodic resynchronization cover missed Pub/Sub messages. The CRM refreshes data without resetting focused edits/dialogs/profile/settings forms.
- The service worker displays encrypted Web Push while CRM is closed, with stable notification tags and same-origin allowlisted click destinations. Native alerts do not include customer names, phone numbers or birth dates. Provider retries may replace the same tagged notification; exact-once delivery is not guaranteed by Web Push.
- Read/unread history and category preferences are persisted against the membership. Device subscriptions bind to one current membership and active session; account/company switches rebind the existing endpoint, and revoked/expired sessions cannot receive newly sent push. An already-sent provider message can still arrive after logout, so its payload is generic.
- Inbox retention is 90 days; delivered outbox records/jobs are cleaned after seven days. History uses cursor pagination.

## Deployment

Apply all migrations through **40 before starting the new API**. Migration 40 also removes the obsolete route-status tenant seed trigger left by migration 35, allowing creation of new companies. Coolify's Compose migration service uses the `maintenance` profile, so run migrations explicitly for an existing deployment. Local Compose runs them automatically. API startup fails clearly if notification tables are absent.

Use HTTPS, including `wss`, in production. `WS_ALLOWED_ORIGINS` must match the frontend origin exactly; comma-separated alternatives are accepted. `CORS_ORIGIN` is its fallback. WebSocket proxy URLs are compiled during the frontend build, so `API_INTERNAL_URL` is a Docker build argument as well as a runtime environment value. Coolify's API joins a private outbound network for push HTTPS traffic without exposing API ports.

The frontend's runtime `APP_ORIGIN` must also match its public HTTPS origin for notification mutations. Compose supplies this explicitly so CSRF checks do not mistake the reverse proxy's internal HTTP address for the public site. Direct local runs fall back to the request origin.

VAPID keys are generated once and stored in `push_configuration`. Back up this table with PostgreSQL and restrict DB access: the private key must never be returned through HTTP or committed. Optional `PUSH_VAPID_PUBLIC_KEY` and `PUSH_VAPID_PRIVATE_KEY` must both be supplied to the API and must form a valid key pair. All replicas must share the same keys. `PUSH_VAPID_SUBJECT` should be a monitored `mailto:` contact. Changing keys requires re-enrolling devices.

Only recognized HTTPS push provider domains are accepted (FCM, Mozilla, Apple and Windows). Push requires outbound network access to the browser's provider. iPhone users must install and open the PWA, then enable notifications in their profile. The OS/browser may delay or suppress notifications; CRM history remains the source of truth.

## Verification

```powershell
npm test
npm run typecheck
npm run build
cd backend
go test ./...
$env:NOTIFICATION_TEST_DATABASE_URL='postgres://testuser@127.0.0.1:55432/postgres?sslmode=disable'
go test ./cmd/api -run 'TestNotificationDeliveryPostgres|TestNotificationsPostgres' -v -count=1
```

Use a disposable PostgreSQL instance: integration tests create isolated schemas, apply all migrations and remove those schemas. Redis protocol behavior uses miniredis; encrypted Push and Telegram provider requests use fake HTTP transports, never actual subscribers. Tests cover company-bound/expired/replayed links, transactional events and rollback, custom cancellation statuses, retry, per-channel preferences, quiet hours and disconnect cleanup.

To test the production Next WebSocket proxy, build/start Next on port 3001 with an upstream URL `http://localhost:8080`, then set `NOTIFICATION_TEST_API_ADDRESS=127.0.0.1:8080` and `NOTIFICATION_TEST_FRONTEND_URL=http://localhost:3001` for the same Go integration test. This checks real upgrade/auth/origin/tenant/driver boundaries through Next.

Finally verify on an actual phone: install PWA, enable push and use its profile's push test. Then close the PWA, generate an eligible booking/request/trip/payment event from a second session/device, and open the notification on the first phone. Automated encryption/queue tests are not proof of OS notification delivery.
