/**
 * Deterministic answers for when the model gives us nothing (both attempts stalled, errored or
 * came back empty). Onboarding (`context: "onboarding"`, the "Ask Fitzy" step) gets a short,
 * helpful answer per suggestion chip (the chips in OnboardingV2Copy.swift / V2Steps.kt), so the
 * step never dead-ends; ordinary chat gets an honest "try again". Plain text, no emoji, no
 * questions, and the same rules as ONBOARDING_PROMPT_ADDENDUM (no targets, stats or medical claims).
 */

export const FITZY_UNAVAILABLE = "Sorry, I couldn't put an answer together just now. Please try asking again in a moment.";

const ANSWERS: Array<{ match: RegExp; answer: string }> = [
  {
    match: /protein/i,
    answer: [
      'A protein-rich breakfast keeps mornings easy and filling.',
      '- Greek yogurt with berries and a sprinkle of seeds',
      '- Eggs on wholegrain toast, or a veggie omelette',
      '- Overnight oats made with milk or soy milk',
      'Pick one to try tomorrow.',
    ].join('\n'),
  },
  {
    match: /\bsteps?\b/i,
    answer: [
      'Steps add up fastest when they fit into your day.',
      '- Take a 10-minute walk after a meal',
      '- Walk during phone calls',
      '- Get off one stop early or park a little farther away',
      'Start with one of these today.',
    ].join('\n'),
  },
  {
    match: /calorie|target|realistic/i,
    answer: [
      "Your FitCircle target is an estimate from the details you entered, and a starting point you can adjust anytime.",
      '- Log your meals for a week to see how it feels',
      '- If you feel very hungry or low on energy, adjust it in your plan',
      'Steady habits matter more than hitting a number exactly.',
    ].join('\n'),
  },
  {
    match: /\bveg|vegetable/i,
    answer: [
      'Small additions make the biggest difference.',
      '- Add a handful of spinach to eggs, pasta or soup',
      '- Keep frozen vegetables ready for quick stir-fries',
      '- Start dinner with a simple side salad',
      'Pick one to try this week.',
    ].join('\n'),
  },
  {
    match: /snack/i,
    answer: [
      'The best snack is one you enjoy that keeps you going.',
      '- Fruit with yogurt',
      '- Hummus with carrot or cucumber sticks',
      '- A boiled egg with a few crackers',
      'Keep one ready for busy afternoons.',
    ].join('\n'),
  },
  {
    match: /habit/i,
    answer: [
      "Start with something so small it's hard to skip.",
      '- Log one meal a day',
      '- Take a 10-minute walk after lunch',
      '- Drink a glass of water with breakfast',
      'Pick one and keep it going this week.',
    ].join('\n'),
  },
  {
    match: /friend|accountab|on track/i,
    answer: [
      'Friends make it easier to keep showing up.',
      '- Start a circle and invite one or two friends',
      '- Check in daily so everyone sees the progress',
      "- Cheer each other's wins in the circle chat",
      'Invite one friend today.',
    ].join('\n'),
  },
];

const GENERIC_ONBOARDING = [
  "Here's a simple place to start.",
  '- Log your meals for a few days to see your patterns',
  '- Add a short walk to your day',
  '- Keep a glass of water close by',
  "Ask me anything once you've settled in.",
].join('\n');

/** The canned onboarding answer for a chip (English chip text), or a generic starter answer. */
export function onboardingFallbackAnswer(message: string): string {
  return ANSWERS.find((a) => a.match.test(message ?? ''))?.answer ?? GENERIC_ONBOARDING;
}
