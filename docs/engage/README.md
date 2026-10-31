# Engage: Inov8r Labs' in-house Braze replacement

> **Moved 2026-10-31:** the canonical docs and all shared code now live in **https://github.com/Inov8rlabs/engage** (local checkout `~/Code/Engage`, folder `docs/`). This folder is a snapshot kept beside the parked v1 code.

**Status (2026-10-30):** Parked work-in-progress plus a v2 plan awaiting approval.

Engage runs push, in-app messages, in-app cards, placements, email, journeys and seasonal campaigns from one tool, with no app code changes per campaign. It has rich targeting (platform, app version, OS, locale, country, subscription, behaviour, events), previews for iOS, Android and web, and A/B tests with controls. It is multi-app: FitCircle first, then BuyForBaby and TripWiz.

| Doc | What's in it |
|---|---|
| [ENGAGE_IMPLEMENTATION_PLAN.md](ENGAGE_IMPLEMENTATION_PLAN.md) | **The execution plan:** every work item with files, DDL, interfaces, tests, done criteria, rollout runbook and human steps |
| [ENGAGE_V2_SPEC.md](ENGAGE_V2_SPEC.md) | **The spec:** product, architecture, surfaces, targeting, content schema, send pipeline, consent and caps, APIs, data model, tool, analytics, open decisions (§17) |
| [ENGAGE_FINISH_PLAN.md](ENGAGE_FINISH_PLAN.md) | **What it takes to finish:** v1 bugs and gaps, phases E0–E12 with effort, release coupling, test plan, human steps, risks |
| [ENGAGE_MULTITENANCY.md](ENGAGE_MULTITENANCY.md) | How one Engage serves FitCircle, BFB and TripWiz: options, the recommended protocol + engine + SDKs + adapters, the monorepo layout, per-app adapters, onboarding a new app |
| [ENGAGE_TOOL_HOSTING.md](ENGAGE_TOOL_HOSTING.md) | Standalone `engage.inov8rlabs.com` vs Admin Tools: reasoning, tradeoffs, recommendation, graduation triggers |
| [ENGAGE_RESEARCH.md](ENGAGE_RESEARCH.md) | Evidence: Braze and competitor research with sources, platform policy (App Review 4.5.4 etc.), architecture patterns, the v1 code audit, the audit of systems on main |
| [ENGAGE_SPEC_V1_PARKED.md](ENGAGE_SPEC_V1_PARKED.md) | The original v1 spec (2026-10-16), kept for reference |

**Parked code** (branch `feat/engage`, pushed):

| Repo | Commit |
|---|---|
| FitCircleBE | `1238991` (+ these docs) |
| FitCircle-iOS | `6389971` |
| Fitcircle-Android | `6611b10` |

The commits also contain stale auth and network edits that have since shipped on main; drop them when porting. **Port by hand; don't rebase** (see the plan §1).
