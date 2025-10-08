# FitCircle Analytics Events Catalog

Complete list of all Amplitude events being tracked in the FitCircle application.

## Quick Stats
- **Total Events:** 39
- **Categories:** 9
- **User Properties:** 8

---

## 1. AUTHENTICATION EVENTS (4 events)

### Sign Up Started
**When:** User begins registration process
**Page:** `/register`
**Trigger:** Form submission starts
**Properties:**
- `signup_method` (string): "email", "google", or "github"

### Sign Up Completed
**When:** User successfully creates account
**Page:** `/register`
**Trigger:** After successful registration, before redirect to onboarding
**Properties:**
- `signup_method` (string): "email"
- `user_name` (string): User's display name

**Special:** Also calls `setUserId(userId)`

### Login Started
**When:** User begins login process
**Page:** `/login`
**Trigger:** Login form submission starts
**Properties:** None

### Login Completed
**When:** User successfully logs in
**Page:** `/login`
**Trigger:** After successful authentication, before redirect to dashboard
**Properties:**
- `user_name` (string): User's display name

**Special:** Also calls `setUserId(userId)`

### Logout
**When:** User logs out
**Page:** Any (nav menu)
**Trigger:** Logout button clicked
**Properties:** None

**Special:** Also calls `amplitude.reset()` to clear user data

---

## 2. ONBOARDING EVENTS (5 events)

### Onboarding Started
**When:** User enters onboarding flow
**Page:** `/onboarding`
**Trigger:** Component mount (useEffect)
**Properties:** None

### Onboarding Step Completed
**When:** User completes each step in onboarding
**Page:** `/onboarding`
**Trigger:** "Next" button clicked
**Properties:**
- `step_number` (number): 1, 2, 3, etc.
- `step_name` (string): "Personal Info", "Goals", etc.

### Goal Set
**When:** User sets a fitness goal during onboarding
**Page:** `/onboarding`
**Trigger:** Goal configuration submitted
**Properties:**
- `goal_type` (string): "weight", "steps", or "workout"
- `goal_value` (number): Target value

### Onboarding Completed
**When:** User finishes entire onboarding process
**Page:** `/onboarding`
**Trigger:** Final "Finish" button clicked, before redirect to dashboard
**Properties:** None

---

## 3. DAILY CHECK-IN EVENTS (7 events)

### Check-in Started
**When:** User opens check-in form
**Page:** `/dashboard` or FitCircle check-in page
**Trigger:** Check-in tab selected or form opened
**Properties:**
- `source` (string): "dashboard", "fitcircle", or "quick_entry"

### Weight Logged
**When:** User submits weight data
**Page:** `/dashboard` or FitCircle check-in
**Trigger:** Check-in form submission (if weight included)
**Properties:**
- `weight_kg` (number): Weight value in kilograms
- `is_historical` (boolean): true if backdating, false if today
- `unit_system` (string): "metric" or "imperial"

### Steps Logged
**When:** User submits step count
**Page:** `/dashboard` or FitCircle check-in
**Trigger:** Check-in form submission (if steps included)
**Properties:**
- `steps` (number): Step count
- `is_historical` (boolean): true if backdating, false if today

### Mood Logged
**When:** User submits mood score
**Page:** `/dashboard`
**Trigger:** Check-in form submission (if mood included)
**Properties:**
- `mood_score` (number): 1-10 scale

### Energy Logged
**When:** User submits energy level
**Page:** `/dashboard`
**Trigger:** Check-in form submission (if energy included)
**Properties:**
- `energy_level` (number): 1-10 scale

### Check-in Completed
**When:** User successfully saves check-in
**Page:** `/dashboard` or FitCircle check-in
**Trigger:** After successful database save
**Properties:**
- `data_types` (array): ["weight", "steps", "mood", "energy"]
- `data_count` (number): Number of data types logged
- `is_historical` (boolean): true if backdating

### Check-in Failed
**When:** Check-in submission fails
**Page:** `/dashboard` or FitCircle check-in
**Trigger:** Database error or validation failure
**Properties:**
- `failure_reason` (string): Error message

---

## 4. FITCIRCLE MANAGEMENT EVENTS (9 events)

### FitCircle Creation Started
**When:** User opens create FitCircle modal
**Page:** `/fitcircles` or dashboard
**Trigger:** "Create FitCircle" button clicked
**Properties:** None

### FitCircle Created
**When:** User successfully creates a FitCircle
**Page:** Create FitCircle wizard
**Trigger:** After successful API response
**Properties:**
- `circle_id` (string): UUID of created circle
- `circle_name` (string): Name of the circle
- `challenge_type` (string): "weight_loss", "step_count", etc.
- `duration_days` (number): Length of challenge
- `visibility` (string): "public", "private", or "friends"

### FitCircle Join Started
**When:** User begins joining a FitCircle
**Page:** `/join/[code]` or browse page
**Trigger:** "Join" button clicked
**Properties:**
- `source` (string): "invite_link", "browse", or "code"

### FitCircle Joined
**When:** User successfully joins a FitCircle
**Page:** `/join/[code]`
**Trigger:** After successful database insert
**Properties:**
- `circle_id` (string): UUID of circle
- `circle_name` (string): Name of circle joined
- `challenge_type` (string): Type of challenge
- `goal_value` (number, optional): User's goal for this circle

### FitCircle Join Failed
**When:** Join attempt fails
**Page:** `/join/[code]`
**Trigger:** Database error or validation failure
**Properties:**
- `failure_reason` (string): Error message

### Invite Link Copied
**When:** User copies FitCircle invite link
**Page:** `/fitcircles/[id]` - Manage modal
**Trigger:** "Copy" button clicked in manage modal
**Properties:**
- `circle_id` (string): UUID of circle
- `circle_name` (string): Name of circle

### FitCircle Renamed
**When:** Creator renames a FitCircle
**Page:** `/fitcircles/[id]` - Manage modal
**Trigger:** "Save" button after editing name
**Properties:**
- `circle_id` (string): UUID of circle
- `old_name` (string): Previous name
- `new_name` (string): New name

### FitCircle Deleted
**When:** Creator deletes a FitCircle
**Page:** `/fitcircles/[id]` - Manage modal
**Trigger:** "Delete" button confirmed
**Properties:**
- `circle_id` (string): UUID of deleted circle
- `circle_name` (string): Name of deleted circle
- `participant_count` (number): How many members were in it

### Manage Modal Opened
**When:** User opens FitCircle management modal
**Page:** `/fitcircles/[id]`
**Trigger:** "Manage" button clicked
**Properties:**
- `circle_id` (string): UUID of circle being managed

---

## 5. SOCIAL/ENGAGEMENT EVENTS (4 events)

### Leaderboard Viewed
**When:** User views FitCircle leaderboard
**Page:** `/fitcircles/[id]`
**Trigger:** Page load (useEffect)
**Properties:**
- `circle_id` (string): UUID of circle
- `participant_count` (number): Number of participants

### Participant Profile Viewed
**When:** User clicks to view participant details
**Page:** `/fitcircles/[id]`
**Trigger:** Participant card clicked
**Properties:**
- `circle_id` (string): UUID of circle
- `viewed_user_id` (string): User ID of viewed participant
- `is_own_profile` (boolean): true if viewing own profile

### Progress Shared
**When:** User shares their progress
**Page:** Any (share button)
**Trigger:** Share action completed
**Properties:**
- `share_method` (string): "link" or "social"

---

## 6. GOAL MANAGEMENT EVENTS (4 events)

### Weight Goal Set
**When:** User sets or updates weight goal
**Page:** `/dashboard` or onboarding
**Trigger:** Goal form submission
**Properties:**
- `starting_weight_kg` (number): Starting weight
- `target_weight_kg` (number): Target weight
- `weight_to_lose_kg` (number): Calculated difference
- `timeframe_days` (number): Goal timeframe

### Steps Goal Set
**When:** User sets daily steps goal
**Page:** `/dashboard` - Steps card
**Trigger:** Goal update saved
**Properties:**
- `daily_steps_goal` (number): Target daily steps

### Goal Updated
**When:** User modifies existing goal
**Page:** `/dashboard`
**Trigger:** Goal edit saved
**Properties:**
- `goal_type` (string): "weight", "steps", or "workout"
- `old_value` (number): Previous goal value
- `new_value` (number): New goal value
- `change` (number): Difference (new - old)

---

## 7. NAVIGATION/PAGE VIEW EVENTS (5 events)

### Page Viewed
**When:** User navigates to any page (generic tracker)
**Page:** Any
**Trigger:** Route change
**Properties:**
- `page_name` (string): Name of page
- Additional custom properties per page

### Dashboard Viewed
**When:** User views dashboard
**Page:** `/dashboard`
**Trigger:** Page mount (useEffect)
**Properties:** None

### FitCircles Viewed
**When:** User views FitCircles list
**Page:** `/fitcircles`
**Trigger:** Page mount (useEffect)
**Properties:**
- `circle_count` (number): Number of circles user is in

### Profile Viewed
**When:** User views their profile
**Page:** `/profile`
**Trigger:** Page mount (useEffect)
**Properties:** None

---

## 8. SETTINGS EVENTS (3 events)

### Unit System Changed
**When:** User switches between metric/imperial
**Page:** Any (unit toggle component)
**Trigger:** Unit toggle clicked
**Properties:**
- `from_system` (string): "metric" or "imperial"
- `to_system` (string): "metric" or "imperial"

### Settings Viewed
**When:** User opens settings page
**Page:** `/settings`
**Trigger:** Page mount
**Properties:** None

### Notification Setting Changed
**When:** User updates notification preferences
**Page:** `/settings`
**Trigger:** Setting toggle changed
**Properties:**
- `setting_name` (string): Name of setting
- `enabled` (boolean): true or false

---

## 9. ERROR/FAILURE EVENTS (3 events)

### Error Occurred
**When:** Application error happens
**Page:** Any
**Trigger:** Error boundary or catch block
**Properties:**
- `error_type` (string): Category of error
- `error_message` (string): Error details
- Additional context properties

### Check-in Failed
**When:** Check-in submission fails
**Page:** `/dashboard` or FitCircle check-in
**Trigger:** Database error
**Properties:**
- `failure_reason` (string): Error message

### FitCircle Join Failed
**When:** Join attempt fails
**Page:** `/join/[code]`
**Trigger:** Database error or validation failure
**Properties:**
- `failure_reason` (string): Error message

---

## USER PROPERTIES (Updated Continuously)

These properties describe the user and are set/updated throughout their journey:

### Set at Login/Registration:
- `email` (string): User's email address
- `name` (string): User's display name

### Updated During Usage:
- `has_weight_goal` (boolean): Whether user has set weight goal
- `has_steps_goal` (boolean): Whether user has set steps goal
- `total_check_ins` (number): Lifetime check-in count
- `current_streak` (number): Current consecutive days
- `total_fitcircles` (number): Number of circles joined
- `unit_preference` (string): "metric" or "imperial"

**Set via:** `setUserProperties()` function
**When:** Dashboard load, goal updates, check-ins

---

## SPECIAL AMPLITUDE FUNCTIONS

### setUserId()
**When:** Login, Sign Up
**Purpose:** Identify user across sessions
**Value:** User's UUID from database

### setUserProperties()
**When:** Login, dashboard updates, goal changes
**Purpose:** Track user attributes and state
**Values:** See User Properties section above

### amplitude.reset()
**When:** Logout
**Purpose:** Clear user identity for privacy

---

## EVENT FLOW EXAMPLES

### New User Journey:
1. `Sign Up Started` → `Sign Up Completed`
2. `Onboarding Started`
3. `Onboarding Step Completed` (x3-4)
4. `Weight Goal Set` + `Steps Goal Set`
5. `Onboarding Completed`
6. `Dashboard Viewed`
7. `Check-in Started` → `Weight Logged` → `Steps Logged` → `Check-in Completed`

### Join FitCircle via Invite:
1. Page load → `Page Viewed` (join page)
2. `FitCircle Join Started` (source: "invite_link")
3. `Weight Goal Set` (circle-specific goal)
4. `FitCircle Joined`
5. `Leaderboard Viewed`

### Daily Active User:
1. `Login Completed`
2. `Dashboard Viewed`
3. `Check-in Started` → `Weight Logged` + `Steps Logged` → `Check-in Completed`
4. `FitCircles Viewed` (circle_count: X)
5. `Leaderboard Viewed`
6. `Participant Profile Viewed`

### Creator Creating Circle:
1. `FitCircle Creation Started`
2. `FitCircle Created`
3. `Manage Modal Opened`
4. `Invite Link Copied`

---

## IMPLEMENTATION STATUS

- [x] Events defined in `/lib/analytics.ts`
- [ ] Authentication events instrumented
- [ ] Onboarding events instrumented
- [ ] Check-in events instrumented
- [ ] FitCircle events instrumented
- [ ] Navigation events instrumented
- [ ] Settings events instrumented
- [ ] Error tracking instrumented
- [ ] User properties tracking instrumented

See `ANALYTICS_IMPLEMENTATION.md` for detailed instrumentation guide.

---

## TESTING

After instrumentation, test events in browser console:
```javascript
// View all tracked events
window.amplitude.track('Test Event', { test: true });

// Check current user ID
window.amplitude.getUserId();

// Check user properties
window.amplitude.getUserProperties();
```

Verify events appear in Amplitude dashboard within 5-10 minutes.
