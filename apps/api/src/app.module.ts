import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AccountErasureModule } from './account/account-erasure.module.js';
import { AdminModule } from './admin/admin.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillsModule } from './bills/bills.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { AnalyticsModule } from './common/analytics/analytics.module.js';
import { MailerModule } from './common/mailer/mailer.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { env } from './env.js';
import { HealthModule } from './health/health.module.js';
import { HousesModule } from './houses/houses.module.js';
import { JobRatingsModule } from './job-ratings/job-ratings.module.js';
import { LeasesModule } from './leases/leases.module.js';
import { MediaModule } from './media/media.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OwnerDashboardModule } from './owner-dashboard/owner-dashboard.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PayoutsModule } from './payouts/payouts.module.js';
import { PlatformConfigModule } from './platform/platform-config.module.js';
import { QueuesModule } from './queues/queues.module.js';
import { RatingsModule } from './ratings/ratings.module.js';
import { ServiceJobsModule } from './service-jobs/service-jobs.module.js';
import { SignaturesModule } from './signatures/signatures.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { UnitsModule } from './units/units.module.js';
import { UsersModule } from './users/users.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true, translateTime: 'SYS:HH:MM:ss' },
              },
        customProps: (req) => ({
          traceId: (req.headers['x-trace-id'] as string | undefined) ?? undefined,
        }),
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
          censor: '[redacted]',
        },
      },
    }),
    PrismaModule,
    MailerModule,
    StorageModule,
    AnalyticsModule,
    PlatformConfigModule,
    QueuesModule,
    NotificationsModule,
    MediaModule,
    HealthModule,
    AuthModule,
    HousesModule,
    UnitsModule,
    LeasesModule,
    SignaturesModule,
    UsersModule,
    BillsModule,
    PaymentsModule,
    OwnerDashboardModule,
    TicketsModule,
    RatingsModule,
    CampaignsModule,
    ApplicationsModule,
    PartnersModule,
    ServiceJobsModule,
    PayoutsModule,
    JobRatingsModule,
    WebhooksModule,
    AdminModule,
    AccountErasureModule,
  ],
})
export class AppModule {}
