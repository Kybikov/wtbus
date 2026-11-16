# Money operations: requirements, implementation and verification

Implemented 2026-11-16. This document describes migration 55 and the Go money endpoints. The delivery register and integration status are in `../operations-v2-delivery.md`; the cross-team contract is in `operations-v2.md`.

## Requested behavior

The customer needs to collect a fare in a currency different from the quoted booking, retain the actual notes held by each employee, pay trip and general expenses from the correct wallet, exchange physical money, and hand cash to an owner only after the owner accepts it. Completed trips can still have outstanding passenger debt. Driver, trip manager and owner are different operational roles; collecting money must not require pretending to be the primary driver. Historical reports must not change with today's rates, and handing money between custodians must never create a second fare or a trip expense.

The accepted source is Monobank, rather than the NBU source in the customer's initial proposed technical specification. Missing historical observations are explicit; the system never silently substitutes today's rate.

## Data and invariants

`money_accounts` identifies a tenant, custodian type, custodian UUID and immutable native currency. Company and system account owner UUIDs equal the tenant UUID. A member account uses the membership UUID; an old unlinked driver retains a driver account. Linking legacy driver receipts to an existing member consolidates that person's custody when the bridge is first applied.

`money_journal` and `money_postings` are append-only. Every posted transaction balances separately in each currency, enforced by a deferred PostgreSQL constraint trigger. A physical exchange has four entries: source wallet and source clearing account, then target wallet and target clearing account. Clearing entries are excluded from assets shown to staff. Corrections append compensating entries; neither the original amount nor its currency is edited. `money_reversals` makes a second reversal impossible. Payroll accrual expenses require a payroll correction and cannot be reversed through the generic expense command while a payable remains.

`money_transfers` stores immutable terms. A request reserves available funds, without changing posted cash. Only pending requests can become accepted, rejected or cancelled. Acceptance appends the debit and credit atomically; rejection/cancellation release the hold. Only the recipient can accept or reject, with owner/developer acceptance for company cash. A sender cannot accept a transfer to someone else. Owner/developer immediate deposit is limited to their own held cash into company cash. Managers may spend company cash, but cannot spend another member's wallet simply because they can view it.

All commands serialize on the tenant row before checking balances and acquiring booking locks. `money_requests` binds the UUID request key to the actor and canonical command payload. Repeating identical data returns the original result; changing the actor or payload returns a conflict. Failed commands roll back the business event, journal, reservation, notification, activity and retry record together.

All amounts are integer minor units. Decimal rates use `math/big.Rat`; conversion rounds positive fractions half up and checks int64 overflow. Native receipt amount, allocated booking amount and reporting amount are separate values. For example, 440000 UAH minor at EUR/UAH 50 creates 440000 UAH physical custody and allocates 8800 EUR minor, without changing the booking price.

## Legacy bridge and integration

Migration 55 installs same-transaction insert triggers and backfills, in chronological order:

| Legacy source | Journal effect |
| --- | --- |
| `driver_cash_ledger.cash_collected` | Actual member/driver wallet increases against clearing; one fare receipt |
| `driver_cash_ledger.collection` | Custodian decreases, company cash increases; internal transfer |
| `company_cash_receipts` | Company cash increases; funding or income retains its distinction |
| `operational_expenses` | Actual `wallet_account_id` is debited for new cash expenses; old cash expenses debit company cash; bank/unallocated expenses affect costs without inventing physical cash |
| `driver_payroll_payouts` | Actual cash decreases; salary payment is not a second accrual expense |
| `finance_tax_payments` | Actual cash decreases; tax payment is not a second accrued cost |

Unique journal source keys (`table:UUID`) make both backfill and triggers idempotent. Existing balances are preserved from existing movements, with no fabricated opening balance. A new fare **first inserts a real legacy `cash_collected` row** with its native amount/currency and current membership custodian. The bridge is its only physical journal posting. `money_receipts` then stores the booking allocation and applied decimal rate. `driver_booking_checkins.cash_minor` increases by the booking-currency allocation. A receipt reversal decrements that allocation while appending the physical refund entries.

The old cash table remains a record of native receipt events; after a correction, the complete cash balance comes from the journal including compensation. Old reports must therefore use the helper functions below rather than sum original receipt rows alone.

Parent integration hooks:

- `moneyAccountBalance(ctx, tx, tenantID, ownerType, ownerID, currency) (int64, error)` returns posted cash.
- `moneyAccountAvailable(...)` additionally subtracts pending v2 transfers and legacy driver handovers. Use it for every legacy expense, cash payout, exchange or new handover, after locking the tenant row. Resolving an old handover must exclude its own reservation while retaining all other holds.
- `moneyAccount(...)` creates/resolves an account; `moneyWalletLoad(...)` and `moneySpend(...)` enforce actual custody.
- `moneyPost(...)` appends balanced entries for an already authorized operation, including crew salary payouts. Its caller owns transaction, tenant serialization, availability checks, idempotency and activity.
- `app.storeMoneyRateHistory(ctx, tenantID, []monobankRate)` is called by the currency worker. It persists the observation's actual tenant-local date and keeps the first daily observation immutable.
- Register `moneyWorkspace`, `bookingPayments` and `tripMoney` under the shared contract paths. Routing must preserve tenant/session checks and allow assigned staff access to booking payments.

## Receipt and reporting rules

Ordinary staff require an active trip `can_collect` assignment; owner/admin/developer can collect companywide. A completed trip is permitted, but a cancelled booking is denied. Pending or authorized bank orders block cash collection with an actionable explanation; they must first be explicitly cancelled or completed, preventing an accidental double payment. Allocation may not exceed the booking debt after existing cash allocation and successful payments. Fully settled `cash_on_boarding` bookings move to `confirmed`, with an attributed old/new status event; payment does not falsely mark a passenger boarded.

Workspace queries expose own custody and operations to staff; finance viewers see company data. Transfer recipient names are available without exposing their wallet balances. Returned `canSpend`, `canAccept`, `canReject`, `canCancel`, `canReverse` and `disabledReason` fields are server authorization results, not client assumptions. Receipt and expense rows retain a `reversed` indicator. Manual historical rates and an override of the dated automatic receipt rate require manager rights and a reason.

`GET booking-payments` accepts either a booking UUID or a trip UUID (`{items:[...]}`), so assigned staff do not need access to the companywide booking list. `tripMoney` accepts an optional trip UUID and inclusive `from`/`to` dates interpreted against tenant-local trip departure dates. It reports each trip in its own currency, without adding different currencies into one total. Revenue includes physical fare receipts and successful payments, expenses include legacy/new actual expenses and crew accrual expenses. Transfers, owner deposits, FX and salary payouts do not create trip income or duplicate payroll costs. Reversed receipt/expense originals are excluded. Outstanding debt is separate and converted from the booking currency at its quote creation date when needed.

Historical conversion reads only the operation-date daily observation. `money_valuations` freezes the converted journal amount and rate on its first successful report. Missing quotes set `rateMissing`; incomplete totals must be labelled by the caller. Successful bank payment reporting uses its paid date (creation fallback), and immutable daily quotes; no current quote fallback is used. First-daily-observation quotes and manual quotes cannot be edited after insertion.

## Verification performed

Pass 1, contract/data review: checked existing cash, check-in, payment, expense and payroll schemas, legacy source keys, currency distinctions and crew capability boundaries.

Pass 2, implementation: migration bridge/backfill, immutable accounts/journal/terms/rates/requests, per-currency balance constraint, exact conversion, scoped handlers, reservation lifecycle, actual-wallet expenses, physical FX, receipts/allocations/reversals and dated reports.

Pass 3, executable PostgreSQL tests: `TestMoneyV2Rounding` and `TestMoneyV2Postgres` run against a fresh disposable PostgreSQL 17 cluster with a schema isolated by `deliveryTestDatabase`. They exercise absent historical rates, native versus allocated cash, identical retry and altered-payload conflict, assigned collection, unauthorized collection, completed-trip collection, cancelled-booking rejection, pending-bank protection, over-allocation rejection, sender acceptance denial, recipient acceptance, reject/cancel, holds blocking expenses, actual FX amounts, expense and receipt reversals, double-reversal rejection, bridge replay, unbalanced commit rejection, immutable postings/rates, cross-tenant owner denial, daily quote persistence and report date filtering. `TestTripCrew` and `TestFinanceAccountingPostgres` were also run with these changes.

Command: `go test ./cmd/api -run 'TestMoneyV2|TestTripCrew|TestFinanceAccountingPostgres' -count=1` from `backend`, with `NOTIFICATION_TEST_DATABASE_URL` pointing only at the disposable cluster. Final execution evidence is recorded in the parent delivery register. The abandoned disposable cluster on port 55436 had missing PostgreSQL files; the parent replaced it with a fresh cluster on 55437. Port 5432 was never used for these tests.

Pass 4, adversarial review: added immutable transfer terms and one-way resolution, payroll reversal protection, active recipient checks, tenant trip validation, exact integer JSON handling for wallet totals, server action booleans, old/new paid status activity, and converted debt rather than summing different booking currencies. Parent owns final legacy endpoint, UI, whole-suite and delivery verification.

The down migration refuses to discard any newly recorded command. Applying migration 56 follows migration 55 because crew payouts reference the journal. No production record, secret or external payment API is touched by these tests.
