# Trip stage, delay and capacity

Trip stages describe actual operations: scheduled/assigned, boarding, in progress, completed or cancelled. Clock time never advances or replaces a stage. Delay is a read-only projection beside the stage, calculated from the server clock and scheduled departure/arrival. A delay badge appears from 15 minutes. Actual departure and arrival freeze their respective delay values. Historical completed trips without actual timestamps do not acquire invented delays.

The trip detail displays this in a dedicated **Задержка** field; the trip list has a separate **Задержка** column. The value shows departure/arrival delay in minutes or **Без задержки**, independently of the stage selector.

## Boarding and departure

- The assigned driver may start boarding early or late. The first passenger marked boarded also starts boarding. The first actual boarding timestamp is retained on retries; neither action records departure or starts GPS transmission.
- At or after scheduled departure, the existing attendance and cash rules apply.
- Before scheduled departure, every seat in every active booking must be marked boarded, or an owner, administrator, dispatcher or developer must explicitly approve early departure. Marking a passenger absent does not satisfy the all-boarded rule. An empty trip requires approval to depart early.
- Approval is a separate confirmed command on the trip detail page. It does not depart the vehicle or resolve attendance. It records the approver and time in the activity journal.
- Approval is bound to the current departure plan and booking manifest. Changing the driver, vehicle, scheduled departure or bookings invalidates it. Reverting a departure-plan change does not restore approval. Attendance check-ins alone do not invalidate permission to depart with missing passengers.
- Boarding and departure require an active vehicle and driver with an active linked driver/developer account, enough physical seats for reservations, and no other trip currently boarding or driving with either resource. Normal company and role boundaries remain in force.
- The driver's departure confirmation still resolves waiting passengers explicitly. Completion still checks attendance, cash receipts and salary accrual independently.

## Capacity

The vehicle is the source of physical capacity. Creating a trip or replacing its vehicle inherits that capacity, even if a full update contains the previous vehicle's stale seat count. A dispatcher may deliberately set a lower sales limit. Unrelated edits preserve that lower limit.

Active bookings and unexpired payment holds must fit the requested capacity. Validation and assignment occur in the same transaction under the existing resource/trip locks. An undersized vehicle change is rejected without changing either capacity or vehicle. The error reports reserved and available seats.

## Persistence and migration

Migration 53 adds the actual boarding timestamp, early-departure approver/time, manifest signature and monotonic departure-plan revision. It backfills boarding time only from recorded boarding events. Legacy `delayed` trips with boarding evidence become `boarding`; otherwise they become `assigned`. Legacy `in_progress_delayed` becomes `in_progress`. Migration never invents an actual departure. The old system delay statuses are removed; historical activity labels remain readable.

The migration also repairs over-capacity legacy trip limits only for nonterminal predeparture trips whose reservations fit the vehicle. Lower limits, overbooked exceptions and historical trips remain untouched. Each repair and stage normalization is journalled. The API also repairs an unchanged invalid predeparture limit on the next edit when reservations fit.

Status commands and approvals journal their changes in the same transaction. Time-based delay reads create no activity noise. Trip lists, detail, fleet, driver manifest and overview receive the same batched operational projection.

## Verification

`TestTripBoardingAndEarlyDeparturePostgres` covers early/late boarding, missing/absent passengers, role checks, approval retry and invalidation, all-boarded early departure, actual timestamps and physical capacity. `TestTripTimingReadOnlyPostgres` checks read-only delay and completed-trip calculations. `TestTripOperationsMigration` checks legacy normalization, capacity repair boundaries and journal evidence. `TestTripEditingDatabase` covers inherited vehicle capacity, rejected replacements, inactive retained assignments and workflow edit eligibility. The accounting lifecycle additionally covers the explicitly approved early-departure path without changing financial invariants.

Authenticated Safari/WebKit checks use disposable tenant data for owner vehicle replacement, driver boarding, blocked early departure, dispatcher approval and subsequent departure. Narrow layouts and public transfer title/Open Graph metadata are checked separately. No production passenger or financial records are used for those tests.
