/* eslint-disable no-console */
/**
 * One-off: enqueue a `bills.generate` job against the running API's Redis,
 * then exit. Use to verify the worker actually consumes — watch the API
 * stdout for the "generating bill" log line.
 *
 *   pnpm --filter @repo/api exec tsx scripts/enqueue-test-job.ts <leaseId> [periodStart]
 */
import 'dotenv/config';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

async function main(): Promise<void> {
  const leaseId = process.argv[2];
  const periodStart = process.argv[3] ?? new Date().toISOString().slice(0, 7) + '-01';

  if (!leaseId) {
    console.error('usage: enqueue-test-job.ts <leaseId> [periodStart=YYYY-MM-01]');
    process.exit(2);
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('REDIS_URL must be set');
    process.exit(2);
  }

  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  const queue = new Queue('bills.generate', { connection, prefix: 'bds' });

  await queue.add('generate', { leaseId, periodStart }, { jobId: `gen:${leaseId}:${periodStart}` });
  console.log(`enqueued gen:${leaseId}:${periodStart}`);

  await queue.close();
  await connection.quit();
}

void main();
