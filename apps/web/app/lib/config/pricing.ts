/**
 * FitCircle Pro list prices in USD (App Store Connect / Play / Stripe price objects).
 * Display only: Stripe charges the price object (STRIPE_PRICE_*), the stores charge their own
 * localized price. Change these together with the store / Stripe prices.
 */
export const PRO_PRICES_USD = {
  monthly: 9.99,
  annual: 29.99,
  lifetime: 179.99,
} as const;

/** "$9.99". */
export const usd = (amount: number): string => `$${amount.toFixed(2)}`;
