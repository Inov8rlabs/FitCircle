/**
 * Landing FAQ. Every answer is a product fact; the source of truth is noted
 * next to each entry so it can be re-checked when the product changes.
 * Plain text only: the same strings feed the page and the FAQPage JSON-LD.
 */

export interface FaqItem {
  q: string;
  a: string;
  /** Optional link appended after the answer on the page (not in JSON-LD). */
  link?: { href: string; label: string };
}

export interface FaqGroup {
  title: string;
  items: FaqItem[];
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    title: 'Getting started',
    items: [
      {
        // lib/config/tier-limits.ts (free: 5 AI logs/day, 5 Fitzy messages/day, 2 created circles, 14-day history);
        // components/billing/PricingCards.tsx (prices); NEXT_PUBLIC_LIFETIME_OFFER gate (lifetime is launch-window only).
        q: 'Is FitCircle free?',
        a: 'Yes. The app is free on iPhone and Android, and the free plan is free for good. It includes 5 AI-analyzed meals a day, unlimited manual logging, daily streaks, up to 2 circles you create (join as many as you like), circle chat, challenges, and Fitzy’s daily focus with 5 messages a day. FitCircle Pro is optional: $9.99 a month or $29.99 a year, and a one-time lifetime option ($179.99) when it’s offered.',
      },
      {
        // Same Supabase account and API across iOS, Android and web.
        q: 'Which devices does it work on? Can I use more than one?',
        a: 'iPhone (App Store), Android (Google Play) and the web at fitcircle.ai. Sign in with the same account everywhere and your meals, streaks and circles stay in sync.',
      },
    ],
  },
  {
    title: 'Logging and accuracy',
    items: [
      {
        // NutritionIntelligenceService (photo → items, portions, macros); NutritionConfirm.tsx / iOS MealAnalysis (edit before saving).
        q: 'How accurate are the photo calorie estimates?',
        a: 'They are estimates. FitCircle identifies the foods and portions in your photo and works out calories, protein, carbs and fat, then shows you the breakdown before anything is saved. Mixed dishes, sauces and hidden oils are the hardest to judge from a picture, so a quick check of the portions makes the biggest difference.',
      },
      {
        // iOS FoodLogEntryDetailFeature / MealAnalysisFeature (re-analyze); web PhotoLog.tsx; manual entry is not quota-limited.
        q: 'What if it gets a food wrong?',
        a: 'Change the item, the portion or the numbers before you save, or edit the entry later. You can re-analyze a photo, add a note to steer it, or skip the AI and type the meal in yourself.',
      },
      {
        // Offline-first food log: iOS outbox + Android Room outbox (Android 1.0.5); docs/FOOD_LOG_SYNC_CONTRACT.md.
        q: 'Does it work offline?',
        a: 'In the iPhone and Android apps, meals you log without a connection are saved on your phone and sync automatically when you’re back online. Photo analysis and the web app need a connection.',
      },
      {
        // DietaryPreferencesService + FitzyService grounding (diet and allergens block).
        q: 'Can it take my diet or allergies into account?',
        a: 'Yes. Set your dietary preferences and allergies in the app, and Fitzy uses them when it suggests meals. Always check labels yourself: FitCircle is a wellness app, not medical advice.',
      },
    ],
  },
  {
    title: 'Health data and privacy',
    items: [
      {
        // Privacy policy §2.3; HealthKit (iOS) / Health Connect (Android) sync of steps, workouts and weight.
        q: 'Does it work with Apple Health and Health Connect?',
        a: 'Yes, if you choose to connect. FitCircle can read your steps, workouts and weight from Apple Health on iPhone or Health Connect on Android. If steps aren’t showing, check that FitCircle has permission in the Health app or in Health Connect settings.',
      },
      {
        // Privacy policy §2.3: never used for advertising or marketing, never sold, never shared with data brokers.
        q: 'What happens to my health data?',
        a: 'Health data is used only for FitCircle’s health and fitness features. It is never used for advertising or marketing, never sold, and never shared with data brokers.',
        link: { href: '/privacy', label: 'Read the privacy policy' },
      },
      {
        // Privacy policy (Profile → Settings → Delete Account); web /settings/data delete flow; /privacy/delete-account.
        q: 'How do I delete my account?',
        a: 'In the app, go to Profile → Settings → Delete Account. On the web, go to Settings → Data. Deleting your account permanently removes it and the data associated with it.',
        link: { href: '/privacy/delete-account', label: 'How account deletion works' },
      },
    ],
  },
  {
    title: 'Pro and billing',
    items: [
      {
        // Terms §11.2 (auto-renew, cancellation at period end, no partial refunds) and §11.3 (refunds per law / store policy).
        q: 'How do I cancel? Can I get a refund?',
        a: 'Subscriptions renew automatically. Cancel any time to stop the next renewal and you keep Pro until the end of the period you’ve paid for; there are no refunds for partial periods. Bought in the app? Cancel in your App Store or Google Play subscriptions, and refunds follow Apple’s or Google’s policies. Bought on the web? Cancel in Settings → Billing; refunds are given only where the law requires it.',
        link: { href: '/terms', label: 'See the Terms (section 11)' },
      },
      {
        // Entitlement stored on the account (RevenueCat → backend webhook → profiles); Restore Purchases on iOS and Android paywalls.
        q: 'I bought Pro. Does it work everywhere?',
        a: 'Yes. Pro belongs to your FitCircle account, so it unlocks on iPhone, Android and the web when you sign in with the same account. If the app still shows the Pro screen after you’ve paid, tap Restore Purchases on that screen.',
      },
    ],
  },
];

export const FAQ_ITEMS: FaqItem[] = FAQ_GROUPS.flatMap((g) => g.items);

/** schema.org FAQPage for the landing page (rich results). */
export function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
