# Reopening EU/EEA sign-ups: GDPR compliance plan

Status: planning document, 2026-11-06. **Not legal advice.** Every cost and effort figure is an engineering estimate to be confirmed with counsel and vendors.

## Where we are today

**Owner decision (2026-11-06):** FitCircle does not accept new sign-ups from the EU/EEA.

**What is blocked** (`WEB_EU_SIGNUP_BLOCK`, **default on**, `lib/geo/region-restriction.ts`), for requests whose Vercel edge country (`x-vercel-ip-country`) is in the EU-27, Iceland, Liechtenstein, Norway or Switzerland:
- Website: `/register` and `/upgrade` redirect to `/not-available`.
- APIs return 403 `REGION_NOT_AVAILABLE`:
  - `POST /api/auth/register`
  - `POST /api/mobile/auth/register`
  - a first Google or Apple sign-in through `POST /api/mobile/auth/google|apple`
  - `POST /api/billing/checkout`

**Still allowed:**
- Existing accounts sign in (email and social), export their data and delete their account.
- The UK is restricted too since 2026-11-06 (removed from both app stores; no UK Art. 27 representative). Reopening the UK needs a UK representative (~£120–£1,200/yr), the UK analytics basis in the policy, and the UK back in store availability.
- The apps are not distributed in EU App Store or Play territories.

**Known residual exposure:**
- **IP geolocation is imperfect.** VPNs and travellers get through. Good-faith restriction is what matters for "offering" under Art. 3(2)(a).
- **The website calls Supabase `auth.signUp` directly from the browser.** A determined user could call it with the public anon key and skip the `/register` page.
  - Closing this fully means moving web sign-up behind a server route, or turning on a Supabase Auth hook that rejects by country.
  - Effort: about 0.5 day. Worth doing before any marketing that could reach the EU.
- **One EU account already exists** (BG, from experiment data). It keeps its rights paths; no special handling is needed.

Because the UK fixes are shipped (server-side consent records, AI gating, 18+, export, processor deletion, email compliance), most substantive GDPR work is already done. The UK GDPR is materially the same law. What remains for the EU is mainly representation, contracts, assessments, tax and localisation.

## What full EU compliance would take

### Phase 1: legal footing (prerequisites; about 2–4 weeks elapsed, 3–5 engineering days)

| Item | What | Effort / cost (rough) |
|---|---|---|
| EU Art. 27 representative | Required: no EU establishment, and health data at scale rules out the "occasional" exemption. Commercial services often bundle EU and UK representation. | about €1,000–€3,000 a year (often €100–€250 a month); a few hours to contract |
| Privacy Policy EU section | Add EU rights (Arts. 15–22), the representative, and the right to complain to any EU supervisory authority (no lead authority without an establishment). Name the transfer mechanism to Canada (EU adequacy decision for Canada, commercial organisations) and from Canada to the US (EU SCCs or the EU-US DPF for certified vendors). | 0.5 day plus counsel review |
| Vendor DPAs and transfer tools | Confirm signed or click-through DPAs with EU SCCs (Module 2/3) or DPF certification for Supabase, Vercel, Anthropic, Google (Vertex), Amplitude, Sentry, RevenueCat, Stripe and Resend. Most are click-through. | 1–2 days of admin |
| Transfer impact assessment | One TIA covering the vendors above, including US access risk (FISA 702 / EO 14086) and safeguards (encryption, ZDR on AI). | 1–2 days, or about €1,500–€4,000 with counsel |
| Records of processing (Art. 30) | Required because we process special-category data. Extend the audit's data map. | 1 day |
| DPIA for health data and AI (Art. 35) | Likely mandatory: large-scale special-category data plus innovative technology (AI analysis of meal and body-composition photos). Cover purposes, necessity, risks, mitigations, and residual risk to consult the regulator about if it stays high. | 2–4 days, or about €3,000–€8,000 with counsel |

### Phase 2: product and consent changes (about 1–2 weeks of engineering)

| Item | What | Effort |
|---|---|---|
| Analytics consent in the apps (ePrivacy Art. 5(3)) | The EU has no statistical-analytics exemption like the UK DUAA, so Amplitude in the apps needs opt-in consent for EU users. Gate SDK start on consent (reuse UMP / TCF purpose 1) and add a Settings toggle. The website already gates Amplitude behind its cookie banner. | 2–3 days across iOS and Android |
| Ads and attribution | AdMob already uses UMP/TCF. Android already turns Meta off where GDPR applies; iOS needs the same check of `IABTCF_gdprApplies` (audit F13). Recheck GA4 consent mode for the EEA. | 0.5–1 day |
| Marketing email | Opt-in for EU users (no soft opt-in for free accounts). The `marketing_email` consent record exists; default EU users to off until they tick it. | 0.5 day |
| Health-data and AI consent | Already explicit and server-recorded. Confirm the copy meets Art. 9(2)(a) "explicit" in every EU language shipped. | — |
| Age | The 18+ gate already exceeds the Art. 8 child-consent ages (13–16). | — |
| Retention jobs | Implement the retention schedule (purge crons for chat, Fitzy messages, audit IPs, training samples, inactive accounts) the EU policy will promise. Also needed for the UK. | 1–2 days |
| Breach runbook | 72-hour notification to the competent EU authority, via the representative. Extend the UK runbook. | 0.5 day |
| Data subject requests | In-app export and delete already exist. Add a documented process for rectification, restriction and objection by email within one month. | 0.5 day |

### Phase 3: tax and payments (about 1 week, plus registration lead time)

| Item | What | Effort / cost |
|---|---|---|
| EU VAT (OSS) | Digital services sold B2C to EU consumers are taxed where the customer is, from the first euro for non-EU sellers. Register for the non-Union OSS scheme in one member state and file quarterly. | Registration 2–6 weeks elapsed; filing about 1–2 hours a quarter, or an accountant at about €500–€1,500 a year |
| Stripe Tax | Turn on `automatic_tax` in Checkout (`billing-service.ts` does not today), collect the billing country, and show VAT-inclusive prices. | 1–2 days plus Stripe Tax fees (about 0.5% of tax-collected volume) |
| App stores | Not affected while the apps stay out of EU territories. If they launch there, Apple and Google act as merchant of record and remit VAT; the privacy work above still applies. | — |
| Consumer law | 14-day withdrawal right for digital content and subscriptions (express consent plus acknowledgement at checkout), EU-compliant price display, and the ODR / dispute line in the Terms. | 1 day plus counsel |

### Phase 4: localisation (optional at first; 1–3 weeks)

| Item | What | Effort / cost |
|---|---|---|
| Language | Not legally required for privacy notices in English to an English-speaking audience, but consumer-protection and consent rules expect information "in clear and plain language" the user understands. Start with an English EU launch; add German, French and Spanish for the policy, consent copy and checkout when marketing targets those markets. | Professional translation of policy plus terms plus consent copy: about €1,500–€3,000 per language |
| Currency and pricing | EUR prices in Stripe and App Store territories. | 0.5 day |

## Rough total
- **One-off:** about 3–5 weeks of engineering and admin, plus about €5,000–€15,000 in counsel and assessments (DPIA, TIA, policy review).
- **Recurring:** about €2,000–€5,000 a year (EU representative, VAT/OSS filing, Stripe Tax).
- **Without localisation:** Phases 1–3 are the minimum for a compliant English-only EU launch.

## Reopening checklist
1. Phase 1 complete: representative appointed, DPIA and TIA signed off, DPAs on file.
2. Phase 2 shipped in app builds that are live in stores (analytics consent for EU users, iOS Meta TCF check, EU marketing opt-in default).
3. Phase 3 live: OSS registration number received, Stripe Tax on, checkout tested from an EU country.
4. Privacy Policy and Terms EU sections published.
5. Set `WEB_EU_SIGNUP_BLOCK=false` in Vercel production and redeploy. Monitor sign-ups by country in Amplitude.
