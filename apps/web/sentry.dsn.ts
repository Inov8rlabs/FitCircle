// Sentry DSN for the web project (server + edge + browser).
//
// A Sentry DSN is NOT a secret: it only permits SENDING events (it's publishable,
// the same category as the Supabase anon key this project already commits). An env
// var takes precedence so the DSN can be rotated without a code change — set
// SENTRY_DSN (server) and/or NEXT_PUBLIC_SENTRY_DSN (browser) in Vercel to override.
export const WEB_SENTRY_DSN =
  process.env.SENTRY_DSN ||
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  'https://9e943094c85c124c49ad098e1912a6e9@o4511431325777920.ingest.us.sentry.io/4511632902389760';
