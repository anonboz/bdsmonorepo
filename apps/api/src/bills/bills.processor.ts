import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { BillsService } from './bills.service.js';
import {
  type BillsGenerateJobData,
  type BillsGenerateJobResult,
  JOB_BILLS_GENERATE,
  QUEUE_BILLS_GENERATE,
} from '../queues/queue-names.js';

/**
 * Consumes the `bills.generate` queue. The work is delegated to BillsService
 * so the same code path is reachable from the synchronous "Generate now"
 * controller; the worker just supplies retry semantics and a clean log.
 */
@Processor(QUEUE_BILLS_GENERATE)
export class BillsProcessor extends WorkerHost {
  private readonly logger = new Logger(BillsProcessor.name);

  constructor(private readonly bills: BillsService) {
    super();
  }

  override async process(job: Job<BillsGenerateJobData>): Promise<BillsGenerateJobResult> {
    if (job.name !== JOB_BILLS_GENERATE) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_BILLS_GENERATE} queue`);
      return { billId: '', status: 'idempotent' };
    }

    const { leaseId, periodStart } = job.data;
    this.logger.log(`generating bill for lease=${leaseId} period=${periodStart}`);
    const { bill, status } = await this.bills.generateForLease(leaseId, { periodStart });
    return { billId: bill.id, status };
  }
}
