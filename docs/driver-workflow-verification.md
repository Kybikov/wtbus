# Driver workflow technical verification

All mutable checks use disposable local PostgreSQL/Redis and authenticated API sessions. Production business records are not used for destructive or financial tests.

## Expected workflow

1. Connect a driver account in Team and assign that driver and an available vehicle to a trip. Route fare and fixed driver pay are copied into the trip.
2. The driver's My trip page shows their assigned trip and passenger manifest. For each passenger select Arrived or Absent; each choice persists immediately.
3. Cash is accepted per booking after at least one passenger is marked arrived. Enter the cumulative amount received for that booking. A partial amount can be topped up. Repeating the same total, even concurrently, adds no money twice. Bank-transfer bookings cannot collect cash again.
4. Cash received appears immediately in the driver's wallet and finance. It is separate from salary. Customer received totals reflect actual receipts rather than unpaid bookings.
5. Boarding can start before or after the schedule and records its own actual timestamp. Departure records a separate actual timestamp. Before scheduled departure, every active passenger must be boarded, or an owner/admin/dispatcher/developer must explicitly approve early departure. Absent passengers do not count as boarded. Another trip cannot board or depart while this driver or vehicle is boarding or driving another trip. See [trip operations](trip-operations.md).
6. Complete requires resolved attendance and all expected cash. Fully absent bookings without paid funds are cancelled atomically; they do not count as passengers or money received. Mixed bookings retain their agreed fare; adjustments/refunds require the dispatcher. Paid bank bookings are not automatically refunded for absence.
7. Completion records actual arrival and creates one driver-pay accrual, with the trip's fixed gross pay and configured tax snapshot. Repeating completion does not duplicate salary.
8. Driver cash handover requires cashier acceptance; salary payout is separate. Neither is a second revenue event. Balances remain separated by currency.

## Editing assignments and seats

Before departure, editing follows the trip's workflow phase (`planned` or `assigned`), including boarding and custom statuses. Delay is separate from stage. Terminal statuses and trips already in progress are read-only for ordinary staff; developer access remains available. The detail-page restriction and the update API use the same rule, checked again while the trip row is locked.

An unchanged driver or vehicle link remains valid for editing the existing trip even if that profile has since been disabled. A replacement driver must have an active driver/developer membership in the same company; a replacement vehicle must be active. Updating seats never reactivates an account or changes the assigned driver. Creation and vehicle replacement inherit physical vehicle capacity. An explicit lower sales limit is retained on unrelated edits. Every change checks active reservations atomically; an undersized replacement leaves the original assignment unchanged. Invalid legacy capacities are repaired only before departure and when reservations fit the physical vehicle. Boarding/departure also require an active vehicle, an active linked driver account and enough physical seats.

`TestTripEditingDatabase` reproduces the delayed-trip plus button, correction of an over-capacity trip retaining an inactive driver, subsequent active-driver assignment, rejected inactive/foreign replacements, capacity errors, and closed/in-progress restrictions in an isolated database.

## GPS

Progress is the projection of a fresh GPS position onto the saved road geometry, measured by road distance. Scheduled time does not move the car. Missing/old/inaccurate/off-road or ambiguous fixes do not invent a percentage. GPS permission and starting transmission remain explicit. Queued fixes survive temporary loss of network, are deduplicated and scoped to the same driver/trip. Completion drains queued points first.

Real-phone acceptance still needs location permission, an actual outdoor movement test, and an offline/reconnect test. iOS/Android browsers may suspend PWA GPS when backgrounded or locked; a PWA does not provide guaranteed native background tracking. Keep the app visible during the drive.

## Automated coverage

The driver accounting lifecycle exercises account linking and real login, assignment, two-passenger boarding, no-show handling, partial cash, concurrent payment retries, prevented overpayment/decrease, wrong-driver access, dispatcher record projections, customer received totals, capacity, early/late departure, overlapping active trips, wallet, payroll, handover, payout and taxes. Dedicated public-booking and payment tests cover seat concurrency, expired payment holds, bank payment and cash separation. GPS delivery/road matching tests and the frontend queue tests cover freshness, route matching and retry isolation.

Production migration 49 adds attendance/receipt attribution and actual departure/arrival timestamps, preserving previously confirmed cash receipts. It must be applied before deploying the new API. The migration down path refuses to discard individual cash events.
