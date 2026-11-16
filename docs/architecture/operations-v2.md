# Trip teams and multicurrency cash operations

Status: implemented; visual acceptance remains pending because browser control is unavailable. Requirements and completion evidence: `../operations-v2-delivery.md`.

## Decisions

Keep the existing Go/PostgreSQL application; do not introduce a separate ledger service. A company role is distinct from a trip assignment and from custody of cash. A trip can have several drivers and a manager, with explicit collection, boarding, trip-control and GPS capabilities. Exactly one assigned member is the current GPS source. The existing driver link remains a compatible primary driver, not the entire crew.

Cash has an immutable native currency and a custodian. Booking price, native tender, allocated booking-currency amount and reporting value are different values. Never replace the quoted booking price when a passenger tenders another currency. Integer minor units and decimal/rational exchange calculations are required. Every financial command has a tenant-scoped idempotency key bound to its actor and canonical request. Reusing a key for different data is a conflict.

Money movements are append-only, balanced by currency, and written in one PostgreSQL transaction with the business event and actor. Corrections use an attributed compensating movement. A wallet balance is derived from postings, not an editable amount. Historical legacy receipts and expenses must bridge exactly once; no opening cash is invented and cash receipt/hand-in must not count as two revenues. Existing financial APIs must not bypass reservations held by pending transfers.

Transfers reserve the source balance immediately but do not debit posted balance until accepted. Only the intended recipient, or a company owner receiving into the company cash account, can accept. Sender cannot accept a transfer to another person. Reject/cancel release the reservation. Confirmed transfers are internal asset movements, never expenses. Owner depositing their own held funds into company cash is an explicit immediate command. Advances to another employee are transfers, not costs; the eventual expense is recognized once.

Completed trip operations and open receivables are independent. Authorized receipts can settle a completed trip; genuinely cancelled bookings cannot receive ordinary fare receipts. All actual receipts retain operation date and insertion date. Staff can collect on an assigned trip without pretending to be its driver. Owner/admin/developer can collect operationally across the company. Other staff require explicit assignment.

UAH, PLN, EUR and USD are supported end to end. Monobank remains the accepted automatic rate source. Daily observations are stored, and each operation freezes the actual applied rate. An unavailable historical observation must not silently use today's rate: an authorized member supplies an explicit dated rate and reason. Physical currency exchange records both actual surrendered and received amounts atomically. No floating-point money arithmetic.

Trip reporting currency defaults to the trip quote currency. Show cash revenue and actual expenses converted with operation-date snapshots, plus outstanding receivables separately. Transfers, advances and wallet exchange do not become trip expenses. Missing historical rates produce an explicit incomplete report rather than a fabricated zero. A separate earned-vs-cash accounting policy can be introduced later without rewriting native transactions.

Crew pay is specified per person and currency. Legacy primary-driver payroll remains compatible; secondary crew accrual must be idempotent, and completion must not double-accrue the primary driver. Crew assignment is the authorization boundary for passenger data, payment collection and trip tools. Tenant boundaries, inactive membership checks and developer permissions remain mandatory.

## Shared HTTP contract

All paths below are `/api/v1/tenants/{slug}`; Next proxies preserve authentication and use `no-store`. Errors are `{error:string}` with 400 validation, 403 permission, 404 scoped absence and 409 conflicting state. Financial actions are explicit; ordinary crew field updates autosave on blur/choice.

- `GET /finance/workspace`: `{wallets,transfers,expenses,receipts,members,trips,membershipId,canManage}`. Wallet fields: `accountId,ownerType,ownerId,name,currency,balanceMinor,reservedMinor,availableMinor`. All amounts are integers. Expose only own data to ordinary assigned staff; finance roles see company data.
- `POST /finance/workspace`: `{action,requestId,accountId?,recipientAccountId?,targetMembershipId?,targetKind?,bookingId?,tripId?,amountMinor?,currency?,targetCurrency?,targetAmountMinor?,rate?,occurredAt?,description?,category?,id?}`. Actions: `receive,expense,exchange,transfer,accept,reject,cancel,deposit,reverse,rate`. `rate` is decimal text and describes booking-currency units per one native tender unit for receipts. Rate-history actions use `date,currency,rateToUAH,description`. Receipt allocations cannot exceed the open booking debt; physical over-tender/change can be recorded as distinct movements, not hidden overpayment.
- `GET /finance/booking-payments?bookingId=UUID`: `{bookingId,tripId,currency,priceMinor,settledMinor,outstandingMinor,receipts,canReceive,disabledReason}`. Receipt fields retain `id,amountMinor,currency,settledMinor,rate,occurredAt,collectorName`. This replaces the restrictive owner-only cash dialog while retaining old endpoints for compatibility.
- `GET /finance/trips?tripId=UUID`: `{items:[{tripId,currency,revenueMinor,expenseMinor,profitMinor,outstandingMinor,rateMissing}]}`. Omitting tripId returns the company trip summary for the list.
- `GET /trips/{tripID}/crew`: `{items,eligibleMembers}`. Crew fields: `membershipId,name,role,canDrive,canCollect,canBoard,canManage,canGPS,payMinor,payCurrency`. Roles: `driver,manager`. PATCH takes one member's partial fields plus `membershipId` and optional `remove:true`. GET `/me/trips` provides trips assigned to the current member and capabilities, including historical unsettled trips. Crew may be configured before a driver has application access; only active members gain application permissions.

## Research and adaptation

- [TigerBeetle two-phase transfers](https://docs.tigerbeetle.com/coding/two-phase-transfers/): reserve funds, then post or void; linked same-currency entries support atomic currency exchange. Adopt these invariants within PostgreSQL, not TigerBeetle's storage engine.
- [Formance Ledger repository](https://github.com/formancehq/ledger): explicit transactions and safe request retry/idempotency. Adopt journal and command boundaries; a new distributed service is unnecessary at current scope.
- [ERPNext Payment Entry documentation](https://docs.frappe.io/erpnext/payment-entry) and [implementation](https://github.com/frappe/erpnext/blob/develop/erpnext/accounts/doctype/payment_entry/payment_entry.py): distinguish actual payment, invoice allocation, currencies and exchange rates; internal transfers are separate from income/expense. Adopt the distinction without copying its UI or full general ledger.

These are architecture references, not proof that Vivat implements them. Proof belongs in integration tests and the delivery document.

Operating and migration guide: [operations-v2-usage.md](../operations-v2-usage.md). Manager payout contract: `GET/POST /crew-payroll`; commands use accrualId, accountId, amountMinor and actor-bound requestId, with no duplicate expense. Trip reporting additionally returns label, startsAt and status, and accepts inclusive local from/to dates.
