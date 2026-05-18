import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { MeController } from './me.controller.js';

/**
 * Wires Better-Auth (via AuthController), exposes /me, and registers AuthGuard
 * + RolesGuard globally. AuthGuard skips routes annotated with `@Public()`;
 * RolesGuard is a no-op for routes without `@Roles(...)`.
 */
@Module({
  controllers: [AuthController, MeController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
