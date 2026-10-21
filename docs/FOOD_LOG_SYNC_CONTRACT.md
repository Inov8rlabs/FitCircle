# Food log: offline-sync contract (2026-10-21)

Backend changes made for the mobile local-first outbox. Every change is additive or changes only an error status, so clients that are already released keep working.

## DELETE /api/mobile/food-log/{id}: idempotent

| Case | Status | Body |
|---|---|---|
| Live entry, owner | 200 | `data: { deleted: true, entryId }` |
| Already deleted (a replay) | 200 | `data: { deleted: false, entryId }`. Side effects (audit, chat tombstone) are not re-run. |
| Unknown / never-synced / malformed id | 200 | `data: { deleted: false, entryId }` |
| Another user's entry | 404 | `error.code: NOT_FOUND`. The entry is not touched. |
| Database error | 500 | `error.code: DATABASE_ERROR`. Retry later. |

- Water entries, whether deleted now or before, still get `data.hydration` (optional).
- Before this change: missing, already-deleted-by-someone-else and DB errors were all `400 DELETE_FAILED "Not authorized"`. A replayed delete of your own entry returned `deleted: true`.
- Clients: treat any 2xx as done, and treat 404 as done too. iOS (`APIResponse<EmptyResponse>`) and Android (`DeletedFoodLogEntry`, `success`) already do this.

## PATCH /api/mobile/food-log/{id}: real status codes

| Case | Status | `error.code` |
|---|---|---|
| Bad body (schema) | 400 | `VALIDATION_ERROR` (`details` keyed by field) |
| Body is not JSON | 400 | `INVALID_JSON` |
| A value the DB rejects (check / not-null / FK / format) | 400 | `VALIDATION_ERROR` |
| No such id, or the entry is deleted | 404 | `NOT_FOUND` |
| Another user's entry | 403 | `FORBIDDEN` |
| Database / server error | 500 | `DATABASE_ERROR` / `INTERNAL_SERVER_ERROR` |

- Before this change, everything except schema errors was `400 UPDATE_FAILED`, with the message "Not authorized" for missing, deleted and foreign entries.
- **Android `FoodLogSyncEngine.explainUpdateFailure`** matches `UPDATE_FAILED` + "Not authorized". Switch it to `status == 404` / `code == "NOT_FOUND"` ("deleted on another device"). A 404 is still classed as Permanent, so nothing breaks until then; only the friendly message is lost.

## Create / PATCH responses: photo URLs

- `data.image_urls`: always present, possibly `[]`. Ordered by `display_order`, medium size, the same URLs as GET.
- `data.photo_url`: present only when there is at least one image (the first one).
- This is the same shape as GET `/api/mobile/food-log`. GET is unchanged: it still omits both fields for entries without images.
- A retried create (`meta.duplicate: true`) reports the photos already uploaded, so a client can drop its local copies.

## POST /api/mobile/food-log: log-time `timezone`

- New optional body field: `timezone` (IANA, e.g. `"Asia/Tokyo"`), the device zone **when the entry was logged**.
- When `entry_date` is absent, the entry's day is `logged_at` (or now) in this zone. The streak auto-claim uses the same zone, so `meta.streak.day == data.entry_date`.
- Zone priority: body `timezone`, then the `x-client-timezone` header, then `profiles.timezone`, then UTC. Before this change the body field was already read, but the streak claim fell back to a different zone than the entry date.
- An invalid zone is **ignored, not rejected**. The next source in the list is used and `meta.ignoredTimezone` echoes the bad value. A 400 would be dropped permanently by an outbox, and Java zone ids such as `GMT+05:30` can fail IANA validation.
- `meta.entryTimezone: { timezone, source: "body" | "header" | "profile" | "default" }` reports the zone that was used.
- For water, `data.hydration` ("today") uses the header zone, or the body zone when there is no header.
- An explicit `entry_date` still wins. Old clients that send no `timezone` behave exactly as before.

## Photo uploads: idempotent per entry + key

### POST `/api/mobile/food-log/{id}/images/batch` (multipart, `images` repeated)

- Optional `image_keys`, one per file in the same order. Send it as repeated form fields or as one JSON-array string.
  - Each key is 1–128 characters from `[A-Za-z0-9._:-]`.
  - An empty string or `null` means "no key for this file".
  - A count mismatch or a bad key returns `400 INVALID_IMAGE_KEYS` and nothing is stored.
- With no key, the file is keyed by the SHA-256 of its bytes. This covers old clients that re-send identical bytes.
- Files already stored for that key come back in `data.uploaded` with `duplicate: true` and the original image id and URLs. They add no row, do not bump `image_count` and write no audit row.
- Every uploaded item echoes `image_key`, which is the client key or `sha256:<hex>`.
- `data.counts.duplicates` is new.
- Status:
  - 201 when anything new was stored.
  - 200 when the whole batch was already there.
  - 400 when nothing was stored.
- New files in a partly-retried batch take the next contiguous `display_order`.
- A photo that was removed and is then attached again is stored as a new image.
- Recommended client key: a stable per-photo UUID generated when the photo is queued. With a key, a re-encoded retry still dedupes.

### POST `/api/mobile/food-log/{id}/images` (single file)

- Optional `image_key` field, with the same rules.
- A duplicate returns `200` with `meta.duplicate: true` and the stored image. A new image returns `201` as before.
