/**
 * Single source of truth for queue + job names. Both producers
 * (controllers, schedulers) and consumers (processors) import from here so
 * the strings never drift.
 */

export const QUEUE_BILLS_GENERATE = 'bills.generate';
export const QUEUE_BILLS_SWEEP = 'bills.sweep';
export const QUEUE_CAMPAIGNS_EXPIRY = 'campaigns.expiry-sweep';

export const JOB_BILLS_GENERATE = 'generate';
export const JOB_BILLS_DAILY_SWEEP = 'daily-sweep';
export const JOB_CAMPAIGNS_DAILY_EXPIRY = 'daily-expiry';

/** Stable job ids for repeating sweeps — lets us safely re-register on
 *  every boot without queueing duplicate schedulers. */
export const REPEAT_JOB_ID_BILLS_DAILY_SWEEP = 'bills.daily-sweep:singleton';
export const REPEAT_JOB_ID_CAMPAIGNS_DAILY_EXPIRY = 'campaigns.daily-expiry:singleton';

export interface BillsGenerateJobData {
  leaseId: string;
  /** ISO date (YYYY-MM-DD). The service computes period boundaries from this. */
  periodStart: string;
}

export interface BillsGenerateJobResult {
  billId: string;
  status: 'created' | 'idempotent';
}
