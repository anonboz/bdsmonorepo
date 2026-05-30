import { check } from 'k6';
import http from 'k6/http';

// Smoke test — 1 VU for 10s. Sanity that k6 + the API are wired
// before running the heavier scenarios. If this red-fails, the
// public-reads + auth-flow runs are pointless.

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:4001';

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    checks: ['rate==1'], // every check must pass
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const healthz = http.get(`${BASE_URL}/healthz`);
  check(healthz, {
    'healthz 200': (r) => r.status === 200,
    'healthz reports ok': (r) => r.json('status') === 'ok',
  });

  const campaigns = http.get(`${BASE_URL}/v1/public/campaigns?limit=5`);
  check(campaigns, {
    'campaigns 200': (r) => r.status === 200,
    'campaigns has items array': (r) => Array.isArray(r.json('items')),
  });
}
