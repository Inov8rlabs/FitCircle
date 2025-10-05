/**
 * Unit tests for unit conversion utilities
 */

import {
  kgToLbs,
  lbsToKg,
  convertWeight,
  formatWeight,
  parseWeightToKg,
  weightKgToDisplay,
  getWeightUnit,
  getWeightPlaceholder,
  isValidWeight,
} from '../units';

describe('Unit Conversion Utilities', () => {
  describe('kgToLbs', () => {
    it('converts kg to lbs correctly', () => {
      expect(kgToLbs(70)).toBe(154.3);
      expect(kgToLbs(100)).toBe(220.5);
      expect(kgToLbs(0)).toBe(0);
    });
  });

  describe('lbsToKg', () => {
    it('converts lbs to kg correctly', () => {
      expect(lbsToKg(154.3)).toBe(70);
      expect(lbsToKg(220.5)).toBe(100);
      expect(lbsToKg(0)).toBe(0);
    });
  });

  describe('convertWeight', () => {
    it('converts between units correctly', () => {
      expect(convertWeight(70, 'kg', 'lbs')).toBe(154.3);
      expect(convertWeight(154.3, 'lbs', 'kg')).toBe(70);
      expect(convertWeight(70, 'kg', 'kg')).toBe(70);
      expect(convertWeight(154.3, 'lbs', 'lbs')).toBe(154.3);
    });
  });

  describe('formatWeight', () => {
    it('formats weight with correct units', () => {
      expect(formatWeight(70, 'metric')).toBe('70 kg');
      expect(formatWeight(70, 'imperial')).toBe('154.3 lbs');
      expect(formatWeight(null, 'metric')).toBe('No data');
      expect(formatWeight(undefined, 'imperial')).toBe('No data');
    });
  });

  describe('parseWeightToKg', () => {
    it('parses weight input correctly', () => {
      expect(parseWeightToKg('70', 'metric')).toBe(70);
      expect(parseWeightToKg('154.3', 'imperial')).toBe(70);
      expect(parseWeightToKg('invalid', 'metric')).toBe(null);
      expect(parseWeightToKg('', 'imperial')).toBe(null);
    });
  });

  describe('weightKgToDisplay', () => {
    it('converts kg to display value based on unit system', () => {
      expect(weightKgToDisplay(70, 'metric')).toBe(70);
      expect(weightKgToDisplay(70, 'imperial')).toBe(154.3);
    });
  });

  describe('getWeightUnit', () => {
    it('returns correct unit label', () => {
      expect(getWeightUnit('metric')).toBe('kg');
      expect(getWeightUnit('imperial')).toBe('lbs');
    });
  });

  describe('getWeightPlaceholder', () => {
    it('returns correct placeholder', () => {
      expect(getWeightPlaceholder('metric')).toBe('70.5');
      expect(getWeightPlaceholder('imperial')).toBe('155.4');
    });
  });

  describe('isValidWeight', () => {
    it('validates weight values correctly', () => {
      expect(isValidWeight(70, 'metric')).toBe(true);
      expect(isValidWeight(154.3, 'imperial')).toBe(true);
      expect(isValidWeight(0, 'metric')).toBe(false);
      expect(isValidWeight(1001, 'metric')).toBe(false);
      expect(isValidWeight(2201, 'imperial')).toBe(false);
      expect(isValidWeight(-10, 'metric')).toBe(false);
    });
  });
});