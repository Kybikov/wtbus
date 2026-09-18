# Notifications and realtime

The profile contains notification categories and explicit per-device push enrollment. CRM inboxes work even when push is blocked. Drivers receive their assigned trip/booking events; dispatchers do not receive finance events; every inbox and socket is scoped to the authenticated membership/company.

## Delivery

- Migration `000031_notifications` captures changes from Go API, Telegram, imports and database writes using transactional triggers. Rolled-back writes do not generate events.
- PostgreSQL holds inboxes, subscription/session bindings, pending realtime events and durable push jobs. Four bounded push consumers use leased `SKIP LOCKED` claims, retry transient failures with backoff, discard expired jobs and remove HTTP 404/410 subscriptions. Preferences and session validity are checked before sending.
- Redis carries minimal entity invalidations, never customer records. WebSocket `/api/realtime` proxies to Go `/api/v1/realtime` using the HttpOnly session cookie, an explicit origin allowlist, bounded connections, heartbeat and session revalidation. Reconnect and periodic resynchronization cover missed Pub/Sub messages. The CRM refreshes data without resetting focused edits/dialogs/profile/settings forms.
- The service worker displays encrypted Web Push while CRM is closed, with stable notification tags and same-origin allowlisted click destinations. Native alerts do not include customer names, phone numbers or birth dates. Provider retries may replace the same tagged notification; exact-once delivery is not guaranteed by Web Push.
- Read/unread history and category preferences are persisted against the membership. Device subscriptions bind to one current membership and active session; account/company switches rebind the existing endpoint, and revoked/expired sessions cannot receive newly sent push. An already-sent provider message can still arrive after logout, so its payload is generic.
- Inbox retention is 90 days; delivered outbox records/jobs are cleaned after seven days. History uses cursor pagination.

## Deployment

Apply migration 31 **before starting the new API**. Coolify's Compose migration service uses the `maintenance` profile, so run the migration explicitly for an existing deployment. Local Compose runs it automatically. API startup fails clearly if notification tables are absent.

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
go test ./cmd/api -run TestNotificationsPostgres -v -count=1
```

Use a disposable PostgreSQL instance: the integration test creates an isolated schema, applies all migrations and removes that test schema. Redis protocol behavior is exercised with miniredis; encrypted provider requests are tested with a fake HTTP transport, not sent to actual subscribers.

To test the production Next WebSocket proxy, build/start Next on port 3001 with an upstream URL `http://localhost:8080`, then set `NOTIFICATION_TEST_API_ADDRESS=127.0.0.1:8080` and `NOTIFICATION_TEST_FRONTEND_URL=http://localhost:3001` for the same Go integration test. This checks real upgrade/auth/origin/tenant/driver boundaries through Next.

Finally verify on an actual phone: install PWA, enable push and use its profile's push test. Then close the PWA, generate an eligible booking/request/trip/payment event from a second session/device, and open the notification on the first phone. Automated encryption/queue tests are not proof of OS notification delivery.
