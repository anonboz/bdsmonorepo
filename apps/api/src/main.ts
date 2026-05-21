import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { ErrorCodes, PROBLEM_CONTENT_TYPE } from '@repo/shared';

import { AppModule } from './app.module.js';
import { ProblemFilter } from './common/filters/problem.filter.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { env } from './env.js';

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

  if (!env.API_DISABLE_RATE_LIMIT) {
    await app.register(fastifyRateLimit, {
      global: true,
      max: 600,
      timeWindow: '1 minute',
      // Trusted proxy (set on the adapter above) means we honor X-Forwarded-For.
      // Falls back to the socket address when no header is present.
      keyGenerator: (req) => req.ip,
      // Return a Problem (RFC 7807) body that matches our ProblemFilter
      // shape — fastify-rate-limit short-circuits Nest's filter chain so we
      // build the body ourselves here.
      errorResponseBuilder: (req, ctx) => ({
        type: ErrorCodes.RATE_LIMITED,
        title: 'Too many requests',
        status: 429,
        detail: `Rate limit exceeded. Retry after ${Math.ceil(ctx.ttl / 1000)}s.`,
        instance: req.url,
        traceId: (req.headers['x-trace-id'] as string | undefined) ?? req.id,
      }),
      // Helmet sends application/json by default for 429; force the problem
      // content-type so clients can branch on it like any other error.
      onExceeding: () => undefined,
      onExceeded: () => undefined,
    });

    // Tighter per-route ceilings. Attached via a preHandler hook because
    // Nest controllers don't expose Fastify's route-config object.
    const fastify = app.getHttpAdapter().getInstance();
    const limiters = [
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/email-otp/send-verification-otp'),
        handler: fastify.rateLimit({ max: 5, timeWindow: '1 minute' }),
      },
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/sign-in/email-otp'),
        handler: fastify.rateLimit({ max: 10, timeWindow: '1 minute' }),
      },
      {
        match: (url: string, method: string) => method === 'POST' && url === '/v1/me/applications',
        handler: fastify.rateLimit({ max: 20, timeWindow: '1 hour' }),
      },
      {
        match: (url: string, method: string) => method === 'POST' && url === '/v1/me/tickets',
        handler: fastify.rateLimit({ max: 10, timeWindow: '1 minute' }),
      },
    ];

    fastify.addHook('onRequest', async function (req, reply) {
      for (const { match, handler } of limiters) {
        if (match(req.url, req.method)) {
          // `this` here is the FastifyInstance — the handler returned by
          // fastify.rateLimit() expects to be invoked as a route handler.
          await handler.call(this, req, reply);
          return;
        }
      }
    });

    // After the rate-limit plugin replies with 429 it sets content-type to
    // 'application/json'. Patch the outgoing header before send so clients
    // see the canonical problem+json type.
    fastify.addHook('onSend', async (_req, reply, payload) => {
      if (reply.statusCode === 429) {
        reply.header('content-type', PROBLEM_CONTENT_TYPE);
      }
      return payload;
    });
  }

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz', 'docs', 'docs-json'] });
  app.useGlobalPipes(new ZodValidationPipe());
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
