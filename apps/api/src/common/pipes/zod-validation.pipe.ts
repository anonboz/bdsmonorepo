import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';

import { ErrorCodes } from '@repo/shared';

import { ProblemError } from '../errors/problem.error.js';

/**
 * Picks up the Zod schema attached to a DTO via `Reflect.metadata` (set by the
 * `@Body(ZodBody(schema))` helper, etc.). When present, validates and replaces
 * the value with the parsed output. When absent, passes through.
 *
 * For controllers that prefer to validate inline, use `schema.parse(value)`
 * directly — but the canonical pattern is to declare the schema next to the
 * controller using `createZodDto`-style helpers (see `houses` module).
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = getZodSchemaFor(metadata);
    if (!schema) return value;

    try {
      return schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of err.issues) {
          const key = issue.path.join('.') || '_';
          (fieldErrors[key] ??= []).push(issue.message);
        }
        throw new ProblemError({
          status: 422,
          type: ErrorCodes.VALIDATION_FAILED,
          title: 'Validation failed',
          detail: `Invalid input for ${metadata.type}.`,
          errors: fieldErrors,
        });
      }
      throw err;
    }
  }
}

const ZOD_SCHEMA_METADATA = Symbol.for('@repo/api:zod-schema');

export function attachZodSchema(target: object, schema: ZodSchema): void {
  Reflect.defineMetadata(ZOD_SCHEMA_METADATA, schema, target);
}

function getZodSchemaFor(metadata: ArgumentMetadata): ZodSchema | undefined {
  const metatype = metadata.metatype;
  if (!metatype) return undefined;
  const schema = Reflect.getMetadata(ZOD_SCHEMA_METADATA, metatype) as ZodSchema | undefined;
  return schema;
}
