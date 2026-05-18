import {
  createHouseSchema,
  houseSchema,
  listHousesQuerySchema,
  updateHouseSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateHouseDto = createZodDto(createHouseSchema);
export type CreateHouseDto = typeof createHouseSchema._type;

export const UpdateHouseDto = createZodDto(updateHouseSchema);
export type UpdateHouseDto = typeof updateHouseSchema._type;

export const ListHousesQueryDto = createZodDto(listHousesQuerySchema);
export type ListHousesQueryDto = typeof listHousesQuerySchema._type;

export type HouseResponse = typeof houseSchema._type;
