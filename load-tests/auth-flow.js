import { check } from 'k6';
import http from 'k6/http';

// Auth OTP roundtrip — 10 rps for 1 min. Exercises better-auth's
// send-verification-otp + sign-in/email-otp endpoints end-to-end,
// hitting the Verification table write + the better-auth signing
// path on every iteration.
//
// k6 can't read the OTP from Postgres, so the verify step posts a
// known-wrong OTP and accepts the 401. That still exercises the
// DB lookup + better-auth validation + the rate-limit decision,
// which is the load we want to characterise. A "successful" auth
// flow is covered by the Playwright e2e suite.
//
// Requires API_DISABLE_RATE_LIMIT=true — 10 rps blows through
// the send-otp per-route limit (5/min) in ~30s.

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:4001';

export const options = {
  scenarios: {
    auth: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 20,
      maxVUs: 40,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    // 401 on verify is expected (wrong OTP); only count network
    // failures and 5xx as failure.
    'http_req_failed{name:send_otp}': ['rate<0.01'],
    checks: ['rate>0.95'],
  },
};

export default function () {
  // Unique email per VU + iteration so we don't collide on the
  // Verification table's (identifier) lookup. better-auth's
  // emailOTP plugin keys on `sign-in-otp-<email>`.
  const email = `loadtest-vu${__VU}-iter${__ITER}@test.local`;

  const send = http.post(
    `${BASE_URL}/v1/auth/email-otp/send-verification-otp`,
    JSON.stringify({ email, type: 'sign-in' }),
    {
      headers: { 'content-type': 'application/json' },
      tags: { name: 'send_otp' },
    },
  );
  check(send, {
    'send-otp 200': (r) => r.status === 200,
  });

  const verify = http.post(
    `${BASE_URL}/v1/auth/sign-in/email-otp`,
    JSON.stringify({ email, otp: '000000' }),
    {
      headers: { 'content-type': 'application/json' },
      tags: { name: 'verify_otp' },
    },
  );
  check(verify, {
    // 401 = wrong OTP path (expected). 200 would be surprising —
    // it would mean the OTP plugin accepted '000000', which is
    // never true for a fresh row.
    'verify-otp returned': (r) => r.status === 401 || r.status === 200,
  });
}
