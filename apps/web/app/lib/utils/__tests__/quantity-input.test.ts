import { describe, expect, it } from 'vitest';

import {
  formatQuantity,
  parseQuantity,
  quantityStepSize,
  snapServings,
  stepQuantity,
} from '../quantity-input';

describe('parseQuantity', () => {
  it('parses decimals', () => {
    expect(parseQuantity('0.5')).toBe(0.5);
    expect(parseQuantity('0.25')).toBe(0.25);
    expect(parseQuantity('.5')).toBe(0.5);
    expect(parseQuantity('1.75')).toBe(1.75);
    expect(parseQuantity('1,25')).toBe(1.25);
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('0')).toBe(0);
  });

  it('parses fractions', () => {
    expect(parseQuantity('1/4')).toBe(0.25);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('3/4')).toBe(0.75);
    expect(parseQuantity('1 / 4')).toBe(0.25);
    expect(parseQuantity('1 1/4')).toBe(1.25);
    expect(parseQuantity('1-1/4')).toBe(1.25);
  });

  it('parses vulgar fractions', () => {
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('¼')).toBe(0.25);
    expect(parseQuantity('¾')).toBe(0.75);
    expect(parseQuantity('1½')).toBe(1.5);
  });

  it('returns null for incomplete drafts', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('.')).toBeNull();
    expect(parseQuantity('0.')).toBeNull();
    expect(parseQuantity('1.')).toBeNull();
    expect(parseQuantity('1/')).toBeNull();
    expect(parseQuantity(',')).toBeNull();
    expect(parseQuantity('0,')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('1/0')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('keeps quarters as two decimals, not one', () => {
    expect(formatQuantity(1)).toBe('1');
    expect(formatQuantity(0.5)).toBe('0.5');
    expect(formatQuantity(0.25)).toBe('0.25');
    expect(formatQuantity(1.75)).toBe('1.75');
    expect(formatQuantity(0)).toBe('0');
  });
});

describe('stepQuantity', () => {
  it('moves in quarter increments without float drift', () => {
    expect(stepQuantity(1, -0.25)).toBe(0.75);
    expect(stepQuantity(1, 0.25)).toBe(1.25);
    expect(stepQuantity(0.25, -0.25)).toBe(0);
    expect(stepQuantity(0, -0.25)).toBe(0);
    let v = 0;
    for (let i = 0; i < 8; i++) v = stepQuantity(v, 0.25);
    expect(v).toBe(2);
  });
});

describe('quantityStepSize', () => {
  it('uses 10 for mass/volume and 0.25 otherwise', () => {
    expect(quantityStepSize('g')).toBe(10);
    expect(quantityStepSize('ml')).toBe(10);
    expect(quantityStepSize('serving')).toBe(0.25);
    expect(quantityStepSize('piece')).toBe(0.25);
    expect(quantityStepSize('cup')).toBe(0.25);
    expect(quantityStepSize('oz')).toBe(0.25);
    expect(quantityStepSize(null)).toBe(10);
  });
});

describe('snapServings', () => {
  it('snaps to quarters and never below 1/4', () => {
    expect(snapServings(1)).toBe(1);
    expect(snapServings(0.5)).toBe(0.5);
    expect(snapServings(0.25)).toBe(0.25);
    expect(snapServings(0)).toBe(0.25);
    expect(snapServings(1.1)).toBe(1);
    expect(snapServings(1.2)).toBe(1.25);
  });
});
