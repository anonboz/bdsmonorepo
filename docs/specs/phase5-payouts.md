# Spec: Payments + commission + payout ledger (phase 5.4)

> Status: **draft**
> Phase: 5
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

5.2 + 5.3 ship the booking flow up to `COMPLETED`. Nothing happens
financially. This slice records the **math** of every completed job so
"both rate → ledger entries balance" from the Phase 5 acceptance is
satisfiable. Real money movement — Stripe / VNPay charging the owner,
disbursing to the partner — is deferred to Phase 6 alongside the
provider wiring. v1 uses a `MANUAL` provider; the ledger is the source
of truth for what _should_ have moved.

## 2. User stories

- As a **partner**, I want to see what I've earned per job, broken
  down by status (held during cooldown, released after, lifetime
  total) so I can plan around payouts.
- As an **owner**, I want to see what I owe for each completed job so
  I'm not surprised when a manual bank transfer lands.
- As the **platform**, I want a commission row recorded for each job
  so we can audit revenue without scanning every job total.

## 3. Screens / surfaces

| Surface         | App     | Route                | Notes                                           |
| --------------- | ------- | -------------------- | ----------------------------------------------- |
| Partner payouts | partner | `/payouts`           | List + held / released / lifetime summary cards |
| Owner charges   | owner   | `/me/charges`        | List of completed-job charges                   |
| Partner API     | api     | `GET /v1/me/payouts` | Lists partner's PAYOUT entries                  |
| Owner API       | api     | `GET /v1/me/charges` | Lists owner's CHARGE entries                    |

## 4. API shape

```ts
// @repo/shared/schemas/payouts.ts
export const payoutEntryKindSchema = z.enum(['CHARGE', 'COMMISSION', 'PAYOUT']);
export const payoutEntryStatusSchema = z.enum(['PENDING', 'HELD', 'RELEASED']);

export const jobLedgerEntrySchema = z.object({
  id: idSchema,
  jobId: idSchema,
  kind: payoutEntryKindSchema,
  status: payoutEntryStatusSchema,
  /** Minor units. Signed. */
  amount: z.number().int(),
  currency: currencySchema,
  accountUserId: idSchema.nullable(),
  cooldownUntil: isoDateTimeSchema.nullable(),
  releasedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const listLedgerEntriesQuerySchema = paginationQuerySchema.extend({
  status: payoutEntryStatusSchema.optional(),
});
```

### Endpoints

| Method | Path             | Role    | Description                           |
| ------ | ---------------- | ------- | ------------------------------------- |
| GET    | `/v1/me/payouts` | PARTNER | List partner's PAYOUT entries (paged) |
| GET    | `/v1/me/charges` | OWNER   | List owner's CHARGE entries (paged)   |

No new mutation endpoints — entries are minted server-side when the
partner marks a job COMPLETED. Future Phase 6 work will add a
"release-now" admin override and refund flow.

## 5. Data model

```prisma
enum PayoutEntryKind {
  CHARGE       // owner owes platform
  COMMISSION   // platform's cut
  PAYOUT       // partner earns
}

enum PayoutEntryStatus {
  PENDING      // freshly minted (CHARGE + COMMISSION default state)
  HELD         // PAYOUT in its cooldown window
  RELEASED     // PAYOUT cleared; partner can claim
}

model JobLedgerEntry {
  id            String              @id @default(cuid())
  jobId         String
  job           ServiceJob          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  kind          PayoutEntryKind
  status        PayoutEntryStatus   @default(PENDING)
  /// Minor units. Sign convention: `CHARGE` is negative (owner debit),
  /// `COMMISSION` + `PAYOUT` are positive (credits). Sum across the
  /// three rows of one job = 0 — that's the "ledger entries balance"
  /// invariant from the Phase 5 acceptance.
  amount        Int
  currency      String              @db.Char(3)
  /// For CHARGE: the owner. For PAYOUT: the partner's user id.
  /// For COMMISSION: null (the platform is the implicit account).
  accountUserId String?
  /// Only set on PAYOUT entries. Sweeper flips status → RELEASED when
  /// `cooldownUntil <= now`.
  cooldownUntil DateTime?
  releasedAt    DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([jobId, kind])
  @@index([accountUserId, status])
  @@index([status, cooldownUntil])
}
```

Migration: `job_ledger`. Empty table — additive only.

## 6. Numbers

- **Commission rate**: 10% (`PLATFORM_COMMISSION_BPS = 1000`).
  Hardcoded constant in this slice; the Phase 3.4 deferred "fee /
  commission config" will move it to a config table when partner
  payouts go live.
- **Round commission down** (floor toward zero) so the partner picks
  up the rounding remainder.
- **Cooldown**: 3 days from the completion timestamp.
- **Currency**: copied from the job's `currency` at completion. We
  reject completion with no currency (defensive — service guarantees
  this is set via quote, but we double-check).

```
finalAmount = 50_000 (VND)
commission  = floor(50_000 * 1000 / 10_000) = 5_000
partnerCut  = finalAmount - commission       = 45_000

CHARGE     amount = -50_000  status = PENDING  account = owner
COMMISSION amount =  +5_000  status = PENDING  account = null
PAYOUT     amount = +45_000  status = HELD     account = partner
                                              cooldownUntil = now + 3d
```

`-50_000 + 5_000 + 45_000 == 0`.

## 7. Workers / jobs

New BullMQ queue `payouts.release-sweep` with a daily repeat at
`02:00 UTC` (1h before `bills.daily-sweep` to keep the morning load
spread out). Flips every `HELD` `PAYOUT` row with `cooldownUntil <
now` to `RELEASED`, setting `releasedAt = now`. One audit row per
released payout (`payout.release`).

Idempotent: re-running on an already-released row is a no-op (filter
in the where clause).

`API_DISABLE_QUEUES=true` still skips registration like the existing
bills + campaigns sweepers.

## 8. Server-side behavior on job complete

`completeForPartner` in `ServiceJobsService` becomes:

```ts
$transaction:
  update job → COMPLETED, finalAmount, completedAt, proofPhotos
  mint CHARGE     row (-finalAmount, PENDING, account=owner)
  mint COMMISSION row (+commission,  PENDING, account=null)
  mint PAYOUT     row (+partnerCut,  HELD,    account=partner, cooldownUntil=now+3d)
  audit job.complete  (existing — meta gains `commission` + `partnerCut`)
  audit job.ledger_minted (new; meta { commission, partnerCut, currency })
```

If `finalAmount` is `0` (free job — already valid via the schema),
all three rows are written with `0` so the audit trail is still
complete; the sweeper handles a `0` PAYOUT identically (releases
after cooldown). No special case.

## 9. Permissions

- **PARTNER** sees own PAYOUT entries via `/v1/me/payouts`. Filtering
  by status (`HELD` / `RELEASED`) is supported.
- **OWNER** sees own CHARGE entries via `/v1/me/charges`.
- **COMMISSION** entries are platform-internal. They're visible only
  via the admin audit log (out of scope for the UI in this slice).
- Cross-party reads return 404 (existence-hiding).

## 10. Audit log

| Action              | Target                | Meta keys                                             | Actor   |
| ------------------- | --------------------- | ----------------------------------------------------- | ------- |
| `job.complete`      | `ServiceJob:<id>`     | (existing) + `commission`, `partnerCut`               | partner |
| `job.ledger_minted` | `ServiceJob:<id>`     | `finalAmount`, `commission`, `partnerCut`, `currency` | partner |
| `payout.release`    | `JobLedgerEntry:<id>` | `jobId`, `amount`, `currency`, `cooldownUntil`        | `null`  |

## 11. Edge cases

- **`completeForPartner` already minted entries for this job** — guard
  against double-mint with an `existsAny` check before insert; surface
  as 500 if it ever happens (we never expect it, but it's a
  cheap safety belt). Concretely: count `JobLedgerEntry` rows where
  `jobId = X AND kind = CHARGE` first; if any, throw
  `internal_error`. The unique constraint isn't on `(jobId, kind)`
  because PAYOUT could in theory split across multiple partners in a
  future model — keeping the schema open.
- **finalAmount = 0** — mint zero-value rows; cooldown still applies
  (no-op release). Lets reports count freebies as jobs.
- **Currency missing** — service throws `internal_error`; should be
  impossible because quote sets it.
- **Sweeper double-fires** — `update WHERE status = HELD` makes the
  release idempotent.
- **Refunds / cancellations after COMPLETED** — out of scope. Once a
  job is `COMPLETED` and ledger is minted, this slice doesn't support
  reversal. Phase 6 adds it.

## 12. Out of scope

- **Real Stripe / VNPay charging** — Phase 6.
- **Admin override / manual release** — later.
- **Refund / reversal flow** — later.
- **Per-currency commission rates** — single global rate for now.
- **Net partner balance UI math** — the v1 UI shows entries; the
  partner can sum mentally. A "ready to withdraw" amount is a Phase 6
  polish.
- **Fee / commission config UI** — still deferred (was Phase 3.4b
  option C). Hardcoded constant carries us until a partner asks.

## 13. Acceptance criteria

- [x] Partner POST `/v1/me/jobs/:id/complete` mints exactly 3 ledger
      entries; sum of `amount` across them is `0`.
- [x] CHARGE row is `PENDING` and tied to `accountUserId = ownerId`.
- [x] COMMISSION row is `PENDING` and `accountUserId IS NULL`.
- [x] PAYOUT row is `HELD` with `cooldownUntil = completedAt + 3d` and
      `accountUserId = partner's userId`.
- [x] Two new audit rows on complete (`job.complete` augmented +
      `job.ledger_minted`).
- [x] BullMQ sweeper flips eligible HELD PAYOUT rows to RELEASED,
      writes a `payout.release` audit row each.
- [x] Partner GET `/v1/me/payouts` returns their PAYOUT entries.
- [x] Owner GET `/v1/me/charges` returns their CHARGE entries.
- [x] Cross-party access → 404 (handled via per-account `accountUserId`
      filter; reads scoped to caller's id).

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with prior phases). Coverage held by the 3 new
ledger-minting cases in `service-jobs.service.spec.ts` + 4 cases in
`payouts.service.spec.ts`.

## 14. Manual test plan

1. As owner1 → book partner → partner quotes → owner accepts → partner
   starts + completes a job for ₫50,000 (VND).
2. Check `JobLedgerEntry` in DB: 3 rows summing to 0; PAYOUT is HELD
   with `cooldownUntil` ~ 3 days out.
3. As the partner on `/payouts` → see one HELD row for ₫45,000.
4. As owner1 on `/me/charges` → see one PENDING row for −₫50,000.
5. Backdate the PAYOUT's `cooldownUntil` to yesterday → fire the
   sweeper → row flips to RELEASED.
6. Refresh `/payouts` → see ₫45,000 under "Released".

## 15. Rollout

- Migration is additive (empty table).
- No flag.
- Comms: dev changelog note ("partner payouts ledger live; real
  charging via Stripe lands in Phase 6").
