# Driver workflow technical verification

All mutable checks use disposable local PostgreSQL/Redis and authenticated API sessions. Production business records are not used for destructive or financial tests.

## Expected workflow

1. Connect a driver account in Team and assign that driver and an available vehicle to a trip. Route fare and fixed driver pay are copied into the trip.
2. The driver's My trip page shows their assigned trip and passenger manifest. For each passenger select Arrived or Absent; each choice persists immediately.
3. Cash is accepted per booking after at least one passenger is marked arrived. Enter the cumulative amount received for that booking. A partial amount can be topped up. Repeating the same total, even concurrently, adds no money twice. Bank-transfer bookings cannot collect cash again.
4. Cash received appears immediately in the driver's wallet and finance. It is separate from salary. Customer received totals reflect actual receipts rather than unpaid bookings.
5. Start records actual departure, independently of the schedule. Early/late departure is permitted. Another trip cannot start while this driver or vehicle still has an in-progress trip.
6. Complete requires resolved attendance and all expected cash. Fully absent bookings without paid funds are cancelled atomically; they do not count as passengers or money received. Mixed bookings retain their agreed fare; adjustments/refunds require the dispatcher. Paid bank bookings are not automatically refunded for absence.
7. Completion records actual arrival and creates one driver-pay accrual, with the trip's fixed gross pay and configured tax snapshot. Repeating completion does not duplicate salary.
8. Driver cash handover requires cashier acceptance; salary payout is separate. Neither is a second revenue event. Balances remain separated by currency.

## GPS

Progress is the projection of a fresh GPS position onto the saved road geometry, measured by road distance. Scheduled time does not move the car. Missing/old/inaccurate/off-road or ambiguous fixes do not invent a percentage. GPS permission and starting transmission remain explicit. Queued fixes survive temporary loss of network, are deduplicated and scoped to the same driver/trip. Completion drains queued points first.

Real-phone acceptance still needs location permission, an actual outdoor movement test, and an offline/reconnect test. iOS/Android browsers may suspend PWA GPS when backgrounded or locked; a PWA does not provide guaranteed native background tracking. Keep the app visible during the drive.

## Automated coverage

The driver accounting lifecycle exercises account linking and real login, assignment, two-passenger boarding, no-show handling, partial cash, concurrent payment retries, prevented overpayment/decrease, wrong-driver access, dispatcher record projections, customer received totals, capacity, early/late departure, overlapping active trips, wallet, payroll, handover, payout and taxes. Dedicated public-booking and payment tests cover seat concurrency, expired payment holds, bank payment and cash separation. GPS delivery/road matching tests and the frontend queue tests cover freshness, route matching and retry isolation.

Production migration 49 adds attendance/receipt attribution and actual departure/arrival timestamps, preserving previously confirmed cash receipts. It must be applied before deploying the new API. The migration down path refuses to discard individual cash events.
