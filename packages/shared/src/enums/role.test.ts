import { describe, expect, it } from 'vitest';

import { ALL_ROLES, Role, roleSchema } from './role.js';

describe('Role enum', () => {
  it('parses the four canonical roles', () => {
    for (const r of ALL_ROLES) {
      expect(roleSchema.parse(r)).toBe(r);
    }
  });

  it('rejects unknown roles', () => {
    expect(roleSchema.safeParse('SUPERUSER').success).toBe(false);
  });

  it('exposes ALL_ROLES matching the const map', () => {
    expect(new Set(ALL_ROLES)).toEqual(new Set(Object.values(Role)));
  });
});
