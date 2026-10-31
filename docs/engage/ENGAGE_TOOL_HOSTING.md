# Where the Engage tool lives: standalone `engage.inov8rlabs.com` or Admin Tools?

**Status:** Recommendation for the owner's decision · 2026-10-30

## TL;DR

> **Update, the same day.** Engage must serve **FitCircle, BuyForBaby and TripWiz** (see `ENGAGE_MULTITENANCY.md`). That makes Admin Tools an even better host, not a worse one: it is already a **multi-app registry**, with `apps/[appId]/[module]` routes, a base URL and secret per app, and a whitelisted proxy per module. The Engage domain gets an **app switcher**, and roles become per app and per module. All three apps belong to Inov8r Labs and its Google Workspace domains, so the "outside Inov8r" graduation trigger below is not hit.

Build Engage **in the `inov8r-admin` codebase**, but give it **its own front door, `engage.inov8rlabs.com`**:
- its own navigation and home page;
- its own roles;
- a link to and from Admin Tools.

There is one deployment, one login and one set of shared parts (proxy, UI kit, device previews, the experiments audience editor, the campaigns module).

Split it into a separate repo and deployment only if one of the "graduation triggers" below occurs. Until then, the split costs more than it buys.

## What actually has to be hosted

Most of Engage is **not** in the tool. Segments, eligibility, the send pipeline, crons, delivery APIs, stats rollups, consent and the audit log all live in **FitCircleBE**, next to the data and the push and email credentials. That is true whichever option we pick.

The tool is a **UI plus a thin, whitelisted proxy** to `FitCircleBE /api/admin/engage/*`. Admin Tools already does exactly this for the Ads, Campaigns, Releases and Experiments modules:
- `lib/apps/proxy.ts` forwards requests;
- the rules in `lib/apps/modules.ts` are pinned by tests;
- requests carry `Bearer FITCIRCLE_ADMIN_API_SECRET` plus `X-Admin-Actor`.

So the question is narrower than it looks: **where does a React app that calls a known backend live, and what URL does it have?**

## Options

### A. Module inside Admin Tools (`admintools.inov8rlabs.com/apps/fitcircle/engage`)

**Pros:**
- Zero new infrastructure: auth (Google allowlist, `hd` check, 12 h sessions), proxy, audit header, Vercel project and env vars all exist.
- Shares code directly with what Engage needs most:
  - the **native iOS and Android preview renderers** (`components/modules/campaigns/preview/native/*`, `DeviceMocks.tsx`);
  - the experiments `AudienceEditor`, `AllocationEditor` and `OverridesPanel`;
  - the UI kit (`components/ui/kit.tsx`);
  - toasts and icons.
- Experiences (campaigns), Experiments and the Ads Console sit one click away. Engage campaigns link to Experiences and to Ads cohorts.
- One place for the team to log in, and one set of access to manage. Anki was just set up here.

**Cons:**
- Engage is the largest module (composer, journeys, segments, assets, feed rules, analytics). It would dominate the Admin Tools navigation and bundle.
- A single deployment: an Engage change redeploys Ads and Releases, and the other way round. Vercel's instant rollback and preview deployments soften this.
- Access is all-or-nothing today, since `ADMIN_ALLOWED_EMAILS` is a flat list. A marketer who needs Engage would also get Ads and Releases.

### B. Separate repo and deployment (`engage.inov8rlabs.com`)

**Pros:**
- Independent deploy cadence and blast radius.
- A product-shaped tool with its own identity, which could serve other Inov8r apps later or be offered to other teams.
- Clean, focused navigation and its own access list.

**Cons:**
- Duplicates everything A gets for free:
  - an Auth.js setup, a new OAuth client and redirect URIs, plus the Google consent-screen and test-user handling we just fought with;
  - the allowlist, proxy, audit header and secrets;
  - the UI kit, device previews and audience editor. These would be copied, and then drift, or need extracting into a shared package. A shared package is real work: build pipeline, versioning, and two consumers to keep in step.
- Two places to grant access, two sets of env vars, two Sentry projects and two sets of dependency upgrades.
- Linking Engage campaigns to Experiences and Experiments means cross-app deep links instead of shared components. The campaign editor already lives in Admin Tools, and Engage is meant to absorb part of it (campaign push and email).
- The backend doesn't care which option we pick, so the separation buys **no** isolation of data or credentials. Both talk to the same `FitCircleBE` admin API with the same secret.

### C. Recommended hybrid: one codebase, its own domain and shell

- **Code:** a new module `engage` in `inov8r-admin` (`components/modules/engage/*`, `lib/apps/modules.ts` rules). It reuses the kit, previews and audience editor.
- **URL:** add `engage.inov8rlabs.com` as a second domain on the same Vercel project. Next.js middleware maps that host to the Engage shell:
  - the root goes to `/apps/fitcircle/engage`;
  - the navigation is Engage-only: Overview, Campaigns, Journeys, Segments, Assets, Feed, Analytics, Settings;
  - the header carries the Inov8r Labs mark and a "Admin Tools ↗" link.

  Admin Tools gets an **Engage ↗** tile. Both hosts serve the same build.
- **Auth:**
  - Either set the Auth.js session cookie domain to `.inov8rlabs.com`, so signing in to one signs you in to both,
  - or add `https://engage.inov8rlabs.com/api/auth/callback/google` as a second authorized redirect URI on the existing OAuth client.

  Both are small changes, and there's no new OAuth client or consent screen.
- **Access:** add **per-module roles** to Admin Tools: `ADMIN_MODULE_ROLES` (JSON: `{email: {ads: 'viewer', engage: 'editor', …}}`), or a small config table later. Engage roles are `viewer / editor / approver / admin`. The backend enforces Engage roles again through `X-Admin-Actor` → `engage_roles`, so the UI is never the only gate. This also fixes the all-or-nothing access in the current flat allowlist, which is worth doing anyway.
- **Blast radius:**
  - Engage code is lazy-loaded per route, so it adds nothing to the Ads and Releases bundles.
  - Module tests run in CI on every deploy.
  - Vercel preview deployments are used for Engage changes.
  - Instant rollback is available.

## Recommendation

**Choose C.** It gives you everything you asked for:
- its own URL;
- its own feel;
- linked from Admin Tools;
- separate access for marketers.

It avoids paying again for auth, the proxy, the previews and the audience editor, and avoids two places to manage access. The deployment coupling that remains is minor, because both apps are thin UIs over the same backend.

## Graduation triggers (when to split into its own repo and deployment, option B)

- Engage needs to serve **apps outside Inov8r Labs**. FitCircle, BuyForBaby and TripWiz are inside, so they don't count; or users outside our Google Workspace domains (inov8rlabs.com, buyforbaby.in), such as agency marketers with their own login.
- Engage's deploy cadence starts blocking Admin Tools releases, or the reverse. For example, Engage moves daily and Releases needs a freeze.
- Engage needs a server component of its own that doesn't belong in FitCircleBE, such as a rendering service for native snapshot previews or a multi-tenant data plane.
- The Engage bundle or tests make Admin Tools builds noticeably slower (more than about 3 minutes).

**If we graduate**, the module boundary makes the move mechanical. `components/modules/engage/*` and the shared kit become a package, the domain moves to the new Vercel project, and the backend doesn't change.

## Work items (the hosting part only)

These are tracked in `ENGAGE_FINISH_PLAN.md` phase E1.
1. Add the `engage` module scaffold, proxy rules and tests in `inov8r-admin`.
2. Add the `engage.inov8rlabs.com` domain to the Admin Tools Vercel project, plus DNS. This is a user step in the Vercel dashboard or the domain registrar.
3. Add middleware for host-based routing and the Engage shell.
4. Set the cookie domain, or add a second OAuth redirect URI.
5. Add per-module roles (`ADMIN_MODULE_ROLES`) and backend `engage_roles` enforcement.
6. Add an "Engage ↗" tile in Admin Tools and an "Admin Tools ↗" link in Engage.
7. Keep Vercel SSO off on the new custom domain, as was done for Admin Tools. Google OAuth plus the allowlist is the gate.
