import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { authEmailSchema, normalizeAuthEmail } from '../auth-email';

const schema = z.object({ email: authEmailSchema() });

describe('authEmailSchema (sign up / log in / reset routes)', () => {
  it.each([
    ['abajirao.apps@gmail com', 'abajirao.apps@gmail.com'],
    ['x@gmail com', 'x@gmail.com'],
    ['x @gmail.com', 'x@gmail.com'],
    ['x@gmail .com', 'x@gmail.com'],
    ['X@Gmail.Com', 'x@gmail.com'],
    ['x@gmail.com ', 'x@gmail.com'],
    ['x@gmail.com\n', 'x@gmail.com'],
    // Well-formed but "typo-looking": log in must still reach Supabase.
    ['Sam@Gmail.co', 'sam@gmail.co'],
    ['sam@gmial.com', 'sam@gmial.com'],
  ])('accepts %j as %j', (input, expected) => {
    expect(schema.parse({ email: input }).email).toBe(expected);
  });

  it.each(['', '   ', 'john smith@gmail.com', 'ani@example', 'not-an-email', 'x@@gmail.com'])('rejects %j', (input) => {
    expect(schema.safeParse({ email: input }).success).toBe(false);
  });

  it('passes non-strings through for zod to reject', () => {
    expect(normalizeAuthEmail(42)).toBe(42);
    expect(schema.safeParse({ email: null }).success).toBe(false);
  });
});
