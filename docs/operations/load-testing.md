# Load testing runbook

How to run the k6 load suite, when to fire it, and how to read
the summary it spits out.

## 1. The suite

| Script            | What it does                                                | Threshold                                                |
| ----------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `smoke.js`        | 1 VU × 10s. Sanity check that k6 and the API are talking.   | All checks pass, < 1% failed requests.                   |
| `public-reads.js` | 50 rps × 2 min against `/v1/public/campaigns` + `/healthz`. | `http_req_duration` p95 < **500 ms**, failure rate < 1%. |
| `auth-flow.js`    | 10 rps × 1 min of OTP send + verify roundtrips.             | `http_req_duration` p95 < **800 ms**, failure rate < 1%. |

Targets pinned in each script via k6's `thresholds:` block. A run
exits non-zero when a threshold breaches — CI surfaces that as a
red workflow.

The build plan target ("50 rps, 95p < 500 ms" — §6 item 2) maps
to `public-reads.js`. Payment + webhook scripts will join the
suite when Phase 7 wires Stripe / VNPay; the auth-flow script is
the template.

## 2. Running locally

```sh
# Once: install k6.
brew install k6                          # macOS
sudo apt-get install -y k6               # Debian/Ubuntu with the official repo
# (https://k6.io/docs/get-started/installation/)

# Start a local API with rate limit + queues off. Auth-flow's
# 10 rps blows through the OTP per-route limit (5/min) in seconds
# otherwise.
docker compose up -d postgres redis
DATABASE_URL=postgresql://app:app@localhost:5432/app \
  API_DISABLE_QUEUES=true \
  API_DISABLE_RATE_LIMIT=true \
  pnpm --filter @repo/api dev

# In another shell:
k6 run load-tests/smoke.js
k6 run load-tests/public-reads.js
k6 run load-tests/auth-flow.js
```

`API_BASE_URL=https://api.staging.<domain> k6 run load-tests/public-reads.js`
points the same scripts at a remote API. **Do not run against
production without coordinating with on-call** — even 50 rps is
above baseline traffic for a pre-launch platform.

## 3. Running via GitHub Actions

`Actions → Load tests (k6) → Run workflow → main`.

The workflow spins its own Postgres + Redis, builds the API,
boots it locally, runs each script, and uploads
`smoke-summary.json`, `public-reads-summary.json`,
`auth-flow-summary.json` as a 30-day artifact.

Trigger when:

- Reviewing a PR that touches the API hot path (controllers, the
  Prisma queries, middleware, the auth flow).
- Before bumping `@nestjs/*` or `fastify` versions.
- Before each Phase 7+ payment milestone, to validate against
  whatever new endpoints landed.

Don't run on every push — k6 is single-machine, blocks an Actions
runner for ~5 min, and isn't free in the bigger picture.

## 4. Reading the summary

k6's summary on stdout looks like:

```
  ✓ campaigns 200
  ✓ campaigns parses

  checks.........................: 100.00% ✓ 12000  ✗ 0
  data_received..................: 18 MB   150 kB/s
  http_req_blocked...............: avg=42µs    min=1µs   med=4µs    max=27ms
  http_req_duration..............: avg=21ms    min=3ms   med=18ms   max=412ms
    { expected_response:true }...: avg=21ms    min=3ms   med=18ms   max=412ms
  http_req_failed................: 0.00%   ✓ 0      ✗ 6000
  http_req_receiving.............: avg=89µs    min=20µs  med=80µs   max=12ms
  ...
  iteration_duration.............: avg=21ms    min=3ms   med=18ms   max=413ms
  vus............................: 50
  vus_max........................: 50

  ✓ http_req_duration..............: p(95)=178ms ≤ 500ms
  ✓ http_req_failed................: rate=0%     ≤ 1%
  ✓ checks.........................: rate=100%   ≥ 99%
```

The lines at the bottom marked `✓ http_req_duration...` are the
thresholds. Green checks → workflow passes. A `✗` → workflow
fails.

What to look at when the run is slower than expected:

1. **Compare `med` to `p(95)`**. A small median + big p(95)
   means a tail problem (one slow endpoint dragging the
   percentile). Slice by `tags` (the scripts tag each request).
2. **Check the `name:` breakdown**. If `public_campaigns` is
   180 ms p95 and `healthz` is 5 ms, the issue is in
   `partners.service.ts`-style code, not the framework.
3. **`http_req_blocked`** high → connection pool exhausted.
   Bump `preAllocatedVUs` in the script or the API's `maxConnections`.
4. **`http_req_waiting`** high → server processing. Time
   to add a `console.time` in the controller / service and
   re-run.

The `--summary-export` JSON in the workflow artifact carries the
same data plus full per-metric histograms. Pipe it through `jq`:

```sh
jq '.metrics.http_req_duration.values' public-reads-summary.json
```

## 5. Adjusting thresholds

When a baseline run looks healthy at a different number than the
spec, update the script's `thresholds:` block **in the same PR**
that ships the perf improvement / regression. The runbook table
in §1 should change too — a threshold that lives in two places
goes stale in one of them.

Don't loosen a threshold to make CI green. Tighten it; if you
can't, file an issue and fix the underlying slowness.

## 6. Limitations

- **Single-machine** — at 50 rps a laptop + the CI runner are
  fine. Above ~500 rps we'd need k6 Cloud or distributed k6.
  Out of scope for v1.
- **No browser flow** — k6-browser exists but Playwright (the
  Phase 6.2 suite) is the right tool for "real user flow".
  k6 here is for raw API throughput.
- **Wrong-OTP path in auth-flow** — the script can't read the
  real OTP from Postgres, so it posts `000000` and accepts the 401. The DB write + better-auth code path still executes;
  what we miss is the session-create cost. Acceptable trade for
  load characterization.
- **Production runs** — manual + coordinated only. See §2.
