import type { ZodSchema, infer as ZodInfer } from 'zod';

import { attachZodSchema } from '../pipes/zod-validation.pipe.js';

/**
 * Builds a class wrapping a Zod schema so it can be used as a NestJS DTO type.
 * The class doubles as a TS type via `instance.parsed`, but the canonical
 * usage is:
 *
 *   const CreateHouseDto = createZodDto(createHouseSchema);
 *   type CreateHouseDto = z.infer<typeof createHouseSchema>;
 *
 *   @Post()
 *   create(@Body() body: CreateHouseDto) { ... }
 *
 * The global ZodValidationPipe reads the schema off the class via metadata.
 */
export function createZodDto<S extends ZodSchema>(schema: S): ZodDtoClass<S> {
  class ZodDto {
    static readonly schema = schema;
  }
  attachZodSchema(ZodDto, schema);
  return ZodDto as ZodDtoClass<S>;
}

export interface ZodDtoClass<S extends ZodSchema> {
  new (): ZodInfer<S>;
  readonly schema: S;
}
