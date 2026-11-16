# Requested changes and implementation evidence

Contract revision 1, 2026-11-16. This is a requirements-to-evidence register. Pending is not complete. No production data may be used for mutation tests.

| ID | Required result | Implementation/evidence |
|---|---|---|
| R01 | Multiple drivers and trip manager, explicit trip permissions, compatible primary driver | Implemented: migration 56, trip_crew.go, TripCrewEditor; TestTripCrewPostgres and TestTripCrewLifecycleRoutes. |
| R02 | One current GPS transmitter; authorized crew can board and control trips | Implemented: capability checks under tenant lock in check-in, status and GPS routes; one GPS index and secondary-driver conflict guard. Real-router lifecycle tests. |
| R03 | Individual crew pay without duplicate primary-driver accrual | Implemented: custom primary-pay ownership, per-member accruals, manager payouts and existing linked-driver payroll. Repeated completion/payout/deletion tests. |
| R04 | Four native currencies, partial/multiple tender receipts, immutable quote and applied rate | Implemented: BookingPayments, money_receipts, native cash bridge and booking allocation; exact-money frontend tests and TestMoneyV2Postgres. |
| R05 | Owner/admin and assigned staff can collect, including completed trips with debt | Implemented: company managers and assigned collectors; completed-trip debt remains payable. TestTripCrewLifecycleRoutes. |
| R06 | Wallets by custodian and currency, immutable journal, atomic writes, idempotency | Implemented: append-only balanced per-currency postings, immutable request/terms and actor-bound idempotency. PostgreSQL constraints and retry/concurrency tests. |
| R07 | Trip/general expenses from the real wallet, category/date/comment and reimbursement/advance distinction | Implemented: actual wallet expense with category/date/trip/comment; advance uses transfer rather than expense. Reimbursement can use an explicit general/trip expense and transfer, without a separate reimbursement approval workflow. |
| R08 | Physical currency exchange preserves both actual amounts | Implemented: exchange command atomically records both native amounts; TestMoneyV2Postgres and exact parser tests. |
| R09 | Reserved two-step transfers, recipient acceptance, reject/cancel and owner immediate deposit | Implemented: reservation/accept/reject/cancel, recipient-only new transfer acceptance and owner own-cash deposit; legacy holds share available-balance calculation. Old pending driver handovers remain available in accounting. |
| R10 | Daily Monobank history, operation snapshots, explicit historical-rate fallback | Implemented: currency worker persists immutable daily Monobank observations; dated manual quote with reason; reporting snapshots. Missing history is explicit, not replaced with today. Tests cover immutable quote and snapshot. |
| R11 | Trip profit and outstanding debt, no transfer/advance double counting, color and list column | Implemented: dated trip result/debt API, colored summary and netProfit list column. Transfers/exchanges/payroll payouts excluded from duplicate cost recognition; PostgreSQL report tests. |
| R12 | Receipt/expense/transfer journals with date/currency/trip/category/status filters | Implemented: MoneyWorkspace receipt/expense/transfer journals, date/currency/trip filters, expense category and transfer status; report period filters. |
| R13 | Clear received/on-hand/reserved/company cash metrics; no double revenue on hand-in | Implemented: native balance/reserved/available per custodian and company, companyCash bridge, legacy payout/handover available guards. Existing legacy driver totals are not shown as the primary new wallet view. |
| R14 | Same shared controls, mobile 320/390 and desktop layouts, explicit money commands, field autosaves | Implemented shared responsive controls, crew blur/choice queue and explicit money commands. TypeScript, scoped ESLint and 132 frontend tests pass. Visual 320/390/desktop acceptance BLOCKED: local browser access unavailable; Chrome activation failed twice. No visual pass claimed. |
| R15 | Existing data retained and bridged exactly once, tenant isolation, reversals, attribution and regression checks | Implemented migrations 55/56, exactly-once bridge, scoped accounts, compensating reversals, actor activity and deletion previews retaining journal/payroll. Real PostgreSQL tests apply all migrations in isolated schemas. |
| R16 | Research, architectural decisions, changed behavior, migration and manual acceptance instructions documented | Implemented architecture/research references, this requested-versus-delivered register, module docs and operations-v2-usage.md with workflow/migration/manual acceptance instructions. |

## Business assumptions selected for implementation

The company role grants broad company permissions; an assignment grants only that trip's capabilities. A manager may collect and board without being a driver. One driver can hold every capability. Two drivers can alternate the GPS responsibility explicitly. Owners may collect without crew assignment. Transfer recipients confirm their own receipt; a company owner confirms company-cash receipt. Personal money and company cash are separate accounts. A completed trip may still have debt. Cancelled bookings require reversal/refund handling instead of a fresh fare receipt. Profit displays cash result with debt separately, rather than pretending unpaid fares were received. Manual historical rate needs a reason; historical values never silently use today's quote.

## Verification evidence and remaining acceptance

Disposable PostgreSQL integration tests: foreign tender, split receipts, repeated/conflicting keys, parallel last-balance spend, transfer reservation and dual acceptance, rejected cross-tenant and unassigned actors, date/rate freezing, reversal, legacy bridge, completed-trip collection, crew/GPS switching and payroll. Frontend tests, changed-scope lint, production build, Go tests/vet. Browser checks use disposable records at 320/390 and desktop. Record actual results here; do not claim completion from compilation alone.

Frontend verification: 132 tests passed with no skips; TypeScript and scoped ESLint passed. Production build passed during integration; final gate run below must be recorded after all edits. PostgreSQL leaf tests passed on the fresh disposable cluster at port 55437. The earlier disposable cluster at 55436 had missing files, was stopped and was not used for final evidence; user PostgreSQL at 5432 was not touched.

Browser acceptance remains pending because this chat has no local browser connector and native Chrome returned `failed to activate captured window` before navigation, including one rebind/retry. No production data or live financial transaction was tested. This is an explicit remaining acceptance item, not an implementation claim.

Research used primary sources in TigerBeetle, Formance Ledger and ERPNext; links and adaptation decisions are in architecture/operations-v2.md. No additional money service or repository code was imported. This delivery implements the financial/crew scope authorized in the latest request; earlier unrelated calendar/import/Telegram work is not asserted as newly completed here.

## Final automated verification (2026-11-16)

- `go test ./...` from backend with NOTIFICATION_TEST_DATABASE_URL pointing at the fresh disposable PostgreSQL cluster: PASS. This includes the real crew/money/router, legacy accounting, statistics and deletion integration suites using isolated schemas. Optional suites requiring other database/service environment variables remain opt-in; no production integration was exercised.
- Independent `TestMoneyV2` and `TestTripCrew` re-verification: PASS.
- `go vet ./...`: PASS.
- Frontend: 132 tests passed, 0 failed, 0 skipped; TypeScript and changed-scope ESLint passed; Next production build passed.
- Added a statistics regression proving reversed native receipts and corrected expenses do not remain in received-money/expense totals. Dashboard trip results now use dated report valuations rather than today's exchange table.
- Browser/phone visual acceptance: NOT RUN successfully, for the specific tooling failure described above. This is the only remaining acceptance gate; responsive source review is not substituted for a screenshot.
- No production database migration or external money movement was performed. Commit/push delivers source; apply migrations 55 then 56 with the matching API/web release.
