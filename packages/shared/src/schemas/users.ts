import { z } from 'zod';

import { emailSchema, idSchema } from './common';
import { roleSchema } from '../enums/role';

/**
 * Minimal user shape exposed by lookup endpoints — just enough to render
 * a picker. Not the full User row (which has private fields like phone).
 */
export const userLookupSchema = z.object({
  id: idSchema,
  displayName: z.string(),
  email: emailSchema.nullable(),
  roles: z.array(roleSchema),
  isSuspended: z.boolean(),
});

export type UserLookup = z.infer<typeof userLookupSchema>;
