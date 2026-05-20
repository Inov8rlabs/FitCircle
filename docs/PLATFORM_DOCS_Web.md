# Web Platform Docs

Last updated: 2026-05-19. Companion: [`PLATFORM_DOCS_README.md`](./PLATFORM_DOCS_README.md).

The web app at `FitCircleBE/apps/web/` is both the **web frontend** and
the **backend API** for all three platforms. Mobile apps hit
`/api/mobile/...` routes; the web frontend hits a mix of `/api/...`
(cookie-auth) and `/api/mobile/...` (Bearer-auth from the Zustand store).

iOS is still the UX source of truth; this doc covers how those UX
decisions land on web.

---

## 1. Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| UI runtime | React 19 |
| Language | TypeScript 5.6+ |
| Package manager | npm (NOT bun — `CLAUDE.md` says so) |
| Styling | Tailwind CSS + CSS variables, dark-only |
| UI primitives | Radix UI + shadcn-style wrappers in `components/ui/` |
| State | Zustand with `persist` middleware to `localStorage` |
| Validation | Zod (server-side input validation in API routes) |
| Animations | Framer Motion (`framer-motion`), Tailwind keyframes for simple effects |
| Charts | Recharts |
| Auth | Supabase Auth (cookies for SSR, JWT for client-side mobile-API calls) |
| Database | Supabase (PostgreSQL) — direct SDK queries, no ORM |
| Email | Resend |
| Deploy | Vercel |
| Tests | Vitest + React Testing Library; Playwright for e2e |

---

## 2. Project layout

```
FitCircleBE/
├── apps/
│   └── web/
│       ├── app/                        # Next.js App Router root
│       │   ├── (app)/                  # Protected app routes (cookie-auth required)
│       │   │   └── food-log/...
│       │   ├── (auth)/                 # Sign-in / sign-up
│       │   │   └── login/, register/
│       │   ├── api/                    # All backend routes
│       │   │   ├── mobile/             # Bearer-auth (iOS/Android/web clients)
│       │   │   ├── cron/               # CRON_SECRET-protected scheduled jobs
│       │   │   ├── checkins/, profile/, fitcircles/, challenges/, etc.
│       │   ├── beverage-log/           # ← new feature pages live at the root
│       │   ├── challenges/             # Standalone Challenges library
│       │   ├── daily-challenge/
│       │   ├── dashboard/              # Main hub
│       │   ├── exercise-log/
│       │   ├── fitcircles/
│       │   ├── momentum/
│       │   ├── onboarding/             # /onboarding (4-step) + /onboarding/assessment (5Q sub-flow)
│       │   ├── profile/
│       │   ├── settings/               # Hub + display/health/notifications/privacy/data
│       │   ├── streaks/
│       │   ├── components/             # All React components
│       │   │   ├── ui/                 # shadcn primitives (Button, Card, Dialog, ...)
│       │   │   ├── layout/             # Navbar, Sidebar
│       │   │   ├── challenges/, check-ins/, food-log/, pwa/, legal/, icons/
│       │   │   └── *.tsx               # feature-shared components
│       │   ├── lib/
│       │   │   ├── api/                # Client-side wrappers around mobile API routes
│       │   │   ├── services/           # Server-side business logic (static classes)
│       │   │   ├── types/              # Shared TS types
│       │   │   ├── utils/              # Helpers
│       │   │   ├── middleware/         # mobile-auth.ts etc.
│       │   │   ├── supabase.ts, supabase-server.ts, supabase-admin.ts
│       │   │   └── ...
│       │   ├── stores/                 # Zustand stores
│       │   ├── hooks/                  # Custom React hooks
│       │   ├── layout.tsx, providers.tsx, page.tsx, globals.css
│       │   └── middleware.ts           # auth + redirect rules
│       ├── public/sw.js                # Service worker (PWA)
│       ├── playwright.config.ts
│       ├── vitest.config.ts
│       ├── tailwind.config.ts
│       └── package.json
├── packages/                            # (internal shared packages, if any)
└── supabase/                            # SQL migrations
    └── migrations/
```

Top-level CLAUDE.md (`FitCircleBE/CLAUDE.md`) enforces critical rules:

- **Never commit without explicit permission.**
- **No PostgreSQL stored procedures** — all business logic in TS service classes.
- **Use npm, not bun.**

---

## 3. Feature catalogue (pages)

### Public / pre-auth

- `app/page.tsx` — marketing landing
- `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`
- `app/privacy/page.tsx`, `app/terms/page.tsx`
- `app/join/[code]/page.tsx` — circle join via invite code

### Onboarding

- `app/onboarding/page.tsx` — original 4-step initial flow (personal, goals, etc.)
- `app/onboarding/assessment/page.tsx` — **port of iOS `OnboardingAssessmentView`**. 3 phases (questions → recommendations → completion). 5 questions, single + multi-select with auto-advance on single. Recommendations from `/api/mobile/onboarding/recommendations`. Completion celebration → `/dashboard`.

### Main app

- `app/dashboard/page.tsx` — main hub (1014 LOC). Composes `EngagementStreakCard`, `DailyProgressMeter`, `QuickEntryCard`, `StepsGoalCard`, `WeightEntryCard` etc. Charts via Recharts.
- `app/streaks/page.tsx` — **new** Daily Streak hub mirroring iOS `StreakClaimContainerView`. Hero claim button + retro 7-day strip + shields + milestones + history. Optimistic UI + confetti + milestone celebration modal + shield dialog.
- `app/daily-challenge/page.tsx` — **new**. Today's challenge info + progress + manual entry + quick-add (1000/2500/5000/All for steps, etc.) + Almost There hint + leaderboard.
- `app/momentum/page.tsx` — **new**. Animated flame card (via `<MomentumFlame>` component), grace day, next milestone, milestone grid, full-screen celebration.
- `app/exercise-log/page.tsx` — **new**. Recent workouts list + weekly stats.
- `app/exercise-log/new/page.tsx` — **new**. Entry form: category, type, duration, calories, RPE, location, notes.
- `app/beverage-log/page.tsx` — **new**. 6 quick-add categories (water/coffee/tea/smoothie/protein/juice etc.) + dialog for custom + daily total.
- `app/challenges/page.tsx` — **new** (was redirect). Browse challenge templates, filter by category, search, link to `/fitcircles` with `?template=...` param.
- `app/fitcircles/page.tsx` — list circles
- `app/fitcircles/[id]/page.tsx` — circle detail (1878 LOC, includes `CircleChallengesSection` and the **new** `CircleQuestsSection`)
- `app/fitcircles/[id]/checkin/page.tsx` — submit a check-in to a circle
- `app/(app)/food-log/page.tsx`, `app/(app)/food-log/new/page.tsx` — food + beverage feed (server component)
- `app/profile/page.tsx` — user profile

### Settings

- `app/settings/page.tsx` — **new** hub with sub-page cards
- `app/settings/display/page.tsx` — **new**. Unit system toggle (metric/imperial), theme + language placeholders.
- `app/settings/health/page.tsx` — **new**. Connected sources (iOS / Android / manual), auto-claim toggle.
- `app/settings/notifications/page.tsx` — email/push/in-app toggles + category filters
- `app/settings/privacy/page.tsx` — visibility settings
- `app/settings/data/page.tsx` — **new**. JSON export + account deletion with typed confirmation.

---

## 4. Component catalogue

### Cross-feature components (`app/components/`)

| File | Use |
|------|-----|
| `Celebration.tsx` | Full-screen confetti via `canvas-confetti` (default export, takes `onComplete`, `userName`) |
| `EngagementStreakCard.tsx` | Streak summary widget for dashboard |
| `DailyProgressMeter.tsx` | Activity-ring-style daily summary |
| `GoalProgressIndicator.tsx` | Single goal progress visual |
| `QuickEntryCard.tsx` | Inline check-in widget |
| `WeightEntryCard.tsx`, `StepsGoalCard.tsx` | Specialised check-in cards |
| `BackfillDataDialog.tsx` | Backfill past days dialog |
| `AutoSyncSubmissionCard.tsx` | Pending Health-Connect submission card |
| `StreakHistoryModal.tsx` | History modal |
| `CircleCreationWizard.tsx` | Create-circle wizard |
| `FitCircleCreator.tsx`, `EmptyCirclesState.tsx`, `InviteFriendsModal.tsx`, `JoinCircleModal.tsx`, `QuickJoinCircle.tsx`, `ShareFitCircleDialog.tsx` | Circle UX |
| `DashboardNav.tsx`, `layout/Navbar.tsx` | Shell navigation |
| `MomentumFlame.tsx` (**new**) | Animated flame visual (level 1–5, Framer-Motion pulse + clip-path teardrop layers) |
| `CircleQuestsSection.tsx` (**new**) | Quests + Boost block; drop into circle detail page |
| `ShareCardButton.tsx` (**new**) | Generate + preview + share an achievement card. 3 styles (`primary` / `secondary` / `icon`). Uses `/api/mobile/share/cards` and Web Share API. |
| `pwa/offline-indicator.tsx`, `pwa/pwa-install.tsx` | PWA install / offline prompts |
| `food-log/*` | Food-log list + image components |
| `check-ins/*` | Check-in detail modal + sheet |
| `challenges/CircleChallengesSection.tsx` | Pre-existing — shows challenges within a circle |
| `legal/*`, `CookieConsentBanner.tsx` | GDPR / CCPA UI |
| `icons/BathroomScale.tsx` | Custom SVG icon |

### shadcn primitives (`app/components/ui/`)

`Button`, `Card`, `Dialog`, `AlertDialog`, `Input`, `Label`, `Badge`,
`Avatar`, `Tabs`, `Select`, `Switch`, `Progress`, `CircularProgress`,
`ActivityRing`, `CircularSlider`, `Textarea`, `DatePicker`, `Toast`
(via `sonner`), `Sheet`, `ScrollArea`, `unit-toggle`.

All follow the CVA + `cn()` pattern. Style with Tailwind classes + theme tokens.

---

## 5. Service layer (`app/lib/services/`)

Each `<feature>-service.ts` exports a static class. All business logic lives here.

- `account-deletion-service.ts`
- `assessment-service.ts` — onboarding assessment (`submitAssessment`, `recommendCircles`, `completeOnboarding`)
- `beverage-log-service.ts`
- `boost-service.ts` — circle boost calculation
- `challenge-service.ts`, `circle-challenge-service.ts` — challenge CRUD inside circles
- `check-in-service.ts`, `daily-checkin-service.ts`
- `circle-quest-service.ts` — collaborative/competitive/individual quests
- `circle-service.ts` — circle CRUD + membership
- `custom-challenge-service.ts`
- `daily-challenge-service.ts`
- `daily-goals.ts`, `goal-service.ts`, `goal-recommendations.ts`
- `data-submission-service.ts`
- `engagement-streak-service.ts` — engagement streak core
- `exercise-service.ts`
- `feature-flag-service.ts`
- `food-log-service.ts`, `food-log-image-service.ts`
- `leaderboard-service.ts`, `leaderboard-service-v2.ts`
- `metric-streak-service.ts`
- `mobile-api-service.ts` — shared helpers for `/api/mobile/...` routes
- `momentum-service.ts`
- `notification-orchestrator.ts`, `notification-preferences-service.ts`, `notification-service.ts`, `push-service.ts`
- `onboarding-service.ts`, `persona-service.ts`, `preference-service.ts`
- `share-card-service.ts` — share card generation + OG image URL
- `streak-claiming-service.ts` — claim/freeze/recovery
- `streak-service-v2.ts`
- `template-service.ts` — challenge template browsing
- `user-service.ts`
- `workout-logging-service.ts`

Convention:

```ts
import { createAdminSupabase } from '../supabase-admin';

export class FeatureService {
  static async doThing(userId: string, input: Input): Promise<Result> {
    const supabaseAdmin = createAdminSupabase();
    // Validate
    if (!input.name) throw new Error('Name required');
    // Query
    const { data, error } = await supabaseAdmin
      .from('table')
      .insert({...})
      .select()
      .single();
    if (error) throw error;
    // Enrich + return
    return this.enrich(data);
  }

  private static async enrich(row: Row) { /* ... */ }
}
```

Services never depend on each other directly — they call Supabase directly. If you need to compose, do it in the API route.

---

## 6. API route patterns

### Mobile route (Bearer auth)

```ts
// app/api/mobile/<feature>/<action>/route.ts
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FeatureService } from '@/lib/services/feature-service';

const schema = z.object({ /* ... */ });

export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const input = schema.parse(body);

    const result = await FeatureService.doThing(user.id, input);

    return NextResponse.json({
      success: true,
      data: result,
      error: null,
      meta: { request_time: new Date().toISOString() },
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ success: false, data: null, error: { code: 'UNAUTHORIZED', ... } }, { status: 401 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', details: e.errors }}, { status: 400 });
    }
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: e.message } }, { status: 500 });
  }
}
```

### Web cookie-auth route

```ts
// app/api/<feature>/route.ts
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('table').select().eq('user_id', user.id);
  return NextResponse.json(data);
}
```

---

## 7. State management — Zustand stores (`app/stores/`)

| Store | Purpose |
|-------|---------|
| `auth-store.ts` | User, JWT token, login/logout/refresh. **Persisted to localStorage.** |
| Others as needed | Created per feature when state needs to be shared across components |

Pattern:

```ts
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          // ... call supabase.auth.signInWithPassword(...)
          set({ user, token: data.session?.access_token, isAuthenticated: true, isLoading: false });
        } catch (e: any) {
          set({ error: e.message, isLoading: false });
        }
      },
      logout: () => { /* signOut + reset */ },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated }),
    }
  )
);
```

### Reading state in a component

```tsx
'use client';
import { useAuthStore } from '@/stores/auth-store';

export function MyComponent() {
  const { user, isAuthenticated } = useAuthStore();
  // ...
}
```

### Reading state outside React (in client helpers)

```ts
const token = useAuthStore.getState().token;
```

---

## 8. Calling mobile API routes from the web

The new parity-era pages call `/api/mobile/*` directly with the Bearer
token from `auth-store`. There's a small `authedFetch` helper inlined per
client file, or a shared client module per domain in `app/lib/api/`.

### Client modules (`app/lib/api/`)

| File | Surface |
|------|---------|
| `streak-client.ts` | `getEngagement`, `getClaimableDays(tz)`, `getShields`, `claimStreak`, `activateFreeze`, `getHistory` |
| `daily-challenge-client.ts` | `getCurrent`, `join(id)`, `updateProgress(id, n)`, `getLeaderboard(id)` |
| `momentum-client.ts` | `getStatus`, `getMilestones`, `checkIn` |
| `exercise-client.ts` | `list`, `create`, `delete`, `getStats`, `getRecentTypes` |
| `quest-boost-client.ts` | `questClient.listForCircle/getQuest/updateProgress`, `boostClient.getStatus/getHistory` |
| `onboarding-client.ts` | `submitAssessment`, `getRecommendations`, `complete`, `joinRecommendedCircle` |

Helper template:

```ts
// app/lib/api/<feature>-client.ts
import { useAuthStore } from '@/stores/auth-store';

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return json as T;
}

export const featureClient = {
  list: () => authedFetch<{ items: T[] }>('/api/mobile/feature'),
  create: (input: Input) => authedFetch<T>('/api/mobile/feature', { method: 'POST', body: JSON.stringify(input) }),
};
```

---

## 9. Design tokens

`tailwind.config.ts` + CSS variables in `app/globals.css`. Project is
forced dark mode.

### Tailwind utility usage

```tsx
<div className="bg-background text-foreground" />
<div className="bg-card border border-border rounded-lg p-4" />
<button className="bg-primary text-primary-foreground hover:bg-primary/90" />
<p className="text-muted-foreground" />
<span className="text-destructive" />
```

### Brand colour utilities

These are imported from the global CSS variables and bound via Tailwind:

```tsx
<div className="text-indigo-400" />     // indigo-400 / 500 / 600 for steps, info
<div className="text-purple-400" />     // for weight, achievements
<div className="text-orange-500" />     // for streaks, energy
<div className="text-emerald-500" />    // for success
<div className="text-cyan-400" />       // for sync, accents
<div className="text-pink-400" />
<div className="text-yellow-400" />     // for grace days, milestones
```

### Gradients

```tsx
className="bg-gradient-to-r from-purple-500 to-indigo-500"
className="bg-gradient-to-br from-orange-500 to-orange-400"
className="bg-gradient-to-br from-emerald-500 to-cyan-500"
```

### Typography

Use Tailwind's text sizing — no separate "Typography" tokens.
```tsx
<h1 className="text-2xl font-bold">
<p className="text-sm text-muted-foreground">
<span className="text-xs uppercase tracking-wide">
```

### Animations

```tsx
<div className="animate-pulse" />          // skeleton
<div className="animate-bounce-in" />      // custom keyframe
<div className="animate-slide-up" />
<div className="animate-fade-in" />
```

Or use Framer Motion for anything with physics:

```tsx
import { motion } from 'framer-motion';

<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: 'spring', damping: 12 }}
/>
```

---

## 10. Auth & middleware

`app/middleware.ts` runs on every request:

1. Refreshes Supabase session if expired (`getUser()` triggers cookie rewrite).
2. Redirects unauthenticated requests on protected paths to `/login`.
3. For protected `/api/*` routes (non-mobile), returns 401 if no session.
4. Adds `x-user-id` header for downstream routes.

Protected paths (configured at the bottom of `middleware.ts`):

```
/dashboard, /checkin, /progress, /challenges, /teams,
/profile, /settings, /food-log, /streaks, /daily-challenge,
/momentum, /exercise-log, /beverage-log, /fitcircles, /onboarding
```

---

## 11. Notifications + PWA

- `public/sw.js` — service worker for offline + push notifications
- `app/components/pwa/pwa-install.tsx` — install prompt for iOS Safari + Android Chrome
- `app/components/pwa/offline-indicator.tsx` — top-of-screen offline banner
- `app/settings/notifications/page.tsx` — toggles for email / push / in-app + categories

To wire web push subscription (currently a placeholder):

1. In `/settings/notifications`, add a "Enable browser notifications" button.
2. Call `Notification.requestPermission()`.
3. On grant, register a push subscription against the service worker:
   ```ts
   const reg = await navigator.serviceWorker.ready;
   const sub = await reg.pushManager.subscribe({
     userVisibleOnly: true,
     applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
   });
   await fetch('/api/notifications/subscribe', {
     method: 'POST',
     body: JSON.stringify(sub),
   });
   ```
4. The backend's `push-service.ts` handles sending via Web Push (VAPID keys needed in env).

---

## 12. Build & deploy

```bash
cd FitCircleBE/apps/web

npm install
npm run dev               # http://localhost:3000

npm run type-check        # tsc --noEmit
npm run lint              # eslint
npm run build             # production build
npm run start             # serve built output

# Tests
npm test                  # vitest run
npm test:watch
npm test:coverage
npm test:e2e              # playwright
```

Deploys to Vercel on push to main (default config).

---

## 13. Testing

`vitest.config.ts` runs unit + component tests. `playwright.config.ts`
runs e2e in a real browser.

Patterns from the CLAUDE.md:

- Use `data-testid` only for layout/CSS testing
- Prefer semantic queries (`getByRole`, `getByText`, `getByLabelText`)
- Always `waitFor(...)` async expectations
- For Radix portal content (Dialogs), use `baseElement.querySelector(...)`

```ts
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const user = userEvent.setup();
render(<MyForm />);
await user.type(screen.getByLabelText('Email'), 'test@example.com');
await user.click(screen.getByRole('button', { name: /Submit/ }));
await waitFor(() => expect(screen.getByText('Success')).toBeInTheDocument());
```

---

## 14. How to add a new feature (recipe)

1. **Define types.** In `app/lib/types/feature.ts`. Match the
   backend / mobile shape.

2. **Service layer.** `app/lib/services/feature-service.ts` — static
   class with the business logic.

3. **API routes.**
   - Mobile-callable: `app/api/mobile/feature/.../route.ts` with `requireMobileAuth`.
   - Web-cookie-callable (optional): `app/api/feature/.../route.ts` with `createServerSupabase`.
   - Both should call the service.

4. **Zustand store** (if state is shared across pages).
   `app/stores/feature-store.ts` with `persist` middleware if appropriate.

5. **Client wrapper** (if calling mobile API from the web).
   `app/lib/api/feature-client.ts` — the `authedFetch` pattern.

6. **Page.** `app/feature/page.tsx` — `'use client'` directive,
   import hooks/services, use Framer Motion for animations.

7. **Components.** Reusable bits in `app/components/`. Use shadcn
   primitives + Tailwind tokens.

8. **Test.** Add a `__tests__/feature.test.tsx` alongside the component.

9. **Type-check + build.**
   ```bash
   npm run type-check && npm run build
   ```

10. **Mirror to iOS / Android.** See those platform docs.

---

## 15. Common gotchas

- **Bearer token is `useAuthStore.getState().token`** — don't reach into
  `localStorage` directly; respect the store.
- **Mobile API routes use snake_case keys** in request/response bodies.
  TS interfaces should match.
- **`'use client'` is required** for any component using hooks, Framer,
  or `auth-store`. Server components can't read the Zustand store.
- **No light mode yet** — never use `dark:` Tailwind variants.
- **Don't auto-commit.** See `CLAUDE.md` top rule.
- **shadcn primitives are in `components/ui/`** — if you can't find one,
  import it from there before pulling in a third-party.
