# Fitzy v2 — better model, streaming, daily focus, weekly plans, memory, Pro teasers

Status: binding contract for backend, iOS and Android. 2026-10-19.
Work happens on branch `feat/fitzy-v2` in the worktrees `FitCircleBE-fitzy`, `FitCircle-iOS-fitzy`, `Fitcircle-Android-fitzy` (NOT the main checkouts, which hold unrelated uncommitted Engage work).
Analytics: tracking plan v11 already has the new events (Fitzy Response Received, Suggestion Tapped, Action Tapped, Daily Focus Viewed, Plan Created, Commitment Checked, Locked Feature Viewed, Upgrade Tapped, Tip Shared, Memory Edited) + `fitzy` invite source; generated code is in all three worktrees.

## 0. Why
Fitzy ran on Claude Sonnet 4.6 ($3/$15 per M tokens, 9–15 s, no streaming, no caching) with a bare chat UI and a generic 429 at the free cap. A bake-off on our real system prompt + grounding (6 prompts: motivation, home workout, vegetarian dinner, protein, "lose 10 lb by Christmas", knee pain) showed **Claude Haiku 5.5** answering as well (data-grounded, safe on the target/medical prompts, 0 guard trips) in 4–7 s at ~$0.0006/reply (≈15× cheaper). Sonnet 5.5 is stronger at structured planning but 2–3× wordier.

## 1. Models (backend, `lib/fitzy/models.ts`)
- `FITZY_CHAT_MODEL` = `anthropic/claude-haiku-5.5` — every chat turn, all tiers; also daily focus + memory extraction.
- `FITZY_DEEP_MODEL` = `anthropic/claude-sonnet-5.5` — weekly plan generation + Sunday weekly recap (Pro).
- Env overrides `FITZY_CHAT_MODEL` / `FITZY_DEEP_MODEL`. Fallback: on error/timeout (25 s) try the other model once, then SAFE_FALLBACK.
- **Prompt caching**: the static SYSTEM_PROMPT is sent as its own system message with `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }`; the per-user grounding goes in a second, uncached system message.
- Add to STYLE: "Keep replies under ~170 words unless the user asks for a plan or a list; end with at most one short question."
- Record `model`, input/output tokens per assistant message (for cost dashboards).
- All existing prohibitions, the body-comp rules and `containsForbiddenContent` stay verbatim. Every generated text (chat, daily focus, plan, recap, memory items) passes the guard.

## 2. Conversations (server-held) — migration `105_fitzy_v2.sql` (schema only)
- `fitzy_conversations (id uuid pk, user_id fk profiles, title text, created_at, updated_at, archived_at)`
- `fitzy_messages (id uuid pk, conversation_id fk cascade, user_id, role text check in ('user','assistant'), content text, suggestions jsonb default '[]', actions jsonb default '[]', model text, input_tokens int, output_tokens int, guard_tripped bool default false, created_at)` + index (conversation_id, created_at)
- `fitzy_memory (user_id pk fk profiles, items jsonb default '[]', last_growth_nudge_at timestamptz, updated_at)`
- `fitzy_daily (user_id, date, payload jsonb, created_at, pk(user_id,date))`
- `fitzy_plans (id uuid pk, user_id, week_of date, goal text, commitments jsonb, note text, model text, created_at, updated_at, unique(user_id, week_of))`
- RLS enabled, no anon/auth policies (service role via API only).

## 3. API (mobile envelope unless SSE; Bearer)
### 3.1 `POST /api/mobile/fitzy/chat/stream` → `text/event-stream`
Body: `{ message: string (1–4000), conversationId?: uuid, circleId?: string, clientMessages?: [{role, content}] }` (`clientMessages` only for the first call from older local history; server history wins when `conversationId` is given).
Events (each `event: <name>\ndata: <json>\n\n`):
- `meta` `{ conversationId, tier: 'free'|'pro', remaining: number|null }` — sent first.
- `delta` `{ text }` — next chunk of the visible answer. Server buffers to sentence boundaries and runs the guard on the accumulated text BEFORE emitting, so unsafe text is never sent.
- `replace` `{ text }` — guard tripped after some text was sent (rare): client replaces the bubble with `text` (SAFE_FALLBACK).
- `done` `{ messageId, answer, suggestions: string[≤3], actions: Action[≤2], disclaimer, remaining }`
- `error` `{ code, message, paywall? }` — `UPGRADE_REQUIRED` carries `paywall` (§6), `RATE_LIMITED`, `UNAUTHORIZED`, `INTERNAL`.
Keep a heartbeat comment `: ping` every 10 s. `Cache-Control: no-store`, `X-Accel-Buffering: no`. `export const maxDuration = 60`.
### 3.2 `POST /api/mobile/fitzy/chat` (existing, non-stream) — unchanged request shape still works; response adds `conversationId`, `messageId`, `suggestions`, `actions`, `remaining`, `tier`. Old clients keep working.
### 3.3 Conversations
`GET /api/mobile/fitzy/conversations` → `{ conversations: [{id,title,updatedAt,preview}] }` (Pro: all; Free: only the latest, plus `historyLocked: true`) · `GET /api/mobile/fitzy/conversations/{id}` → `{ id, title, messages: [...] }` · `DELETE /api/mobile/fitzy/conversations/{id}`. Title = first user message trimmed to 48 chars.
### 3.4 Daily focus `GET /api/mobile/fitzy/today`
→ `{ date, headline (≤70), body (≤240), cta: { label, action: Action }, kind: 'tip'|'recap'|'plan_nudge'|'welcome', tier }`. Generated once per user per local day (x-client-timezone) with Haiku from the same grounding (+ plan progress, + memory for Pro), cached in `fitzy_daily`. Sunday for Pro with a plan = weekly recap (Sonnet). New users (no data) get a `welcome` focus. FREE gets the full daily focus (it's the hook) but its CTA is "Make this my plan" → `start_plan` (which is Pro).
### 3.5 Weekly plan
`GET /api/mobile/fitzy/plan` → `{ plan: Plan | null, locked: boolean, preview?: PlanPreview }`
`POST /api/mobile/fitzy/plan` body `{ goal?: string (≤200) }` → Pro: generates with Sonnet (3–5 commitments) → `{ plan }`; Free: `{ locked: true, preview }` where preview = `{ goal, firstCommitment: Commitment, moreCount: n }` (generated with Haiku, cached for the week) — the teaser.
`POST /api/mobile/fitzy/plan/commitments/{id}/check` body `{ date: YYYY-MM-DD, done: boolean }` → `{ plan }`.
```
Plan = { id, weekOf (Monday), goal, note, commitments: Commitment[], createdAt }
Commitment = { id, kind: 'move'|'eat'|'hydrate'|'sleep'|'circle'|'mind', title (≤48), detail (≤140), target: { count: 1–7, per: 'week' }, doneDates: string[] }
```
Commitments must obey every prohibition (no calorie targets, no restriction, no weight targets). Examples: "3 walks of 15 min", "Protein at breakfast 4 days", "Check in with Hold the Line daily", "Lights out by 11 on 3 nights".
### 3.6 Memory (Pro)
`GET /api/mobile/fitzy/memory` → `{ items: [{id, text, kind: 'goal'|'preference'|'routine'|'constraint', createdAt}], locked }` · `DELETE /api/mobile/fitzy/memory/{id}` · `DELETE /api/mobile/fitzy/memory` (clear all).
After each Pro chat turn, a background Haiku call (fire-and-forget, `waitUntil` if available) extracts ≤2 NEW items the user stated explicitly about themselves (goals, food/exercise preferences, schedule/routine, equipment, dislikes). NEVER store health conditions, medications, injuries, body measurements, weight, or anything about other people. Cap 25 items (drop oldest). Memory text is included in grounding for Pro. Free: `locked: true`, `items: []`.

### 3.7 Action
```
Action = { type: 'log_meal'|'log_workout'|'start_plan'|'share_tip'|'invite_buddy'|'open_circle', label (≤28), payload?: { text?: string, circleId?: string } }
```
## 4. Suggestions + actions (model meta)
The system prompt instructs the model to end every reply with a line `<<<FITZY_META>>>` followed by one JSON object `{"suggestions": [...≤3 short follow-up questions the USER might ask next, ≤40 chars each], "actions": [...]}`. Server strips everything from the marker on (never streamed to the client), parses tolerantly, validates types/lengths, and drops invalid entries. If parsing fails: suggestions from a small static set per topic, actions [].
Growth guardrails (server-enforced, not left to the model):
- `share_tip` allowed only when the reply contains a concrete, general tip (the model decides) and never in medical/injury/body-comp contexts (server drops it if the user message or answer mentions pain/injury/medication/body fat).
- `invite_buddy` allowed at most once per 7 days per user (`fitzy_memory.last_growth_nudge_at`), only when the user's message is about motivation, accountability, consistency, friends, or a plan — the grounding tells the model `growthNudgeAllowed: true|false`; the server drops the action when false and stamps the time when it is sent.
- No action ever sends anything automatically; clients open the existing composer/share sheet/invite sheet for the user to decide.

## 5. Grounding additions
Existing blocks + (Pro) memory items + current plan progress ("2 of 3 walks done, 1 of 4 protein breakfasts") + streak length + the user's first name. Keep it compact (<1.2k tokens).

## 6. Free vs Pro
| | Free | Pro |
|---|---|---|
| Chat | 5 messages/day (existing TIER_LIMITS), Haiku | unlimited (200/day safety cap), Haiku |
| Daily focus | yes (full) | yes + Sunday recap (Sonnet) |
| Weekly plan | preview: goal + first commitment + "N more" | full plan, check-offs, recap |
| Memory | locked teaser | yes, view/delete |
| History | latest conversation only | all conversations |
Paywall payload (in `error.paywall` and locked responses): `{ trigger: 'fitzy_quota'|'weekly_plan'|'memory'|'history', headline, bullets: [3 short benefit lines], cta: 'Unlock Fitzy Pro' }`. Copy: headline "Keep the momentum going" (quota) / "Your plan is ready" (plan) / "Fitzy can remember what matters to you" (memory). Remaining-count: `remaining` in meta/done; clients show "3 free messages left today" only when remaining ≤ 3.

## 7. Clients (iOS + Android) — Fitzy screen redesign
- **Header**: Fitzy avatar, name, "Pro coach" badge for Pro; overflow menu: New chat, History (Pro; Free → locked sheet), What Fitzy remembers (Pro; Free → locked sheet).
- **Today's focus card** at the top of an empty/new conversation (and collapsible above chat): headline, body, CTA button (action router). Fires `Fitzy Daily Focus Viewed`.
- **This week strip**: Pro with plan → horizontal commitment chips with progress rings (tap = check for today, long-press/detail = info); Pro without plan → "Plan my week" button (optional goal text); Free → blurred preview (goal + first commitment readable, others blurred) + "Unlock your weekly plan" → paywall (`Fitzy Locked Feature Viewed`/`Upgrade Tapped` feature `weekly_plan`).
- **Chat**: streaming assistant bubble (typing indicator until first delta, text appears smoothly), Markdown rendering (existing renderer), suggestion chips under the latest reply, up to 2 action buttons, disclaimer as a small footnote once per conversation. Empty state: 4 prompt starters ("Plan my week", "Quick dinner idea", "20-min workout", "Help me stay consistent").
- **Free quota**: subtle "3 free messages left today" pill when ≤3; on `UPGRADE_REQUIRED` show an inline Pro card in the chat (headline, 3 bullets, "Unlock Fitzy Pro" → existing paywall with source `fitzy`), never a blocking modal; composer disabled with "Back tomorrow, or go Pro".
- **Share tip** (`share_tip`): render a tip card image (Fitzy avatar, the tip text, "via FitCircle") + the user's invite link in the share text → system share sheet. Fire `Fitzy Tip Shared` only on completion.
- **Invite buddy** (`invite_buddy`): open the existing invite sheet with source `fitzy`, prefilled message "Want to do this week's plan with me on FitCircle?".
- **Actions**: log_meal → food log (photo), log_workout → exercise log, start_plan → plan flow (or paywall for free), open_circle → circle detail.
- **Memory sheet** (Pro): list with swipe/x to delete, "Clear all" with confirm; Free: teaser explaining the feature + Unlock.
- **History** (Pro): conversation list; tap to open; swipe to delete.
- **Home**: a slim "Fitzy's focus for today" card (headline + "Ask Fitzy") below the streak card, dismissible for the day. (On iOS use the existing dashboard widget pattern; on Android the dashboard card list.)
- Streaming transport: iOS URLSession bytes (`AsyncBytes`) SSE parser; Android OkHttp SSE (okhttp-sse) or manual line reader. Must handle reconnect-free single request, cancellation on leave, and fall back to `/chat` (non-stream) if the stream endpoint 404s.
- Local history migration: on first open after update, if the device has local Fitzy history (existing persistence) and no server conversation, send it as `clientMessages` with the first message (one time), then rely on the server.
- Accessibility: VoiceOver/TalkBack read the final message (not every delta), Dynamic Type, Reduce Motion (no shimmer).
- Debug harness surfaces + screenshots: empty state with daily focus (free + pro), plan strip (pro with plan, free locked preview), streaming mid-answer with suggestions + actions, quota-reached inline Pro card, memory sheet, share tip card.

## 8. Live model eval (`npm run fitzy:eval`, `apps/web/scripts/fitzy-eval/`)
Unit tests mock the LLM. The live eval runs the production prompts, `callOptions`, `StreamGuard` + output guard, meta parsing and the plan/focus/memory parsers against the real models through the AI Gateway, and exits 1 when a gate fails. Full details are in `apps/web/scripts/fitzy-eval/README.md`.
- **Run it before merging any change** to prompts or grounding wording, models (`FITZY_CHAT_MODEL`/`FITZY_DEEP_MODEL`), provider options (thinking, timeouts, `maxOutputTokens`), the guard, `PLAN_UNSAFE`/`sanitizeCommitments`, memory exclusions or meta parsing. Compare against a saved run with `--baseline=<results.json>`.
- **Gates**: chat has 0 model failures, meta present + schema-valid ≥ 90%, 0 guard trips on cases expecting a safe reply, length ≤ 200 words (350 for lists), and 0 deterministic safety/quality check failures. With `--judge` (Opus 5.5) it adds 0 safety fails (hard) and mean overall ≥ 7. Plan and preview must give 10/10 parsed on the primary model with no `length` finish and ≥ 3 commitments surviving the sanitiser. Focus, recap and memory must give N/N parsed + validated on the primary model.
- **Cost** (measured 2026-10-20): ~$0.08 for all suites without the judge, plus ~$0.022 per judged reply (~$0.70 for all 32 chat cases). Fixtures are synthetic personas in `scripts/fitzy-eval/fixtures/cases.json`.

## 9. Push notifications
Fitzy's daily focus, Sunday recap, Monday plan prompt and two contextual nudges (hydration, protein) also go out as push notifications (category `coach`, toggle "Coaching tips from Fitzy", `screen: fitzy_chat` seeded with the tip). Behind the `FITZY_PUSH_ENABLED` kill switch. Full spec, rules and rollout: **docs/FITZY_PUSH_NOTIFICATIONS.md**.
