import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { auth } from './better-auth.config.js';
import { Public } from './decorators/public.decorator.js';

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
    const webRes = await auth.handler(webReq);

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
