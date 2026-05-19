import {
  createUnitSchema,
  listUnitsQuerySchema,
  type unitSchema,
  updateUnitSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateUnitDto = createZodDto(createUnitSchema);
export type CreateUnitDto = typeof createUnitSchema._type;

export const UpdateUnitDto = createZodDto(updateUnitSchema);
export type UpdateUnitDto = typeof updateUnitSchema._type;

export const ListUnitsQueryDto = createZodDto(listUnitsQuerySchema);
export type ListUnitsQueryDto = typeof listUnitsQuerySchema._type;

export type UnitResponse = typeof unitSchema._type;
