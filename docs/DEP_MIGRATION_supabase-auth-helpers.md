# Dependency migration: drop `@supabase/auth-helpers-nextjs` → `@supabase/ssr`

**Status:** TODO (deferred from the 2026-06-12 launch-hardening pass)
**Priority:** High — `@supabase/auth-helpers-nextjs` is **deprecated** and is the most
likely culprit behind the GitHub Dependabot **critical** alert on this repo's default branch.
**Risk/size:** Low — it's used in **exactly one file**; the rest of the app already uses
`@supabase/ssr`. Estimated effort: ~30 min including build verification.

---

## Why

- `@supabase/auth-helpers-nextjs@^0.10.0` (`apps/web/package.json:37`) is deprecated and
  superseded by `@supabase/ssr` (`@supabase/ssr@^0.5.0` is **already a dependency** at
  `apps/web/package.json:38`). Keeping the deprecated package around carries the Dependabot
  vuln and a maintenance footgun.
- The app is already almost entirely on `@supabase/ssr`:
  - Browser client: `apps/web/app/lib/supabase.ts` → `createBrowserClient`
  - Server client: `apps/web/app/lib/supabase-server.ts` → `createServerClient`
    (exported as `createServerSupabase()` with full cookie get/set/remove handling)
- Only **one** straggler still imports the deprecated package.

## The only usage

`apps/web/app/api/subscriptions/check-on-login/route.ts`

```ts
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
// ...
const supabase = createRouteHandlerClient({ cookies });
const { data: { user } } = await supabase.auth.getUser();
// ...profiles select by user.id...
```

## Migration steps

### 1. Rewrite the one route to use the existing ssr server helper

In `apps/web/app/api/subscriptions/check-on-login/route.ts`:

- **Remove** these imports:
  ```ts
  import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
  import { cookies } from 'next/headers';
  ```
- **Add**:
  ```ts
  import { createServerSupabase } from '@/lib/supabase-server';
  ```
- **Replace** the client construction:
  ```ts
  // before
  const supabase = createRouteHandlerClient({ cookies });
  // after
  const supabase = await createServerSupabase();
  ```
- Everything else in the route (`supabase.auth.getUser()`, the `profiles` select, the
  response shape) is unchanged — `createServerSupabase()` returns a normal supabase-js
  client backed by the request cookies, so `auth.getUser()` works identically.

> Note: `createServerSupabase()` lives in `apps/web/app/lib/supabase-server.ts` and already
> handles the Server-Component `set`/`remove` try/catch. This is the same helper the rest of
> the server code uses, so behavior is consistent.

### 2. Drop the dependency

- Remove `"@supabase/auth-helpers-nextjs": "^0.10.0"` from `apps/web/package.json`.
- Reinstall to regenerate the lockfile (use the workspace's package manager — `bun install`
  preferred per repo conventions, `npm install` fallback).

### 3. Verify

- [ ] `grep -rn "auth-helpers-nextjs" apps/web/app apps/web/lib` returns **nothing**.
- [ ] `tsc --noEmit -p apps/web/tsconfig.json` is clean.
- [ ] `next build` (or `vercel build`) succeeds — this is the real gate; the local
      tsc pass in the hardening session could not run a full build here.
- [ ] Manually exercise `POST /api/subscriptions/check-on-login` while authenticated and
      confirm it still returns the correct `hasSubscription`/`tier`/`status` (cookie auth path).
- [ ] Re-run `npm audit` (or check the Dependabot alert) and confirm the critical advisory
      clears. If a different transitive package is implicated, capture the new advisory here.

### 4. Rollback

Single-file + one package.json line — `git revert` the migration commit and reinstall.

---

## Related: React is pinned to an RC (do at the same time)

`apps/web/package.json:57-58` pins:

```json
"react": "19.0.0-rc-02c0e824-20241028",
"react-dom": "19.0.0-rc-02c0e824-20241028",
```

Shipping a release-candidate React to production is a stability risk. Pin both to a **GA**
`react@19.x` / `react-dom@19.x` release compatible with `next@15.5.18`, reinstall, and
re-run `next build` + a smoke test. Track separately from the supabase change so a
regression is easy to bisect.
