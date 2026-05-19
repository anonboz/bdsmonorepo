import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { env } from './env.js';
import { HealthModule } from './health/health.module.js';
import { HousesModule } from './houses/houses.module.js';
import { LeasesModule } from './leases/leases.module.js';
import { UnitsModule } from './units/units.module.js';
import { UsersModule } from './users/users.module.js';

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
    HealthModule,
    AuthModule,
    HousesModule,
    UnitsModule,
    LeasesModule,
    UsersModule,
  ],
})
export class AppModule {}
