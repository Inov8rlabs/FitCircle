import { describe, expect, it } from 'vitest';

import { cn } from '../utils';

describe('cn with the iOS type scale', () => {
  it('keeps text-transparent next to a type-scale size (gradient titles)', () => {
    expect(cn('bg-gradient-sunset bg-clip-text text-transparent', 'text-title1')).toContain('text-transparent');
  });

  it('keeps a colour next to a type-scale size', () => {
    const out = cn('text-white', 'text-subhead');
    expect(out).toContain('text-white');
    expect(out).toContain('text-subhead');
  });

  it('still dedupes two sizes', () => {
    expect(cn('text-title1', 'sm:text-large-title', 'text-title2')).toBe('sm:text-large-title text-title2');
  });
});
