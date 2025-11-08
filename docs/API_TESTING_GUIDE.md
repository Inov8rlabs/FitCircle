# API Testing Guide - FitCircle Mobile Backend
**Quick Reference for Testing New Endpoints**

## Prerequisites

1. Start dev server:
```bash
cd /Users/ani/Code/FitCircleCode/FitCircleBE/apps/web
npm run dev
```

2. Get access token by logging in:
```bash
curl -X POST http://localhost:3000/api/mobile/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@example.com",
    "password": "your-password"
  }'
```

Save the `access_token` from response.

3. Set environment variable for convenience:
```bash
export TOKEN="your-access-token-here"
```

---

## 1. Authentication Endpoints

### Logout
```bash
curl -X POST http://localhost:3000/api/mobile/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

**Expected:** 200 with success message
**Verify:** Same token should fail on subsequent requests (401)

---

## 2. Settings & Preferences

### Get Preferences
```bash
curl http://localhost:3000/api/mobile/settings/preferences \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Update Preferences
```bash
curl -X PUT http://localhost:3000/api/mobile/settings/preferences \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notifications": {
      "push": false,
      "email": true
    },
    "privacy": {
      "profile_visibility": "private"
    }
  }' | jq
```

---

## 3. Circle Management

### Get Circle Details
```bash
export CIRCLE_ID="your-circle-id-here"

curl http://localhost:3000/api/mobile/circles/$CIRCLE_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Update Circle (Creator Only)
```bash
curl -X PUT http://localhost:3000/api/mobile/circles/$CIRCLE_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Circle Name",
    "description": "New description"
  }' | jq
```

**Expected:** 200 if creator, 403 if not creator

### Delete Circle (Creator Only, Upcoming Only)
```bash
curl -X DELETE http://localhost:3000/api/mobile/circles/$CIRCLE_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** 200 if creator + upcoming, 403 otherwise

### Leave Circle
```bash
curl -X POST http://localhost:3000/api/mobile/circles/$CIRCLE_ID/leave \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** 200 if member, 403 if creator

### Get Members
```bash
curl http://localhost:3000/api/mobile/circles/$CIRCLE_ID/members \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** 200 with member list if member, 403 if not member

### Submit Check-In
```bash
curl -X POST http://localhost:3000/api/mobile/circles/$CIRCLE_ID/check-in \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "value": 75.5,
    "mood_score": 4,
    "energy_level": 3,
    "note": "Feeling great today!"
  }' | jq
```

**Expected:** 200 with progress/rank data
**Second attempt same day:** 400 "Already checked in today"

---

## 4. Invites

### Get Invite Link
```bash
curl http://localhost:3000/api/mobile/circles/$CIRCLE_ID/invite-link \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** 200 with invite_code and invite_url

### Get Pending Invites
```bash
curl http://localhost:3000/api/mobile/invites/pending \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Decline Invite
```bash
export INVITE_ID="your-invite-id-here"

curl -X POST http://localhost:3000/api/mobile/invites/$INVITE_ID/decline \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 5. Profile

### Update Profile Settings
```bash
curl -X PUT http://localhost:3000/api/mobile/profile/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "height_cm": 175,
    "weight_kg": 75.5,
    "fitness_level": "intermediate",
    "timezone": "America/Los_Angeles"
  }' | jq
```

### Delete Avatar
```bash
curl -X DELETE http://localhost:3000/api/mobile/profile/avatar \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Get Stats
```bash
curl http://localhost:3000/api/mobile/profile/stats \
  -H "Authorization: Bearer $TOKEN" | jq
```

### Get Streak
```bash
curl http://localhost:3000/api/mobile/profile/streak \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 6. Rate Limiting Tests

### Test Login Rate Limit (5 attempts per 15 min)
```bash
# Run this 6 times quickly
for i in {1..6}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/api/mobile/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@example.com",
      "password": "wrongpassword"
    }' \
    -w "\nHTTP Status: %{http_code}\n\n"
done
```

**Expected:** First 5 return 401 (invalid credentials), 6th returns 429 (rate limit)

---

## 7. Token Auto-Refresh Test

### Check Response Headers
```bash
curl -v http://localhost:3000/api/mobile/profile \
  -H "Authorization: Bearer $TOKEN" 2>&1 | grep -i "X-New"
```

**Expected:** If token expires within 7 days, you'll see:
```
< X-New-Access-Token: eyJhbG...
< X-New-Refresh-Token: eyJhbG...
< X-New-Expires-At: 1697123456
```

---

## 8. Error Handling Tests

### Test 401 Unauthorized
```bash
curl http://localhost:3000/api/mobile/profile \
  -H "Authorization: Bearer invalid-token" | jq
```

**Expected:**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

### Test 403 Forbidden
```bash
# Try to update someone else's circle
curl -X PUT http://localhost:3000/api/mobile/circles/other-user-circle-id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Hacked"}' | jq
```

**Expected:**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Only the circle creator can update circle details"
  }
}
```

### Test 400 Validation Error
```bash
curl -X PUT http://localhost:3000/api/mobile/profile/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"height_cm": 10}' | jq
```

**Expected:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [...]
  }
}
```

---

## 9. Input Sanitization Tests

### Test XSS Protection
```bash
curl -X PUT http://localhost:3000/api/mobile/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bio": "<script>alert(\"XSS\")</script>Legitimate text"
  }' | jq
```

**Expected:** Script tags removed, only "Legitimate text" stored

### Test Circle Name Sanitization
```bash
curl -X POST http://localhost:3000/api/mobile/circles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<b>Bold</b> Circle <script>hack()</script>",
    "description": "Test",
    "startDate": "2025-11-01",
    "endDate": "2025-11-30"
  }' | jq
```

**Expected:** HTML tags and scripts removed from name

---

## 10. Permission Audit

### Verify Non-Member Cannot Access Circle
```bash
# Use a different user's token
export OTHER_TOKEN="different-user-token"

curl http://localhost:3000/api/mobile/circles/$CIRCLE_ID/members \
  -H "Authorization: Bearer $OTHER_TOKEN" | jq
```

**Expected:** 403 Forbidden

### Verify Creator Cannot Leave Own Circle
```bash
# Using creator's token
curl -X POST http://localhost:3000/api/mobile/circles/$CIRCLE_ID/leave \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expected:** 403 with message "Circle creators cannot leave their own circle"

---

## Common Issues & Solutions

### Issue: "Unauthorized" on all requests
**Solution:** Token expired or invalid. Login again to get fresh token.

### Issue: Rate limit errors during testing
**Solution:** Wait 15 minutes or restart dev server (clears in-memory rate limiter).

### Issue: "Circle not found" errors
**Solution:** Verify CIRCLE_ID exists and belongs to your user. Create a circle first.

### Issue: No auto-refresh headers
**Solution:** Token must expire within 7 days. For testing, temporarily change threshold in `mobile-auto-refresh.ts` to check `< 365 days`.

---

## Database Verification

### Check Token Blacklist
```bash
# In Supabase SQL Editor
SELECT * FROM token_blacklist
WHERE user_id = 'your-user-id'
ORDER BY blacklisted_at DESC
LIMIT 10;
```

### Check Participant Counts
```bash
# Verify participant_count matches actual members
SELECT
  c.id,
  c.name,
  c.participant_count as stored_count,
  COUNT(cp.id) as actual_count
FROM challenges c
LEFT JOIN challenge_participants cp ON c.id = cp.challenge_id AND cp.status = 'active'
GROUP BY c.id, c.name, c.participant_count;
```

### Check Circle Status
```bash
# Verify status matches dates
SELECT
  id,
  name,
  start_date,
  end_date,
  status,
  CASE
    WHEN NOW() < start_date THEN 'upcoming'
    WHEN NOW() BETWEEN start_date AND end_date THEN 'active'
    ELSE 'completed'
  END as calculated_status
FROM challenges
LIMIT 10;
```

---

## Production Testing Checklist

Before deploying to production:

- [ ] Run all curl tests with production API URL
- [ ] Verify rate limiting works (test with VPN to get different IPs)
- [ ] Test token expiration after 1 hour
- [ ] Test refresh token expiration after 365 days (mock clock)
- [ ] Verify CORS headers for iOS app domain
- [ ] Test with invalid/malformed tokens
- [ ] Test with expired tokens
- [ ] Test with blacklisted tokens
- [ ] Load test with 100+ concurrent requests
- [ ] Verify RLS policies block unauthorized access
- [ ] Test input sanitization with fuzzing tool
- [ ] Check Sentry for error logs
- [ ] Monitor response times (should be < 500ms p95)

---

**Last Updated:** 2025-10-12
**See Also:** BACKEND_API_IMPLEMENTATION_REPORT.md
