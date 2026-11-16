# Trip crew and compensation

Implemented in migration 56, `trip_crew.go`, the trip crew editor and the authenticated Next proxies. The parent integration connects existing trip operations, boarding, GPS, collection and completion to these assignments.

## Requirements and decisions

A trip supports one or more drivers and zero or more trip managers. A company role answers which company administration screens a person can use; a trip assignment answers what that person may do on this specific trip. A manager may collect fares and mark passengers without a driver profile. A second driver is a separate person, with independent permissions and compensation.

Each assignment belongs to one tenant, trip and membership. Capabilities are independent: driving, collection, boarding, trip management and GPS. GPS requires the driver trip role and driving permission. A partial unique index permits at most one active GPS source. Choosing a new source clears the previous one in the same transaction, serialized on the trip row. Zero sources is permitted while preparing a trip. Inactive company memberships never gain access, even when their historical assignment remains present.

Boarding and departure check every assigned driving member, including secondary drivers, for another trip already boarding or in progress. The tenant lock serializes starts and roster changes. Adding a driving assignment to an already active trip performs the same check; planned roster preparation remains possible, but cannot bypass the start-time resource check.

Company owner, administrator, dispatcher and developer may edit the crew. Assigned ordinary staff may read their trip team, but receive no unrelated staff directory and no other member's compensation. Only their own compensation is displayed. Financial payout authority remains owner, administrator or developer; accountant may view the payroll report. Capability checks do not silently grant global company access.

## Existing primary driver

`trips.driver_id` remains the primary driver link. Migration backfills its linked membership, and triggers synchronize primary changes and later driver-to-membership linking. The primary has the existing operational capabilities by default. Manually configured former primary assignments remain as secondary team members; automatically created, otherwise untouched former primary assignments deactivate on replacement. Replacing the primary never removes other drivers or managers.

`source_legacy` tracks this distinction. `custom_pay` records an explicit per-person pay override; ordinary capability changes do not claim payroll ownership. Explicitly inactive rows revoke legacy authorization fallback. Removal is soft deactivation and retains the attributed activity. The primary is replaced through its related-record link rather than silently removed from the team.

## Compensation and actual payments

Amounts use integer minor units and one of UAH, PLN, EUR or USD. Compensation is specified separately for each person. Completion accrues each active compensated assignment once, under a unique tenant/trip/membership constraint. Completed/cancelled team settings are read-only. An ordinary record edit cannot rewrite an accrued liability.

The existing primary-driver accrual remains authoritative unless `tripCrewOwnsPrimaryPayroll` reports an explicit crew pay override. The completion integration skips that legacy primary accrual for an override and calls `accrueTripCrewPay` in the same transaction. This avoids paying the primary twice. Additional linked drivers use the existing driver payroll and tax calculation. Managers without driver profiles receive a membership-based immutable accrual and a `crew_pay` operational expense. This recognizes the cost once.

Manager payouts are explicit financial commands. They debit a permitted company or personal cash wallet and credit the balancing system account using the shared money journal. They never create another operational expense. The payout transaction locks the tenant, checks the exact salary currency, unpaid liability and available funds after transfer reservations. A tenant-scoped request UUID binds accrual, source wallet, actor and amount; retries return the original result, and different data under the same UUID is rejected. Partial payouts are supported. Immutable payout rows retain the actor and journal link. Linked drivers remain payable through the existing driver payroll API; they cannot also be paid through manager payroll.

Accrual correction is a separate attributed financial correction workflow, rather than changing the historical crew amount. Generic expense reversal must reject payroll-bound expenses. No automatic tax treatment for non-driver managers is invented; the recorded manager amount is the agreed gross amount.

Operational deletion is separate from financial correction. Removing a trip cascades its operational `trip_crew` rows, while immutable accruals retain the original trip, membership and expense UUIDs without restrictive operational foreign keys. The same applies when company cleanup removes operational expenses or a staff membership is removed. An insert-only origin trigger validates that these references originally belonged to the same tenant; later deletion does not rewrite them. Payout actor UUIDs also remain retained references. Finance reports use a left join and a deleted-member label, so removing staff does not hide their liabilities. Deletion previews must disclose both the disappearing roster and retained salary history. Linked-driver legacy payroll has its existing retention rules; this migration does not add restrictions to that path.

## HTTP and UI contracts

- `GET /api/v1/tenants/{slug}/trips/{tripID}/crew`: active items, eligible members for company managers, current membership, edit/view-pay capabilities and a precise read-only reason.
- `PATCH` the same URL: membership ID plus only changed fields, or explicit `remove:true`. Existing fields not included in the request are preserved under the trip lock.
- `GET /api/v1/tenants/{slug}/me/trips`: current member's assigned trips, including completed trips for outstanding fare settlement; includes workflow phase, vehicle, operational capabilities and own compensation.
- `GET /api/v1/tenants/{slug}/crew-payroll`: manager accruals and unpaid balances, scoped to the current member unless finance viewing is allowed.
- `POST` the same URL: `{accrualId,accountId,amountMinor,requestId}`. Returns the payout ID.

Next proxies are `/api/trip-crew?tripId=…`, `/api/trip-crew?payroll=1` and `/api/my-trips`; they preserve authenticated API access and disable response caching.

`TripCrewEditor({tripId,onUpdated?})` uses shared selects and switches. Existing pay fields autosave on blur; role, capability and currency choices autosave immediately. Each member has a serialized field queue, preserving newer drafts and avoiding mutation cancellation. Member addition and exclusion stay explicit. Controls explain read-only and role restrictions. Layout wraps into one column on narrow screens.

`CrewPayroll({wallets,onUpdated?})` shows manager salary liabilities and an explicit hold-to-confirm payment. Wallets carry `canSpend` and available native-currency balances. The request ID survives a failed retry and resets when the entered financial data changes.

## Verification

`TestTripCrewPostgres` runs all migrations in an isolated PostgreSQL schema and verifies multiple drivers plus a manager without a driver profile, same-tenant membership validation, inactive revocation, capability authorization, exclusive GPS switching, partial field updates, restricted directory visibility, legacy fallback and later membership linking. It also verifies custom primary payroll ownership, completion accrual idempotency, legacy primary exclusion, manager partial payout idempotency, changed-request rejection, overpayment rejection, payout permissions and absence of duplicate profit expense.

Deletion coverage removes a completed compensated trip and its operational expense, verifies that roster rows cascade, and verifies the original immutable salary UUID references and money journal remain. Removing the paid manager's membership likewise retains both accruals and payouts.

`TestTripCrewLifecycleRoutes` exercises the real router, bearer sessions and role middleware. An accountant membership assigned as trip manager, without a driver profile, can board passengers and operate the trip; an unassigned accountant cannot. Only the current GPS assignee can submit positions. A shared secondary driver prevents another trip from starting boarding and cannot be added into a second already boarding trip. The first trip completes with an unpaid confirmed passenger, then that manager settles the debt through the money API. Completed-trip GPS submissions are rejected.

The focused test passed against the disposable local PostgreSQL cluster on port 55437. Production records and unrelated port 5432 were not used. Frontend scoped ESLint and TypeScript checking passed during implementation; final integration and browser verification belong to the parent delivery checks.
