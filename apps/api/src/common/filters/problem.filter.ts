import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { ErrorCodes, PROBLEM_CONTENT_TYPE, type Problem } from '@repo/shared';

import { ProblemError } from '../errors/problem.error.js';

/**
 * Converts any thrown error into an RFC 7807 problem+json response.
 * Order of resolution:
 *   1. ProblemError → use as-is.
 *   2. ZodError → 422 validation_failed with field errors.
 *   3. NestJS HttpException → map status/message.
 *   4. Anything else → 500 internal_error (no leaking message in prod).
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const res = http.getResponse<FastifyReply>();

    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? req.id;
    const instance = req.url;

    const problem = this.toProblem(exception, instance, traceId);

    res
      .status(problem.status)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .header('x-trace-id', String(traceId))
      .send(problem);
  }

  private toProblem(exception: unknown, instance: string, traceId: unknown): Problem {
    if (exception instanceof ProblemError) {
      return exception.toProblem(instance, String(traceId));
    }

    if (exception instanceof ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const key = issue.path.join('.') || '_';
        (errors[key] ??= []).push(issue.message);
      }
      return {
        type: ErrorCodes.VALIDATION_FAILED,
        title: 'Validation failed',
        status: 422,
        detail: 'Invalid request payload.',
        instance,
        errors,
        traceId: String(traceId),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : (response as { message?: string | string[] }).message
            ? Array.isArray((response as { message?: string | string[] }).message)
              ? (response as { message: string[] }).message.join('; ')
              : String((response as { message: string }).message)
            : exception.message;
      return {
        type: mapHttpStatusToErrorCode(status),
        title: exception.name,
        status,
        ...(detail && { detail }),
        instance,
        traceId: String(traceId),
      };
    }

    const isProd = process.env.NODE_ENV === 'production';
    const detail = exception instanceof Error ? exception.message : 'Unknown error';
    return {
      type: ErrorCodes.INTERNAL_ERROR,
      title: 'Internal Server Error',
      status: 500,
      ...(isProd ? {} : { detail }),
      instance,
      traceId: String(traceId),
    };
  }
}

function mapHttpStatusToErrorCode(status: number): string {
  switch (status) {
    case 401:
      return ErrorCodes.AUTH_UNAUTHENTICATED;
    case 403:
      return ErrorCodes.AUTH_FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 422:
      return ErrorCodes.VALIDATION_FAILED;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL_ERROR;
  }
}
