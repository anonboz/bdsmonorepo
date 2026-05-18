import { describe, expect, it } from 'vitest';

import {
  addressSchema,
  currencySchema,
  emailSchema,
  idSchema,
  moneySchema,
  pageSchema,
  paginationQuerySchema,
  phoneSchema,
} from './common.js';
import { z } from 'zod';

describe('common schemas', () => {
  it('accepts cuid2 ids', () => {
    expect(idSchema.parse('a'.repeat(24))).toBe('a'.repeat(24));
  });

  it('rejects non-cuid2 ids', () => {
    expect(idSchema.safeParse('ABC')).toMatchObject({ success: false });
    expect(idSchema.safeParse('a'.repeat(40))).toMatchObject({ success: false });
  });

  it('requires ISO-4217 currency', () => {
    expect(currencySchema.parse('USD')).toBe('USD');
    expect(currencySchema.safeParse('us')).toMatchObject({ success: false });
  });

  it('money accepts integer amount + currency', () => {
    expect(moneySchema.parse({ amount: 12500, currency: 'USD' })).toEqual({
      amount: 12500,
      currency: 'USD',
    });
    expect(moneySchema.safeParse({ amount: 12.5, currency: 'USD' })).toMatchObject({
      success: false,
    });
  });

  it('phone accepts E.164', () => {
    expect(phoneSchema.parse('+14155552671')).toBe('+14155552671');
    expect(phoneSchema.safeParse('555-1212')).toMatchObject({ success: false });
  });

  it('email lowercases and trims', () => {
    expect(emailSchema.parse('  FOO@Bar.com ')).toBe('foo@bar.com');
  });

  it('address requires alpha-2 country', () => {
    const ok = addressSchema.parse({
      line1: '1 Main St',
      city: 'Hanoi',
      country: 'vn',
    });
    expect(ok.country).toBe('VN');

    expect(
      addressSchema.safeParse({ line1: '1 Main St', city: 'Hanoi', country: 'Viet' }).success,
    ).toBe(false);
  });

  it('paginationQuery has defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, sort: 'desc' });
  });

  it('pageSchema builds a typed envelope', () => {
    const schema = pageSchema(z.string());
    expect(schema.parse({ items: ['a'], nextCursor: null })).toEqual({
      items: ['a'],
      nextCursor: null,
    });
  });
});
