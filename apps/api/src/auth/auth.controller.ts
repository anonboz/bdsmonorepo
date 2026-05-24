import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LOCALE_COOKIE, localeSchema } from '@repo/shared';

import { auth } from './better-auth.config.js';
import { Public } from './decorators/public.decorator.js';
import { runWithLocale } from './locale-context.js';

/**
 * Forwards every request under `/v1/auth/*` to the Better-Auth handler.
 * Better-Auth speaks the Fetch API; we convert Fastify req → Web Request
 * → Web Response → Fastify reply.
 *
 * `@Public()` opts out of the global AuthGuard — the auth endpoints ARE the
 * login flow, so they must be reachable without an existing session.
 */
@ApiExcludeController()
@Public()
@Controller('auth')
export class AuthController {
  @All('*')
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? 'localhost'}`);

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
      else headers.append(k, String(v));
    }

    const init: RequestInit = {
      method: req.method,
      headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body == null ? undefined : JSON.stringify(req.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }

    const webReq = new Request(url, init);

    // Phase 11.2 — propagate the visitor's chosen locale (from the
    // `bds-locale` cookie) into better-auth's user-create hook so a
    // signup that completes inside this handler stamps `User.locale`
    // before the DB default ("vi") wins. Reads via `@fastify/cookie`
    // which parses + populates `req.cookies` ahead of route handlers.
    const rawCookie = req.cookies?.[LOCALE_COOKIE];
    const parsed = rawCookie ? localeSchema.safeParse(rawCookie) : null;
    const cookieLocale = parsed?.success ? parsed.data : null;

    const webRes = await runWithLocale(cookieLocale, () => auth.handler(webReq));

    reply.status(webRes.status);
    webRes.headers.forEach((value, key) => {
      // Fastify sets content-length itself; defer set-cookie via append
      if (key.toLowerCase() === 'set-cookie') reply.header('set-cookie', value);
      else reply.header(key, value);
    });

    const body = await webRes.text();
    void reply.send(body);
  }
}
