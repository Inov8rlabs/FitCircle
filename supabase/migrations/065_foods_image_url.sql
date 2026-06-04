-- Migration 065: add image_url to foods (PRD §6.1 / §8.3)
-- ADDITIVE. Open Food Facts products carry a front-of-pack image URL. Storing it lets:
--   • the food search/barcode UI show a product image, and
--   • the eval harness build a "packaged-food labels" golden set (image + known label macros)
--     directly from loaded OFF rows (§8.3, cheapest ground-truth source).
-- NULL for rows without an image (USDA Foundation/SR, custom foods).

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN foods.image_url IS 'Front-of-pack product image URL (Open Food Facts image_url); NULL when none.';
