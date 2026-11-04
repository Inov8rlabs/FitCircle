# Invite email validation

Addresses a member types for someone else (referral invites, circle invites) are validated on
every platform and again on the server before anything is sent. A bounce
(`r.celeste1957@yahoo.comr`) costs the sending domain reputation, so a likely typo of a big
provider is **rejected with a suggestion**, never silently sent.

## One validator, four copies

| Platform | File |
|---|---|
| Server + web (canonical) | `apps/web/app/lib/validation/email-address.ts` |
| iOS | `FitCircle-iOS/FitCircle/Core/Validation/EmailAddressValidator.swift` |
| Android | `Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/core/validation/EmailAddressValidator.kt` |

Shared vectors: `apps/web/app/lib/validation/__fixtures__/email-cases.json`. Change it here first,
then copy it into both apps' tests (iOS `FitCircleTests`, Android `app/src/test/resources/email-cases.json`).
All four test suites assert every case.

Result: `{ valid, normalized, suggestion?, reason? }`, with reason one of
`empty | syntax | unknown_tld | typo_likely`. The server can also return `domain_not_found` (DNS check).
`normalized` is the trimmed address with the domain lower-cased.

Rules, in order:
1. **empty**: blank after trimming.
2. **syntax**: exactly one `@`; local part 1–64 chars (dot-atom: no leading, trailing or double
   dots); domain ≤253 chars with at least 2 labels; each label is `[a-z0-9-]`, 1–63 chars, with no
   leading or trailing hyphen; no whitespace; the whole address is ≤254 chars.
3. **unknown_tld**: the last label isn't in the bundled IANA list. Known fixes such as
   comr/con/cmo/ocm/coom/c → com, nett → net and orgg → org give a suggestion. So do near misses of
   a big provider (`gmail.cim` → gmail.com).
4. **typo_likely**: the TLD is real, but the domain is a near miss of a big provider:
   - Brand edit distance (OSA) ≤1 for 5–7-letter brands, or ≤2 for 8+ letters, with the same suffix
     (`gmial.com`, `hotmial.co.uk`).
   - `.co`, `.cm` or `.om` on a provider (`gmail.co`, `yahoo.cm`).
   - Any other TLD on Gmail, Googlemail or iCloud (`gmail.net`).

   Short brands (me, aol, live, msn) are never fuzzy-matched, so `love.com` and `aon.com` stay valid.
   Known real domains (`hotmail.fr`, `yahoo.co.jp`, `email.com`) are never "corrected".

### Refreshing the TLD list

```
node apps/web/scripts/refresh-email-tlds.mjs \
  --ios ../FitCircle-iOS/FitCircle/Core/Validation/EmailTLDs.generated.swift \
  --android ../Fitcircle-Android/FitCircle/app/src/main/java/com/fitcircle/app/core/validation/EmailTlds.kt
```

This downloads https://data.iana.org/TLD/tlds-alpha-by-domain.txt and rewrites all three copies.
Ship them together. Refresh a couple of times a year, or when a real address is rejected with
`unknown_tld`.

## Server gate and error contract

`lib/email/invite-email-check.ts` → `checkInviteEmails()` runs the validator, then a DNS check for
domains that aren't big providers:
- It looks up MX records first, then A/AAAA as an implicit MX.
- Each lookup times out after 1.5 s. Results are cached per instance for 6 h.
- It fails open on timeouts and resolver errors. Only NXDOMAIN, no records at all, or a null MX
  (RFC 7505) rejects an address.
- Set `INVITE_EMAIL_MX_CHECK=off` to turn the check off.

If any address fails, **nothing is sent**. That includes the SMS contacts in the same batch. The
client fixes the address and resends.

**`POST /api/mobile/referrals/invites` and `POST /api/referrals/me/invites`** (standard envelope):

```json
HTTP 422
{
  "success": false,
  "data": { "invalidEmails": [
    { "index": 0, "email": "r.celeste1957@yahoo.comr", "reason": "unknown_tld", "suggestion": "r.celeste1957@yahoo.com" }
  ] },
  "error": { "code": "INVALID_EMAIL", "message": "That email doesn't look right.",
             "details": { "invalidEmails": [ ...same... ] }, "timestamp": "…" },
  "meta": null
}
```

**`POST /api/fitcircles/[id]/invite`** (web circle share dialog, legacy shape):

```json
HTTP 422
{ "error": "INVALID_EMAIL", "message": "That email doesn't look right.", "invalidEmails": [ ... ] }
```

- `index` is the position in the request's `contacts[]` or `emails[]`.
- `suggestion` is left out when there is none.
- Clients show any unknown `reason` as the generic copy.
- Shipped clients from before this change see a failed request with the message
  "That email doesn't look right." They don't get a suggestion.

Reminder emails (`nudge`) silently skip stored addresses that fail validation. Those were invites
sent before this change.

## Client copy

- Error: "That email doesn't look right."
- Suggestion: "Did you mean name@yahoo.com?" Tapping it replaces the address.

Send stays disabled while the field holds an invalid email.

Analytics (tracking plan v17):
- `Invite Email Rejected` {reason, suggestion_shown, checked_by: client|server, source}
- `Invite Email Suggestion Accepted` {reason, source}

## Suppression (follow-up)

The only suppression list today is `referral_email_optouts`, keyed by
`contactHash('email', lower(address))`. Two send paths check it before sending:
- referral invites and reminders (reported as `opted_out`)
- the circle invite route (counted in `skipped`)

**Hard bounces are not recorded yet.** The Resend webhook ledger is being built on the lifecycle
messaging branch. When it lands, its `email.bounced` (hard) and `email.complained` handlers should
insert the address's `contactHash('email', …)` into `referral_email_optouts`, or into a shared
suppression table that these two checks also read. Don't build a second webhook here.
