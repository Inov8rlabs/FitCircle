/**
 * Does a typed food description say HOW MUCH was eaten? Drives the manual form's inline
 * "No amount given — we'll assume a typical serving" hint before "Estimate with AI".
 * Deliberately generous: any digit, number word, fraction or common measure counts, so the
 * hint only appears for bare names like "chicken biryani" or "latte". It never blocks.
 */
const AMOUNT_WORDS = [
  // articles / number words / fractions
  'a', 'an', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'dozen', 'half', 'quarter', 'third', 'couple', 'few', 'several', 'single', 'double',
  // measures and containers
  'cup', 'cups', 'bowl', 'bowls', 'plate', 'plates', 'slice', 'slices', 'piece', 'pieces', 'pc', 'pcs',
  'serving', 'servings', 'portion', 'portions', 'glass', 'glasses', 'mug', 'mugs', 'can', 'cans',
  'bottle', 'bottles', 'scoop', 'scoops', 'handful', 'handfuls', 'spoon', 'spoons', 'katori',
  'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'ml', 'l', 'liter', 'liters', 'litre', 'litres',
  // drink / portion sizes
  'small', 'medium', 'large', 'regular', 'tall', 'grande', 'venti', 'mini', 'jumbo',
];
const AMOUNT_RE = new RegExp(`\\b(?:${AMOUNT_WORDS.join('|')})\\b`, 'i');

export function describesAmount(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\d|[¼½¾⅓⅔⅛]/.test(t)) return true;
  return AMOUNT_RE.test(t);
}
