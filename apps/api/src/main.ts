import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { ErrorCodes } from '@repo/shared';

import { AppModule } from './app.module.js';
import { ProblemError } from './common/errors/problem.error.js';
import { ProblemFilter } from './common/filters/problem.filter.js';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe.js';
import { env } from './env.js';
import { initSentry } from './observability/sentry.js';

// @fastify/rate-limit invokes errorResponseBuilder and THROWS the result
// (see @fastify/rate-limit/index.js: `throw params.errorResponseBuilder(...)`).
// Returning a plain object causes ProblemFilter to fall through to its
// catch-all "Unknown error" 500 branch. Returning a ProblemError makes
// ProblemFilter emit the proper 429 application/problem+json body, and the
// rate-limit headers the plugin already set on `reply` are preserved.
function buildRateLimitProblem(_req: unknown, ctx: { ttl: number }) {
  const retryAfter = Math.ceil(ctx.ttl / 1000);
  return new ProblemError({
    status: 429,
    type: ErrorCodes.RATE_LIMITED,
    title: 'Too many requests',
    detail: `Rate limit exceeded. Retry after ${retryAfter}s.`,
    retryAfter,
  });
}

async function bootstrap() {
  // Init Sentry before NestFactory.create so Sentry can patch Node
  // internals (fs/http) ahead of any other module loading. No-ops
  // cleanly when SENTRY_DSN is unset.
  initSentry();

  const adapter = new FastifyAdapter({
    logger: false, // pino is wired via nestjs-pino instead
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  // Stripe signature verification (7.3) needs the exact request bytes.
  // Replace Fastify's JSON parser with one that stashes the raw string on
  // `req.rawBody` before parsing — the global Zod pipe keeps working on
  // every other route because we still hand back the parsed object.
  // One extra string allocation per request; cheap.
  //
  // Under Fastify 5 + Nest 11 we must use `app.useBodyParser` (which
  // calls `removeContentTypeParser` first) instead of mutating the
  // adapter pre-init — the platform-fastify adapter registers its own
  // JSON parser during `init()` and Fastify 5 errors on a duplicate
  // registration. The Nest body-parser API forces `parseAs: 'buffer'`
  // (`parseAs` is omitted from the options type), so we receive a
  // Buffer and convert to string locally.
  app.useBodyParser('application/json', {}, (req, body, done) => {
    const raw = body.toString('utf-8');
    (req as { rawBody?: string }).rawBody = raw;
    if (raw.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error);
    }
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
      errorResponseBuilder: buildRateLimitProblem,
    });

    // Tighter per-route ceilings. Attached via a preHandler hook because
    // Nest controllers don't expose Fastify's route-config object.
    const fastify = app.getHttpAdapter().getInstance();
    const limiters = [
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/email-otp/send-verification-otp'),
        handler: fastify.rateLimit({
          max: 5,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/sign-in/email-otp'),
        handler: fastify.rateLimit({
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      // Phase 11.6 — mirror the email-otp limits on the SMS path so a
      // bad actor can't pivot from email-rate-limited to phone-flood.
      // `send-otp` is the expensive (paid) call; `verify` is cheap but
      // we cap it to deter brute-forcing the 6-digit code.
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/phone-number/send-otp'),
        handler: fastify.rateLimit({
          max: 5,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/phone-number/verify'),
        handler: fastify.rateLimit({
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      // Phase 12.6 — phone + password sign-in. Cap attempts per IP to
      // deter password brute-forcing; mirrors the OTP sign-in ceiling.
      {
        match: (url: string, method: string) =>
          method === 'POST' && url.startsWith('/v1/auth/sign-in/phone-number'),
        handler: fastify.rateLimit({
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      {
        match: (url: string, method: string) => method === 'POST' && url === '/v1/me/applications',
        handler: fastify.rateLimit({
          max: 20,
          timeWindow: '1 hour',
          errorResponseBuilder: buildRateLimitProblem,
        }),
      },
      {
        match: (url: string, method: string) => method === 'POST' && url === '/v1/me/tickets',
        handler: fastify.rateLimit({
          max: 10,
          timeWindow: '1 minute',
          errorResponseBuilder: buildRateLimitProblem,
        }),
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
