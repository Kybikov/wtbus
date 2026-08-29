# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Owners and administrators configure a transfer company, its branding, routes, fares, staff, and access.
- Dispatchers coordinate bookings, vehicles, drivers, and live trip status throughout the day.
- Drivers use a phone-first PWA opened from Telegram to manage an active trip and share GPS location.
- Passengers make and manage bookings entirely in the Telegram bot.

## Product Purpose

Vivat Bus is a SaaS CRM/TMS for international passenger transfers. It centralizes customer records, recurring and individual trips, vehicle scheduling, driver operations, finances, and Telegram bookings for multiple independent transport companies.

## Positioning

It combines dispatcher operations and a Telegram-first passenger booking flow in one tenant-isolated product, while allowing each transport company to use its own brand.

## Operating Context

Dispatchers primarily work from a desktop dashboard. Drivers work on a phone. The first release is Russian-only; multilingual support is planned for the bot. The current initial tenant brand is Vivat Bus, using the provided black-and-gold logo.

## Capabilities and Constraints

- Backend is Go only; Python and Node.js are not used for product backend work.
- The web application uses Next.js, TypeScript, Shadcn UI, and Tailwind CSS.
- PostgreSQL is the source of truth; Redis supports realtime delivery, queues, caching, and rate limiting.
- The product is multi-tenant from the start. Each tenant can set company branding, while individual staff can set personal interface preferences.
- Supported trip modes: regular scheduled routes and manually created point-to-point transfers.
- Current local release: operational CRM, regular and individual trips, a dispatcher queue for Telegram individual-transfer enquiries, fleet and driver workflows (GPS and mandatory cash-on-boarding receipt), customers, bookings, finance, per-company branding, persisted staff preferences, Excel customer import/export, and Telegram-first booking. Local demo departures exist solely to make the booking flow testable; they are disabled in production Compose.
- A separate central subscription platform will be integrated later; this product must keep a clean entitlement boundary but must not connect to it yet.

## Brand Commitments

Vivat Bus is the initial demo tenant. Its supplied logo is black and gold. The product must support per-company logo, color, and default theme without allowing branding preferences to fragment the shared interface structure.

## Evidence on Hand

- Requirements: `C:/Users/whoam/Downloads/Telegram Desktop/Мне.pdf`
- Initial tenant logo: `C:/Users/whoam/Downloads/Telegram Desktop/IMG_9237.PNG`
- UI reference: `https://shadcn-nextjs-admincn-admin-template.vercel.app/dashboard/sales`
- No production pricing, acquirer, backend integration contract, or real operational data has been supplied yet. Demo data is permitted.

## Product Principles

- Make dispatch work fast to scan, safe to operate, and useful on real working days.
- Keep company branding flexible but preserve a coherent, accessible shared product system.
- Treat tenant isolation, roles, and billing eligibility as architectural foundations.
- Design the client experience for Telegram and the driver experience for a phone first.
- Build incrementally with demonstrable, verified slices.
