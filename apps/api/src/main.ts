import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { env } from './env.js';
import { ProblemFilter } from './common/filters/problem.filter.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: false, // pino is wired via nestjs-pino instead
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  });
  await app.register(fastifyCookie, { secret: env.AUTH_SECRET });
  await app.register(fastifyCors, {
    origin: env.API_CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-trace-id'],
    exposedHeaders: ['x-trace-id'],
  });

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz', 'docs', 'docs-json'] });
  app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }));
  app.useGlobalFilters(new ProblemFilter());

  if (env.NODE_ENV !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('BDS API')
      .setDescription('Multi-app rental platform API')
      .setVersion('1.0.0')
      .addCookieAuth('session')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, doc, {
      jsonDocumentUrl: 'docs-json',
    });
  }

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });

  // eslint-disable-next-line no-console
  console.log(`✅ API listening on ${env.API_PUBLIC_URL} (${env.NODE_ENV})`);
}

void bootstrap();
