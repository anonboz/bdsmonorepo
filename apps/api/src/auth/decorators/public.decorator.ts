import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = Symbol.for('@repo/api:is-public');

/** Marks a route as unauthenticated — AuthGuard skips it. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
