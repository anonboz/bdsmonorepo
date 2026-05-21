import { check } from 'k6';
import http from 'k6/http';

// Public read-path load test — 50 rps for 2 min, hits
// /v1/public/campaigns (the only truly public read in v1) and
// /healthz. Two requests per iteration → ~100 actual rps.
//
// Maps to BUILD_PLAN §6 item 2's "50 rps, 95p < 500ms" target.
// Payment + webhook scripts will follow this template when those
// endpoints ship in Phase 7+.

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3001';

export const options = {
  scenarios: {
    public_reads: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  // Sweep through limits to keep the cursor warm + the Prisma
  // query plan from caching on one shape.
  const limit = 5 + Math.floor(Math.random() * 20);
  const campaigns = http.get(`${BASE_URL}/v1/public/campaigns?limit=${limit}`, {
    tags: { name: 'public_campaigns' },
  });
  check(campaigns, {
    'campaigns 200': (r) => r.status === 200,
    'campaigns parses': (r) => Array.isArray(r.json('items')),
  });

  const healthz = http.get(`${BASE_URL}/healthz`, {
    tags: { name: 'healthz' },
  });
  check(healthz, {
    'healthz 200': (r) => r.status === 200,
  });
}
