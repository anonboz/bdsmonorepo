import type { Problem } from '@repo/shared';

/**
 * Throwable RFC 7807 error. The global filter converts this into a
 * `application/problem+json` response.
 */
export class ProblemError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
  readonly retryAfter?: number;

  constructor(opts: {
    status: number;
    type: string;
    title: string;
    detail?: string;
    errors?: Record<string, string[]>;
    retryAfter?: number;
  }) {
    super(opts.detail ?? opts.title);
    this.status = opts.status;
    this.type = opts.type;
    this.title = opts.title;
    if (opts.detail !== undefined) this.detail = opts.detail;
    if (opts.errors !== undefined) this.errors = opts.errors;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
    this.name = 'ProblemError';
  }

  toProblem(instance?: string, traceId?: string): Problem {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail !== undefined && { detail: this.detail }),
      ...(instance !== undefined && { instance }),
      ...(this.errors !== undefined && { errors: this.errors }),
      ...(this.retryAfter !== undefined && { retryAfter: this.retryAfter }),
      ...(traceId !== undefined && { traceId }),
    };
  }
}
