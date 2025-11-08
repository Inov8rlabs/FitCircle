# Share URL Fix - Setup Instructions

## Problem
Share links were using `localhost:3000` URLs instead of production URLs, and invite codes were showing "expired code" errors when opened in incognito/unauthenticated mode.

## Solution Implemented

### 1. URL Generation Fix
Updated all components to use `NEXT_PUBLIC_APP_URL` environment variable instead of `window.location.origin`:

- ✅ `ShareFitCircleDialog.tsx` - Main share dialog
- ✅ `FitCircleCreator.tsx` - FitCircle creator component
- ✅ `CircleCreationWizard.tsx` - Circle creation wizard
- ✅ `InviteFriendsModal.tsx` - Invite friends modal
- ✅ `fitcircles/[id]/page.tsx` - FitCircle detail page
- ✅ `auth-store.ts` - Email redirect URL
- ✅ `email/templates.tsx` - Email templates

### 2. Database RLS Policy Fix
Created migration `015_fix_invite_code_access.sql` to allow users to view challenges via invite code.

**Key changes:**
- Allows authenticated users to view any challenge (validation happens in app layer)
- Allows anonymous users to view challenges with invite codes
- Fixes the "expired code" error for unauthenticated users

### 3. Join Page Enhancement
Updated `/join/[code]/page.tsx` to validate invite codes even for unauthenticated users, providing a better preview experience.

## Required Actions

### Step 1: Run Database Migration
Run the migration in your Supabase SQL Editor:

```bash
# Migration file: /supabase/migrations/015_fix_invite_code_access.sql
```

Or copy and paste this SQL:

```sql
-- Drop the existing SELECT policy for challenges
DROP POLICY IF EXISTS "Users can view public challenges" ON challenges;

-- Recreate with invite code access
CREATE POLICY "Users can view accessible challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id
      AND user_id = auth.uid()
    )
    OR invite_code IS NOT NULL
  );

-- Add policy for anonymous users
CREATE POLICY "Anonymous users can view challenges with invite codes"
  ON challenges FOR SELECT
  TO anon
  USING (invite_code IS NOT NULL);

-- Grant SELECT permission to anonymous users
GRANT SELECT ON challenges TO anon;
```

### Step 2: Set Environment Variables in Vercel

In your Vercel project settings, add/update the following environment variables:

**Production Environment:**
```
NEXT_PUBLIC_APP_URL=https://www.fitcircle.ai
NEXT_PUBLIC_API_URL=https://www.fitcircle.ai/api
```

**Preview Environment (optional):**
```
NEXT_PUBLIC_APP_URL=https://your-preview-url.vercel.app
NEXT_PUBLIC_API_URL=https://your-preview-url.vercel.app/api
```

**Development Environment:**
```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### Step 3: Update Local .env.local (Already Done)
Your local `.env.local` has been updated to use production URLs by default:

```
NEXT_PUBLIC_APP_URL=https://www.fitcircle.ai
NEXT_PUBLIC_API_URL=https://www.fitcircle.ai/api
```

**Note:** For local development, you may want to temporarily change this back to `http://localhost:3000` if you need to test locally.

### Step 4: Deploy to Vercel
After setting the environment variables in Vercel:

```bash
# Commit your changes (when ready)
git add .
git commit -m "Fix share URLs to use production domain"
git push origin main
```

## Testing

### Test Share Links
1. Create a FitCircle
2. Click "Share" button
3. Copy the invite link
4. Verify the URL shows `https://www.fitcircle.ai/join/...` instead of `http://localhost:3000/join/...`

### Test Invite Code Access
1. Open an invite link in incognito mode (unauthenticated)
2. Verify you can see the challenge details
3. Verify you don't get "expired code" error
4. Sign up or log in
5. Verify you can join the challenge

### Test Email Invites
1. Send an email invite to yourself
2. Check that the email contains the production URL
3. Click the link from the email
4. Verify it opens correctly

## Rollback Instructions

If you need to rollback the database migration:

```sql
-- Remove the new policies
DROP POLICY IF EXISTS "Users can view accessible challenges" ON challenges;
DROP POLICY IF EXISTS "Anonymous users can view challenges with invite codes" ON challenges;

-- Recreate the original policy
CREATE POLICY "Users can view public challenges"
  ON challenges FOR SELECT
  TO authenticated
  USING (
    visibility = 'public'
    OR auth.uid() = creator_id
    OR EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id
      AND user_id = auth.uid()
    )
  );

-- Revoke anonymous access
REVOKE SELECT ON challenges FROM anon;
```

## Additional Notes

- All share functionality now uses the environment variable as the primary source
- Falls back to `window.location.origin` if the environment variable is not set
- Email templates also respect the `NEXT_PUBLIC_APP_URL` environment variable
- Tests continue to work by falling back to `window.location.origin`

---

**Status:** ✅ Code changes complete, awaiting database migration and environment variable configuration
**Date:** 2025-10-08
