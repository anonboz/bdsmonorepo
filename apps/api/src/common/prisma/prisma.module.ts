import { Global, Module } from '@nestjs/common';

import { prisma } from '@repo/db';

import { PRISMA } from './prisma.token.js';

@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class PrismaModule {}
