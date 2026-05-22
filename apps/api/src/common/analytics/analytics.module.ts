import { Global, Module } from '@nestjs/common';

import { AnalyticsService } from './analytics.service.js';

/**
 * Analytics is `@Global()` so every domain service that emits an
 * event (bills, payments, webhooks, service-jobs, future signup
 * hook) can inject `AnalyticsService` without an explicit `imports`
 * entry — same pattern as Mailer / Storage / Notifications.
 */
@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
