# Phase 2: Notification Infrastructure - Backend Development Specification

**Version:** 1.0
**Created:** October 27, 2025
**Status:** Ready for Implementation
**Estimated Effort:** 4 weeks (160 hours)

---

## Document Purpose

This document provides actionable technical specifications for implementing Phase 2 notification infrastructure as defined in [`PRD-ENGAGEMENT-V2.md`](./PRD-ENGAGEMENT-V2.md). It focuses on backend implementation details for push notifications (iOS/Android), email notifications, and user preference management.

**Key Objectives:**
- 75%+ notification opt-in rate
- 25%+ notification-driven app return rate
- 30%+ email open rate (weekly digest), 40%+ (streak at risk)
- <10% notification opt-out rate within 30 days

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Service Layer Architecture](#2-service-layer-architecture)
3. [API Endpoints](#3-api-endpoints)
4. [Cron Jobs](#4-cron-jobs)
5. [External Integrations](#5-external-integrations)
6. [Notification Content Templates](#6-notification-content-templates)
7. [Testing Strategy](#7-testing-strategy)
8. [Deployment Checklist](#8-deployment-checklist)
9. [Estimated Effort](#9-estimated-effort)

---

## 1. Database Schema

### 1.1 New Tables

#### `user_push_tokens`
Stores device tokens for APNs (iOS) and FCM (Android).

```sql
CREATE TABLE user_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_tokens_user ON user_push_tokens(user_id, active);
CREATE INDEX idx_push_tokens_device ON user_push_tokens(device_token) WHERE active = TRUE;
```

**Key Fields:**
- `device_token`: APNs/FCM device token (unique)
- `platform`: 'ios' or 'android'
- `active`: FALSE if token invalidated by APNs/FCM
- `last_used`: Updated on successful notification send

---

#### `notification_preferences`
Stores user notification preferences with granular controls.

```sql
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

    -- Channel toggles
    push_enabled BOOLEAN DEFAULT TRUE,
    email_enabled BOOLEAN DEFAULT TRUE,
    inapp_enabled BOOLEAN DEFAULT TRUE,

    -- Push notification types
    push_daily_checkin BOOLEAN DEFAULT TRUE,
    push_streak_risk BOOLEAN DEFAULT TRUE,
    push_weekly_goal BOOLEAN DEFAULT TRUE,
    push_data_submission BOOLEAN DEFAULT TRUE,
    push_leaderboard_change BOOLEAN DEFAULT TRUE,
    push_social_engagement BOOLEAN DEFAULT TRUE,
    push_weekly_digest BOOLEAN DEFAULT TRUE,
    push_challenge_milestone BOOLEAN DEFAULT TRUE,

    -- Email notification types
    email_daily_checkin BOOLEAN DEFAULT TRUE,
    email_streak_risk BOOLEAN DEFAULT TRUE,
    email_weekly_digest BOOLEAN DEFAULT TRUE,
    email_monthly_report BOOLEAN DEFAULT TRUE,
    email_fitcircle_invite BOOLEAN DEFAULT TRUE,
    email_challenge_milestone BOOLEAN DEFAULT TRUE,

    -- Timing preferences
    daily_reminder_time TIME DEFAULT '20:00:00',
    dnd_start TIME DEFAULT '22:00:00',
    dnd_end TIME DEFAULT '07:00:00',
    pause_weekends BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);
```

**Key Fields:**
- `push_*`: Individual toggles for push notification types
- `email_*`: Individual toggles for email types
- `daily_reminder_time`: User's preferred reminder time (default 8 PM)
- `dnd_start/dnd_end`: Do Not Disturb window (no notifications sent)
- `pause_weekends`: Disable non-critical notifications on Sat/Sun

---

#### `notification_logs`
Tracks all sent notifications for analytics and debugging.

```sql
CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('push', 'email', 'inapp')),

    -- Delivery tracking
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ,
    opened BOOLEAN DEFAULT FALSE,
    opened_at TIMESTAMPTZ,
    clicked BOOLEAN DEFAULT FALSE,
    clicked_at TIMESTAMPTZ,

    -- Content & metadata
    payload JSONB,
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_logs_user_type ON notification_logs(user_id, notification_type, sent_at DESC);
CREATE INDEX idx_notification_logs_sent_at ON notification_logs(sent_at DESC);
CREATE INDEX idx_notification_logs_opened ON notification_logs(user_id, opened) WHERE opened = TRUE;
```

**Key Fields:**
- `notification_type`: E.g., 'daily_checkin', 'streak_risk', 'weekly_digest'
- `channel`: 'push', 'email', or 'inapp'
- `delivered/opened/clicked`: Tracking fields for analytics
- `payload`: Full notification content (JSON)
- `error_message`: For failed deliveries

---

#### `email_preferences`
Email-specific preferences (separated for clarity).

```sql
CREATE TABLE email_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

    -- Email types
    daily_checkin_reminder BOOLEAN DEFAULT TRUE,
    streak_at_risk BOOLEAN DEFAULT TRUE,
    weekly_digest BOOLEAN DEFAULT TRUE,
    monthly_report BOOLEAN DEFAULT TRUE,
    fitcircle_invites BOOLEAN DEFAULT TRUE,
    challenge_milestones BOOLEAN DEFAULT TRUE,

    -- Unsubscribe tracking
    unsubscribe_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
    unsubscribed_all BOOLEAN DEFAULT FALSE,
    unsubscribed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_prefs_user ON email_preferences(user_id);
CREATE INDEX idx_email_prefs_token ON email_preferences(unsubscribe_token);
```

**Key Fields:**
- `unsubscribe_token`: Unique token for one-click unsubscribe links
- `unsubscribed_all`: If TRUE, no emails sent (except transactional)

---

#### `email_logs`
Tracks email delivery status.

```sql
CREATE TABLE email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email_type TEXT NOT NULL,

    -- Delivery tracking
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered BOOLEAN DEFAULT FALSE,
    opened BOOLEAN DEFAULT FALSE,
    clicked BOOLEAN DEFAULT FALSE,
    bounced BOOLEAN DEFAULT FALSE,

    -- Resend metadata
    resend_email_id TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_logs_user ON email_logs(user_id, sent_at DESC);
CREATE INDEX idx_email_logs_type ON email_logs(email_type, sent_at DESC);
```

**Key Fields:**
- `resend_email_id`: Resend API email ID for tracking
- `bounced`: Email bounce detection

---

### 1.2 RLS Policies

```sql
-- user_push_tokens
ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own push tokens"
    ON user_push_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
    ON user_push_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens"
    ON user_push_tokens FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
    ON user_push_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- notification_preferences
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification preferences"
    ON notification_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
    ON notification_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
    ON notification_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- notification_logs (read-only for users)
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification logs"
    ON notification_logs FOR SELECT
    USING (auth.uid() = user_id);

-- email_preferences
ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own email preferences"
    ON email_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own email preferences"
    ON email_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- email_logs (read-only for users)
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own email logs"
    ON email_logs FOR SELECT
    USING (auth.uid() = user_id);
```

---

### 1.3 Triggers

```sql
-- Updated_at triggers
CREATE TRIGGER update_user_push_tokens_timestamp
    BEFORE UPDATE ON user_push_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notification_preferences_timestamp
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_email_preferences_timestamp
    BEFORE UPDATE ON email_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
```

---

## 2. Service Layer Architecture

All business logic resides in TypeScript services (`/apps/web/app/lib/services/`).

### 2.1 NotificationService

**File:** `/apps/web/app/lib/services/notification-service.ts`

```typescript
export class NotificationService {

  /**
   * Registers a device token for push notifications
   * @param userId - User UUID
   * @param deviceToken - APNs/FCM token
   * @param platform - 'ios' or 'android'
   */
  static async registerDeviceToken(
    userId: string,
    deviceToken: string,
    platform: 'ios' | 'android'
  ): Promise<void>;

  /**
   * Sends a push notification to a user
   * @param userId - Target user UUID
   * @param notificationType - E.g., 'daily_checkin'
   * @param payload - Notification content
   * @returns Success status
   */
  static async sendPushNotification(
    userId: string,
    notificationType: string,
    payload: NotificationPayload
  ): Promise<boolean>;

  /**
   * Checks if user should receive notification based on preferences
   * @param userId - User UUID
   * @param notificationType - Notification type
   * @param channel - 'push' or 'email'
   * @returns true if notification should be sent
   */
  static async shouldSendNotification(
    userId: string,
    notificationType: string,
    channel: 'push' | 'email'
  ): Promise<boolean>;

  /**
   * Checks if current time is within user's DND window
   * @param userId - User UUID
   * @returns true if in DND window
   */
  static async isInDNDWindow(userId: string): Promise<boolean>;

  /**
   * Enforces frequency caps (max 3 push/day)
   * @param userId - User UUID
   * @param channel - 'push' or 'email'
   * @returns true if under frequency cap
   */
  static async checkFrequencyCap(
    userId: string,
    channel: 'push' | 'email'
  ): Promise<boolean>;

  /**
   * Logs notification send attempt
   * @param userId - User UUID
   * @param notificationType - Type
   * @param channel - Channel
   * @param success - Delivery success
   * @param payload - Content
   */
  static async logNotification(
    userId: string,
    notificationType: string,
    channel: 'push' | 'email',
    success: boolean,
    payload: any,
    errorMessage?: string
  ): Promise<void>;

  /**
   * Marks device token as inactive (after APNs/FCM error)
   * @param deviceToken - Token to invalidate
   */
  static async invalidateDeviceToken(deviceToken: string): Promise<void>;

  /**
   * Gets user's notification history
   * @param userId - User UUID
   * @param limit - Number of records (default 30)
   * @returns Notification logs
   */
  static async getNotificationHistory(
    userId: string,
    limit: number
  ): Promise<NotificationLog[]>;
}
```

---

### 2.2 PushNotificationService

**File:** `/apps/web/app/lib/services/push-notification-service.ts`

```typescript
export class PushNotificationService {

  /**
   * Sends APNs push notification (iOS)
   * @param deviceToken - APNs device token
   * @param payload - Notification content
   * @returns Success status
   */
  static async sendAPNs(
    deviceToken: string,
    payload: APNsPayload
  ): Promise<boolean>;

  /**
   * Sends FCM push notification (Android)
   * @param deviceToken - FCM device token
   * @param payload - Notification content
   * @returns Success status
   */
  static async sendFCM(
    deviceToken: string,
    payload: FCMPayload
  ): Promise<boolean>;

  /**
   * Formats notification for APNs
   * @param type - Notification type
   * @param data - User-specific data
   * @returns APNs-formatted payload
   */
  static formatAPNsPayload(
    type: string,
    data: NotificationData
  ): APNsPayload;

  /**
   * Formats notification for FCM
   * @param type - Notification type
   * @param data - User-specific data
   * @returns FCM-formatted payload
   */
  static formatFCMPayload(
    type: string,
    data: NotificationData
  ): FCMPayload;

  /**
   * Handles APNs/FCM delivery errors
   * @param deviceToken - Failed token
   * @param error - Error message
   */
  static async handleDeliveryError(
    deviceToken: string,
    error: string
  ): Promise<void>;
}
```

---

### 2.3 EmailNotificationService

**File:** `/apps/web/app/lib/services/email-notification-service.ts`

```typescript
export class EmailNotificationService {

  /**
   * Sends email via Resend API
   * @param userId - User UUID
   * @param emailType - Email type
   * @param templateData - Dynamic content
   * @returns Success status
   */
  static async sendEmail(
    userId: string,
    emailType: string,
    templateData: EmailTemplateData
  ): Promise<boolean>;

  /**
   * Sends daily check-in reminder email
   * @param userId - User UUID
   * @param streakCount - Current streak
   */
  static async sendDailyCheckinReminder(
    userId: string,
    streakCount: number
  ): Promise<void>;

  /**
   * Sends streak at risk email
   * @param userId - User UUID
   * @param streakCount - Streak about to be lost
   * @param hasFreeze - User has freeze available
   */
  static async sendStreakAtRiskEmail(
    userId: string,
    streakCount: number,
    hasFreeze: boolean
  ): Promise<void>;

  /**
   * Sends weekly digest email
   * @param userId - User UUID
   * @param weekData - Week summary data
   */
  static async sendWeeklyDigest(
    userId: string,
    weekData: WeeklyDigestData
  ): Promise<void>;

  /**
   * Sends monthly progress report
   * @param userId - User UUID
   * @param monthData - Month summary data
   */
  static async sendMonthlyReport(
    userId: string,
    monthData: MonthlyReportData
  ): Promise<void>;

  /**
   * Sends welcome email to new users
   * @param userId - User UUID
   * @param userName - User's name
   */
  static async sendWelcomeEmail(
    userId: string,
    userName: string
  ): Promise<void>;

  /**
   * Handles email unsubscribe via one-click link
   * @param unsubscribeToken - Unique token from URL
   * @returns Success status
   */
  static async handleUnsubscribe(
    unsubscribeToken: string
  ): Promise<boolean>;

  /**
   * Gets user's email address from profile
   * @param userId - User UUID
   * @returns Email address
   */
  static async getUserEmail(userId: string): Promise<string | null>;

  /**
   * Logs email send attempt
   * @param userId - User UUID
   * @param emailType - Email type
   * @param resendEmailId - Resend API email ID
   * @param success - Delivery success
   */
  static async logEmail(
    userId: string,
    emailType: string,
    resendEmailId: string,
    success: boolean
  ): Promise<void>;
}
```

---

### 2.4 NotificationPreferenceService

**File:** `/apps/web/app/lib/services/notification-preference-service.ts`

```typescript
export class NotificationPreferenceService {

  /**
   * Gets user's notification preferences
   * @param userId - User UUID
   * @returns Preferences object
   */
  static async getPreferences(userId: string): Promise<NotificationPreferences | null>;

  /**
   * Updates user's notification preferences
   * @param userId - User UUID
   * @param updates - Partial preference updates
   * @returns Updated preferences
   */
  static async updatePreferences(
    userId: string,
    updates: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences>;

  /**
   * Creates default preferences for new user
   * @param userId - User UUID
   * @returns Created preferences
   */
  static async createDefaultPreferences(userId: string): Promise<NotificationPreferences>;

  /**
   * Gets user's email preferences
   * @param userId - User UUID
   * @returns Email preferences
   */
  static async getEmailPreferences(userId: string): Promise<EmailPreferences | null>;

  /**
   * Updates user's email preferences
   * @param userId - User UUID
   * @param updates - Partial preference updates
   * @returns Updated preferences
   */
  static async updateEmailPreferences(
    userId: string,
    updates: Partial<EmailPreferences>
  ): Promise<EmailPreferences>;

  /**
   * Creates default email preferences for new user
   * @param userId - User UUID
   * @returns Created preferences
   */
  static async createDefaultEmailPreferences(userId: string): Promise<EmailPreferences>;
}
```

---

### 2.5 NotificationSchedulerService

**File:** `/apps/web/app/lib/services/notification-scheduler-service.ts`

```typescript
export class NotificationSchedulerService {

  /**
   * Schedules daily check-in reminders for users
   * Runs hourly (8-9 PM all timezones)
   * @param currentHour - Current UTC hour
   */
  static async scheduleDailyCheckinReminders(currentHour: number): Promise<void>;

  /**
   * Schedules streak at risk notifications
   * Runs daily at 9 AM all timezones
   * @param currentHour - Current UTC hour
   */
  static async scheduleStreakAtRiskNotifications(currentHour: number): Promise<void>;

  /**
   * Schedules weekly digest emails
   * Runs Sundays at 8 PM all timezones
   */
  static async scheduleWeeklyDigests(): Promise<void>;

  /**
   * Gets list of users needing notification for current hour
   * @param notificationType - Type of notification
   * @param targetHour - Target hour in user's timezone
   * @returns List of user IDs
   */
  static async getUsersForTimeWindow(
    notificationType: string,
    targetHour: number
  ): Promise<string[]>;

  /**
   * Calculates user's timezone offset from UTC
   * @param userId - User UUID
   * @returns UTC offset in hours
   */
  static async getUserTimezoneOffset(userId: string): Promise<number>;
}
```

---

## 3. API Endpoints

### 3.1 Push Notification Endpoints

#### `POST /api/notifications/register`
Register device token for push notifications.

**Request:**
```json
{
  "deviceToken": "apns_token_xyz",
  "platform": "ios"
}
```

**Response:**
```json
{
  "success": true,
  "tokenId": "uuid"
}
```

**Implementation:**
```typescript
// /apps/web/app/api/notifications/register/route.ts
export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser(request);
  const { deviceToken, platform } = await request.json();

  await NotificationService.registerDeviceToken(user.id, deviceToken, platform);

  return NextResponse.json({ success: true });
}
```

---

#### `POST /api/notifications/send` (Internal Only)
Send push notification to user. Protected by service role.

**Request:**
```json
{
  "userId": "uuid",
  "notificationType": "daily_checkin",
  "payload": {
    "title": "Complete your check-in",
    "body": "Keep your 14-day streak alive!",
    "data": {
      "deep_link": "fitcircle://checkin"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "delivered": true
}
```

---

#### `PUT /api/notifications/preferences`
Update user's notification preferences.

**Request:**
```json
{
  "push_enabled": true,
  "push_daily_checkin": true,
  "push_streak_risk": true,
  "daily_reminder_time": "20:00:00",
  "dnd_start": "22:00:00",
  "dnd_end": "07:00:00",
  "pause_weekends": false
}
```

**Response:**
```json
{
  "success": true,
  "preferences": { /* updated preferences */ }
}
```

---

#### `GET /api/notifications/preferences`
Get user's notification preferences.

**Response:**
```json
{
  "push_enabled": true,
  "email_enabled": true,
  "push_daily_checkin": true,
  "push_streak_risk": true,
  "daily_reminder_time": "20:00:00",
  "dnd_start": "22:00:00",
  "dnd_end": "07:00:00",
  "pause_weekends": false
}
```

---

#### `GET /api/notifications/history?limit=30`
Get user's notification history.

**Response:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "notification_type": "daily_checkin",
      "channel": "push",
      "sent_at": "2025-10-27T20:00:00Z",
      "delivered": true,
      "opened": false
    }
  ],
  "total": 30
}
```

---

### 3.2 Email Notification Endpoints

#### `POST /api/emails/send` (Internal Only)
Send email notification. Protected by service role.

**Request:**
```json
{
  "userId": "uuid",
  "emailType": "weekly_digest",
  "templateData": {
    "userName": "John",
    "weekStats": { /* ... */ }
  }
}
```

**Response:**
```json
{
  "success": true,
  "emailId": "resend_email_id"
}
```

---

#### `PUT /api/emails/preferences`
Update user's email preferences.

**Request:**
```json
{
  "weekly_digest": true,
  "streak_at_risk": true,
  "daily_checkin_reminder": false
}
```

**Response:**
```json
{
  "success": true,
  "preferences": { /* updated preferences */ }
}
```

---

#### `GET /api/emails/unsubscribe?token={token}`
One-click email unsubscribe.

**Response:**
```html
<!-- HTML page confirming unsubscribe -->
<html>
  <body>
    <h1>You've been unsubscribed</h1>
    <p>You will no longer receive emails from FitCircle.</p>
  </body>
</html>
```

**Implementation:**
```typescript
// /apps/web/app/api/emails/unsubscribe/route.ts
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  const success = await EmailNotificationService.handleUnsubscribe(token);

  if (success) {
    return new NextResponse(/* HTML success page */);
  } else {
    return new NextResponse(/* HTML error page */, { status: 400 });
  }
}
```

---

## 4. Cron Jobs

All cron jobs are API endpoints protected by `CRON_SECRET` header.

### 4.1 Daily Check-in Reminder

**Endpoint:** `/api/cron/notifications/daily-checkin`
**Schedule:** Every hour (8-9 PM all timezones)
**Vercel Config:**
```json
{
  "crons": [{
    "path": "/api/cron/notifications/daily-checkin",
    "schedule": "0 * * * *"
  }]
}
```

**Logic:**
1. Get current UTC hour
2. Query users with timezone matching "8 PM current hour"
3. Check if user completed check-in today
4. Check notification preferences (push/email enabled)
5. Check frequency cap (max 3/day)
6. Check DND window
7. Send notification if all checks pass

**Implementation:**
```typescript
// /apps/web/app/api/cron/notifications/daily-checkin/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentHour = new Date().getUTCHours();

  await NotificationSchedulerService.scheduleDailyCheckinReminders(currentHour);

  return NextResponse.json({ success: true });
}
```

---

### 4.2 Streak At Risk Notification

**Endpoint:** `/api/cron/notifications/streak-risk`
**Schedule:** Daily at 9 AM all timezones
**Vercel Config:**
```json
{
  "crons": [{
    "path": "/api/cron/notifications/streak-risk",
    "schedule": "0 * * * *"
  }]
}
```

**Logic:**
1. Get current UTC hour
2. Query users with timezone matching "9 AM current hour"
3. Check if user missed yesterday's check-in
4. Check if user has freeze available
5. Send notification if streak at risk

---

### 4.3 Weekly Digest Email

**Endpoint:** `/api/cron/emails/weekly-digest`
**Schedule:** Sundays at 8 PM all timezones
**Vercel Config:**
```json
{
  "crons": [{
    "path": "/api/cron/emails/weekly-digest",
    "schedule": "0 * * * 0"
  }]
}
```

**Logic:**
1. Check if today is Sunday
2. Get current UTC hour
3. Query users with timezone matching "8 PM current hour"
4. Calculate week stats (steps, weight, streak, leaderboard position)
5. Send weekly digest email

---

### 4.4 Monthly Progress Report

**Endpoint:** `/api/cron/emails/monthly-report`
**Schedule:** 1st of month at 9 AM all timezones
**Vercel Config:**
```json
{
  "crons": [{
    "path": "/api/cron/emails/monthly-report",
    "schedule": "0 * 1 * *"
  }]
}
```

**Logic:**
1. Check if today is 1st of month
2. Get current UTC hour
3. Query users with timezone matching "9 AM current hour"
4. Calculate month stats
5. Send monthly report email

---

### 4.5 Leaderboard Position Change

**Endpoint:** `/api/cron/notifications/leaderboard-changes`
**Schedule:** Every 5 minutes (6 AM - 11 PM)
**Vercel Config:**
```json
{
  "crons": [{
    "path": "/api/cron/notifications/leaderboard-changes",
    "schedule": "*/5 * * * *"
  }]
}
```

**Logic:**
1. Query all active FitCircles
2. For each FitCircle, check if any user's rank changed ±3 positions
3. Check if user has `push_leaderboard_change` enabled
4. Throttle to max 1 notification per hour per user
5. Send push notification

---

## 5. External Integrations

### 5.1 Apple Push Notification Service (APNs)

**Setup Steps:**

1. **Create APNs Key in Apple Developer Account**
   - Go to https://developer.apple.com/account/resources/authkeys/list
   - Click "+" to create new key
   - Select "Apple Push Notifications service (APNs)"
   - Download `.p8` key file
   - Save Key ID and Team ID

2. **Store APNs Credentials in Environment Variables**
   ```bash
   APNS_KEY_ID=ABC123XYZ
   APNS_TEAM_ID=DEF456UVW
   APNS_KEY_FILE=path/to/AuthKey_ABC123XYZ.p8
   # Or inline key:
   APNS_KEY=-----BEGIN PRIVATE KEY-----\nMIGT...
   ```

3. **Install APNs Library**
   ```bash
   npm install apn
   ```

4. **Implementation Example**
   ```typescript
   import apn from 'apn';

   const provider = new apn.Provider({
     token: {
       key: process.env.APNS_KEY || fs.readFileSync(process.env.APNS_KEY_FILE),
       keyId: process.env.APNS_KEY_ID,
       teamId: process.env.APNS_TEAM_ID
     },
     production: process.env.NODE_ENV === 'production'
   });

   const notification = new apn.Notification({
     alert: {
       title: 'Daily Check-in Reminder',
       body: 'Complete your check-in to keep your 14-day streak alive!'
     },
     topic: 'com.fitcircle.app',
     sound: 'default',
     badge: 1,
     payload: {
       type: 'daily_checkin',
       deep_link: 'fitcircle://checkin'
     }
   });

   const result = await provider.send(notification, deviceToken);
   ```

**Error Handling:**
- `BadDeviceToken`: Mark token as inactive in DB
- `Unregistered`: Remove token from DB
- `PayloadTooLarge`: Truncate notification content
- `InternalServerError`: Retry with exponential backoff

---

### 5.2 Firebase Cloud Messaging (FCM)

**Setup Steps:**

1. **Create Firebase Project**
   - Go to https://console.firebase.google.com/
   - Create new project
   - Add Android app (package name: `com.fitcircle.app`)

2. **Get FCM Server Key**
   - Go to Project Settings > Cloud Messaging
   - Copy "Server key"
   - Store in environment variable:
   ```bash
   FCM_SERVER_KEY=AAAA...xyz
   ```

3. **Install FCM Library**
   ```bash
   npm install firebase-admin
   ```

4. **Implementation Example**
   ```typescript
   import admin from 'firebase-admin';

   admin.initializeApp({
     credential: admin.credential.cert({
       projectId: process.env.FIREBASE_PROJECT_ID,
       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
       privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
     })
   });

   const message = {
     notification: {
       title: 'Daily Check-in Reminder',
       body: 'Complete your check-in to keep your 14-day streak alive!'
     },
     data: {
       type: 'daily_checkin',
       deep_link: 'fitcircle://checkin'
     },
     android: {
       priority: 'high'
     },
     token: deviceToken
   };

   const result = await admin.messaging().send(message);
   ```

**Error Handling:**
- `messaging/invalid-registration-token`: Mark token as inactive
- `messaging/registration-token-not-registered`: Remove token
- `messaging/payload-size-limit-exceeded`: Truncate content

---

### 5.3 Resend Email Service

**Setup Steps:**

1. **Create Resend Account**
   - Go to https://resend.com/
   - Sign up and verify email
   - Get API key from dashboard

2. **Configure Domain**
   - Add custom domain (e.g., fitcircle.com)
   - Add DNS records (DKIM, SPF, DMARC)
   - Verify domain

3. **Store API Key**
   ```bash
   RESEND_API_KEY=re_abc123xyz
   ```

4. **Install Resend Library**
   ```bash
   npm install resend
   npm install react-email @react-email/components
   ```

5. **Create Email Templates**
   ```typescript
   // /apps/web/emails/daily-checkin-reminder.tsx
   import { Html, Head, Body, Container, Text, Button } from '@react-email/components';

   export default function DailyCheckinReminder({ userName, streakCount }) {
     return (
       <Html>
         <Head />
         <Body>
           <Container>
             <Text>Hi {userName},</Text>
             <Text>Complete your check-in to keep your {streakCount}-day streak alive!</Text>
             <Button href="https://fitcircle.com/checkin">Complete Check-in</Button>
           </Container>
         </Body>
       </Html>
     );
   }
   ```

6. **Implementation Example**
   ```typescript
   import { Resend } from 'resend';
   import DailyCheckinReminder from '@/emails/daily-checkin-reminder';

   const resend = new Resend(process.env.RESEND_API_KEY);

   const { data, error } = await resend.emails.send({
     from: 'FitCircle <noreply@fitcircle.com>',
     to: userEmail,
     subject: 'Complete your check-in',
     react: DailyCheckinReminder({ userName, streakCount }),
     headers: {
       'List-Unsubscribe': `<https://fitcircle.com/api/emails/unsubscribe?token=${unsubscribeToken}>`
     }
   });
   ```

**Error Handling:**
- Email bounce: Mark email as bounced in `email_logs`
- Rate limit: Queue emails and retry
- Invalid email: Log error, skip user

---

## 6. Notification Content Templates

### 6.1 Push Notification Templates

#### Daily Check-in Reminder
```typescript
{
  title: "⏰ Daily Check-in",
  body: "Complete your check-in to keep your {streakCount}-day streak alive!",
  data: {
    type: "daily_checkin",
    deep_link: "fitcircle://checkin",
    streak_count: 14
  }
}
```

#### Streak At Risk
```typescript
{
  title: "🔥 Streak at Risk",
  body: "You're 1 day away from losing your {streakCount}-day streak. Use your freeze?",
  data: {
    type: "streak_risk",
    deep_link: "fitcircle://streaks",
    streak_count: 21,
    has_freeze: true
  }
}
```

#### Weekly Goal Progress
```typescript
{
  title: "📊 Halfway There!",
  body: "You're halfway through the week but only at {progress}% of your step goal. You've got this!",
  data: {
    type: "weekly_goal",
    deep_link: "fitcircle://goals/weekly",
    progress: 35
  }
}
```

#### FitCircle Data Submission
```typescript
{
  title: "🏃 Submit Today's Steps",
  body: "Submit your {steps} steps to your FitCircles before midnight!",
  data: {
    type: "data_submission",
    deep_link: "fitcircle://submit",
    steps: 8234
  }
}
```

#### Leaderboard Position Change
```typescript
{
  title: "📈 You Moved Up!",
  body: "You moved up to #{rank} in '{circleName}'! Can you reach #{nextRank}?",
  data: {
    type: "leaderboard_change",
    deep_link: "fitcircle://circles/{circleId}/leaderboard",
    rank: 3,
    next_rank: 2,
    circle_name: "Work Warriors"
  }
}
```

#### Social Engagement
```typescript
{
  title: "💪 {senderName} Encouraged You!",
  body: "{message}",
  data: {
    type: "social_engagement",
    deep_link: "fitcircle://activity",
    sender_id: "uuid",
    message: "Amazing progress!"
  }
}
```

#### Weekly Digest
```typescript
{
  title: "📅 Your Week in Review",
  body: "{steps} steps, {streakDays}-day streak, #{rank} in {circleName}",
  data: {
    type: "weekly_digest",
    deep_link: "fitcircle://dashboard",
    steps: 52341,
    streak_days: 7,
    rank: 2,
    circle_name: "Work Warriors"
  }
}
```

#### Challenge Milestone
```typescript
{
  title: "🎉 Halfway There!",
  body: "You're 50% to your weight loss goal. Keep crushing it!",
  data: {
    type: "challenge_milestone",
    deep_link: "fitcircle://circles/{circleId}",
    milestone: 50,
    circle_id: "uuid"
  }
}
```

---

### 6.2 Email Templates

#### Welcome Email
**Subject:** Welcome to FitCircle! Let's get started 🎉

**Template:** `/apps/web/emails/welcome.tsx`
```typescript
import { Html, Head, Body, Container, Text, Button, Heading } from '@react-email/components';

export default function WelcomeEmail({ userName }: { userName: string }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'Arial, sans-serif' }}>
        <Container style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
          <Heading>Welcome to FitCircle, {userName}! 🎉</Heading>
          <Text>You're now part of FitCircle—where fitness meets fun and accountability!</Text>
          <Text><strong>Here's what to do next:</strong></Text>
          <Text>✅ Complete your first daily check-in</Text>
          <Text>✅ Join or create your first FitCircle</Text>
          <Text>✅ Set your daily and weekly goals</Text>
          <Button href="https://fitcircle.com/checkin" style={{ backgroundColor: '#8b5cf6', color: '#fff', padding: '12px 24px', borderRadius: '6px' }}>
            Complete Check-in
          </Button>
          <Text>See you inside!</Text>
          <Text>—The FitCircle Team</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

---

#### Weekly Digest Email
**Subject:** Your Week in Review: {steps} steps, {streakDays}-day streak 🔥

**Template:** `/apps/web/emails/weekly-digest.tsx`
```typescript
export default function WeeklyDigest({
  userName,
  steps,
  streakDays,
  weightChange,
  leaderboardRank,
  circleName
}: WeeklyDigestProps) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>Hi {userName},</Heading>
          <Text>Here's how your week went:</Text>

          <Heading as="h2">📊 This Week's Stats:</Heading>
          <Text>• Steps: {steps} (104% of goal)</Text>
          <Text>• Streak: {streakDays} days maintained</Text>
          <Text>• Weight: {weightChange} lbs</Text>
          <Text>• Leaderboard: #{leaderboardRank} in "{circleName}"</Text>

          <Heading as="h2">🏆 Top Achievement:</Heading>
          <Text>You hit your daily goal 6 out of 7 days—your best week yet!</Text>

          <Heading as="h2">📈 Next Week's Challenge:</Heading>
          <Text>Your weekly step goal is increasing to 55,000 based on your progress.</Text>

          <Button href="https://fitcircle.com/dashboard">View Full Dashboard</Button>

          <Text>Keep crushing it!</Text>
          <Text>—The FitCircle Team</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

---

#### Streak At Risk Email
**Subject:** ⚠️ Your {streakCount}-day streak is at risk!

**Template:** `/apps/web/emails/streak-at-risk.tsx`
```typescript
export default function StreakAtRisk({ userName, streakCount, hasFreeze }: StreakAtRiskProps) {
  return (
    <Html>
      <Head />
      <Body>
        <Container>
          <Heading>Hi {userName},</Heading>
          <Text>You missed yesterday's check-in. Your {streakCount}-day streak is at risk!</Text>

          {hasFreeze && (
            <Text>Good news: You have 1 freeze left this week. We'll automatically use it to protect your streak.</Text>
          )}

          <Button href="https://fitcircle.com/checkin">Complete Today's Check-in</Button>

          <Text>Don't lose your momentum!</Text>
          <Text>—The FitCircle Team</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Location:** `/apps/web/app/lib/services/__tests__/`

#### NotificationService Tests
```typescript
// notification-service.test.ts
describe('NotificationService', () => {

  test('registerDeviceToken creates new token', async () => {
    const userId = 'user-uuid';
    const token = 'apns-token-123';

    await NotificationService.registerDeviceToken(userId, token, 'ios');

    const result = await supabase
      .from('user_push_tokens')
      .select('*')
      .eq('device_token', token)
      .single();

    expect(result.data).toBeDefined();
    expect(result.data.platform).toBe('ios');
  });

  test('shouldSendNotification checks preferences', async () => {
    const userId = 'user-uuid';

    // Mock preferences: push disabled
    await supabase.from('notification_preferences').insert({
      user_id: userId,
      push_enabled: false
    });

    const result = await NotificationService.shouldSendNotification(
      userId,
      'daily_checkin',
      'push'
    );

    expect(result).toBe(false);
  });

  test('isInDNDWindow respects user timezone', async () => {
    const userId = 'user-uuid';

    // Mock preferences: DND 10 PM - 7 AM
    await supabase.from('notification_preferences').insert({
      user_id: userId,
      dnd_start: '22:00:00',
      dnd_end: '07:00:00'
    });

    // Mock current time: 11 PM
    const result = await NotificationService.isInDNDWindow(userId);

    expect(result).toBe(true);
  });

  test('checkFrequencyCap enforces 3/day limit', async () => {
    const userId = 'user-uuid';

    // Insert 3 notifications today
    for (let i = 0; i < 3; i++) {
      await supabase.from('notification_logs').insert({
        user_id: userId,
        notification_type: 'test',
        channel: 'push',
        sent_at: new Date()
      });
    }

    const result = await NotificationService.checkFrequencyCap(userId, 'push');

    expect(result).toBe(false);
  });
});
```

#### PushNotificationService Tests
```typescript
// push-notification-service.test.ts
describe('PushNotificationService', () => {

  test('formatAPNsPayload creates valid APNs format', () => {
    const payload = PushNotificationService.formatAPNsPayload('daily_checkin', {
      userName: 'John',
      streakCount: 14
    });

    expect(payload.aps.alert.title).toBe('⏰ Daily Check-in');
    expect(payload.aps.alert.body).toContain('14-day streak');
    expect(payload.data.deep_link).toBe('fitcircle://checkin');
  });

  test('formatFCMPayload creates valid FCM format', () => {
    const payload = PushNotificationService.formatFCMPayload('daily_checkin', {
      userName: 'John',
      streakCount: 14
    });

    expect(payload.notification.title).toBe('⏰ Daily Check-in');
    expect(payload.data.type).toBe('daily_checkin');
  });
});
```

#### EmailNotificationService Tests
```typescript
// email-notification-service.test.ts
describe('EmailNotificationService', () => {

  test('sendWeeklyDigest sends email via Resend', async () => {
    const userId = 'user-uuid';
    const weekData = {
      steps: 52341,
      streakDays: 7,
      weightChange: -1.2,
      leaderboardRank: 2,
      circleName: 'Work Warriors'
    };

    await EmailNotificationService.sendWeeklyDigest(userId, weekData);

    const log = await supabase
      .from('email_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('email_type', 'weekly_digest')
      .single();

    expect(log.data).toBeDefined();
  });

  test('handleUnsubscribe marks user as unsubscribed', async () => {
    const token = 'unsubscribe-token-123';

    // Create user with token
    await supabase.from('email_preferences').insert({
      user_id: 'user-uuid',
      unsubscribe_token: token
    });

    await EmailNotificationService.handleUnsubscribe(token);

    const prefs = await supabase
      .from('email_preferences')
      .select('*')
      .eq('unsubscribe_token', token)
      .single();

    expect(prefs.data.unsubscribed_all).toBe(true);
  });
});
```

---

### 7.2 Integration Tests

**Location:** `/apps/web/app/api/__tests__/`

#### API Endpoint Tests
```typescript
// /api/notifications/register/route.test.ts
describe('POST /api/notifications/register', () => {

  test('registers device token successfully', async () => {
    const response = await fetch('/api/notifications/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${validToken}`
      },
      body: JSON.stringify({
        deviceToken: 'apns-token-123',
        platform: 'ios'
      })
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('rejects unauthenticated requests', async () => {
    const response = await fetch('/api/notifications/register', {
      method: 'POST',
      body: JSON.stringify({ deviceToken: 'test', platform: 'ios' })
    });

    expect(response.status).toBe(401);
  });
});
```

---

### 7.3 E2E Tests (Playwright)

**Location:** `/apps/web/tests/e2e/`

```typescript
// notifications.spec.ts
import { test, expect } from '@playwright/test';

test('user can update notification preferences', async ({ page }) => {
  await page.goto('/settings/notifications');

  // Toggle push notifications off
  await page.click('[data-testid="push-enabled-toggle"]');

  // Set DND hours
  await page.fill('[data-testid="dnd-start"]', '22:00');
  await page.fill('[data-testid="dnd-end"]', '07:00');

  // Save preferences
  await page.click('[data-testid="save-preferences"]');

  // Verify success message
  await expect(page.locator('text=Preferences saved')).toBeVisible();
});

test('user receives push notification', async ({ page, context }) => {
  // Grant notification permission
  await context.grantPermissions(['notifications']);

  // Trigger notification (simulate cron)
  await fetch('/api/cron/notifications/daily-checkin', {
    headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
  });

  // Wait for notification
  const notification = await page.waitForEvent('notification');

  expect(notification.title).toContain('Daily Check-in');
});
```

---

### 7.4 Manual Testing Checklist

#### APNs (iOS) Testing
- [ ] Register device token from iOS app
- [ ] Send test notification via API
- [ ] Verify notification appears on device
- [ ] Test deep link navigation
- [ ] Test notification badge count
- [ ] Test sound/vibration
- [ ] Test notification when app in foreground
- [ ] Test notification when app in background
- [ ] Test invalid token handling

#### FCM (Android) Testing
- [ ] Register device token from Android app
- [ ] Send test notification via API
- [ ] Verify notification appears on device
- [ ] Test deep link navigation
- [ ] Test notification priority (high)
- [ ] Test notification when app in foreground
- [ ] Test notification when app in background
- [ ] Test invalid token handling

#### Email Testing
- [ ] Send welcome email to new user
- [ ] Send weekly digest email
- [ ] Send streak at risk email
- [ ] Test email rendering in Gmail
- [ ] Test email rendering in Outlook
- [ ] Test email rendering on mobile
- [ ] Test one-click unsubscribe link
- [ ] Test email bounce handling

#### Preference Management Testing
- [ ] Update notification preferences via UI
- [ ] Verify preferences saved to DB
- [ ] Test DND window enforcement
- [ ] Test weekend pause enforcement
- [ ] Test frequency cap enforcement
- [ ] Test notification opt-out
- [ ] View notification history

#### Cron Job Testing
- [ ] Manually trigger daily check-in cron
- [ ] Verify correct users targeted
- [ ] Verify timezone handling
- [ ] Test streak at risk cron
- [ ] Test weekly digest cron
- [ ] Test monthly report cron
- [ ] Test leaderboard change cron

---

## 8. Deployment Checklist

### 8.1 Pre-Deployment

#### Database Migration
- [ ] Run Phase 2 migration SQL in Supabase SQL Editor
- [ ] Verify all tables created successfully
- [ ] Verify indexes created
- [ ] Verify RLS policies enabled
- [ ] Verify triggers created
- [ ] Run migration in staging environment first
- [ ] Run migration in production

#### Environment Variables
- [ ] Add APNs credentials to Vercel
  - `APNS_KEY_ID`
  - `APNS_TEAM_ID`
  - `APNS_KEY`
- [ ] Add FCM credentials to Vercel
  - `FCM_SERVER_KEY`
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
- [ ] Add Resend API key to Vercel
  - `RESEND_API_KEY`
- [ ] Add cron secret to Vercel
  - `CRON_SECRET`

#### External Service Setup
- [ ] Create APNs key in Apple Developer account
- [ ] Create Firebase project and get FCM key
- [ ] Create Resend account and verify domain
- [ ] Test APNs connection with test device
- [ ] Test FCM connection with test device
- [ ] Test Resend email sending

---

### 8.2 Deployment Steps

#### Step 1: Deploy Backend Services
```bash
cd FitCircleBE
git checkout -b phase2-notifications
git add .
git commit -m "Add Phase 2 notification infrastructure"
git push origin phase2-notifications
```

#### Step 2: Configure Vercel Cron Jobs
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/notifications/daily-checkin",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/notifications/streak-risk",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/cron/emails/weekly-digest",
      "schedule": "0 * * * 0"
    },
    {
      "path": "/api/cron/emails/monthly-report",
      "schedule": "0 * 1 * *"
    },
    {
      "path": "/api/cron/notifications/leaderboard-changes",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

#### Step 3: Deploy to Vercel
```bash
vercel deploy --prod
```

#### Step 4: Verify Deployment
- [ ] Check Vercel deployment logs
- [ ] Verify all API endpoints return 200
- [ ] Verify cron jobs scheduled in Vercel dashboard
- [ ] Test notification registration endpoint
- [ ] Test preference update endpoint

---

### 8.3 Post-Deployment

#### Monitoring Setup
- [ ] Set up Sentry error tracking
- [ ] Set up Vercel Analytics
- [ ] Create Datadog dashboard for notification metrics
  - Notification send rate
  - Notification delivery rate
  - Notification open rate
  - Email deliverability rate
  - Cron job execution time
  - API endpoint response times

#### Health Checks
- [ ] Monitor notification delivery success rate (target: 95%+)
- [ ] Monitor email deliverability (target: 99%+)
- [ ] Monitor cron job execution (target: 100% success rate)
- [ ] Monitor API endpoint latency (target: <500ms p95)
- [ ] Monitor database query performance

#### Rollback Plan
If critical issues occur:
1. Disable cron jobs in Vercel dashboard
2. Roll back to previous deployment
3. Disable notification features via feature flag
4. Investigate and fix issues
5. Redeploy

---

### 8.4 Beta Testing Plan

#### Phase 1: Internal Testing (Week 1)
- [ ] Test with 10 internal users
- [ ] Verify all notification types sent correctly
- [ ] Verify preference management works
- [ ] Verify DND window enforcement
- [ ] Verify frequency cap enforcement
- [ ] Collect qualitative feedback

#### Phase 2: Closed Beta (Week 2-3)
- [ ] Invite 50 active users to beta
- [ ] Enable notifications for beta cohort
- [ ] A/B test notification frequency (2/week vs 4/week)
- [ ] Monitor opt-in rate (target: 75%+)
- [ ] Monitor open rate (target: 25%+)
- [ ] Monitor opt-out rate (target: <10%)
- [ ] Collect user feedback via in-app survey

#### Phase 3: Phased Rollout (Week 4)
- [ ] Week 1: 25% of users
- [ ] Week 2: 50% of users
- [ ] Week 3: 75% of users
- [ ] Week 4: 100% of users
- [ ] Monitor metrics daily
- [ ] Adjust notification frequency based on data

---

## 9. Estimated Effort

### 9.1 Time Breakdown by Task

| Task | Hours | Dependencies |
|------|-------|--------------|
| **Database Schema** | 8 | None |
| - Write migration SQL | 4 | - |
| - Test migration in staging | 2 | DB access |
| - Run migration in production | 2 | Staging tested |
| **Service Layer** | 48 | DB schema |
| - NotificationService | 8 | - |
| - PushNotificationService | 12 | APNs/FCM setup |
| - EmailNotificationService | 12 | Resend setup |
| - NotificationPreferenceService | 8 | - |
| - NotificationSchedulerService | 8 | - |
| **API Endpoints** | 24 | Service layer |
| - Push notification endpoints | 8 | - |
| - Email endpoints | 8 | - |
| - Preference endpoints | 8 | - |
| **Cron Jobs** | 20 | Service layer |
| - Daily check-in reminder | 4 | - |
| - Streak at risk | 4 | - |
| - Weekly digest | 4 | - |
| - Monthly report | 4 | - |
| - Leaderboard changes | 4 | - |
| **External Integrations** | 24 | - |
| - APNs setup and testing | 8 | Apple Dev account |
| - FCM setup and testing | 8 | Firebase account |
| - Resend setup and testing | 8 | Resend account |
| **Email Templates** | 16 | Resend setup |
| - React Email components | 12 | - |
| - Template testing | 4 | - |
| **Testing** | 32 | All above |
| - Unit tests | 12 | - |
| - Integration tests | 8 | - |
| - E2E tests | 8 | - |
| - Manual testing | 4 | - |
| **Deployment** | 8 | All above |
| - Configure Vercel | 2 | - |
| - Deploy and verify | 2 | - |
| - Beta testing | 4 | - |
| **Total** | **180 hours** | |

---

### 9.2 Timeline (4 Weeks)

#### Week 1: Foundation
- Days 1-2: Database schema and migration
- Days 3-5: Core services (Notification, PushNotification)

#### Week 2: Integration
- Days 1-2: Email service and templates
- Days 3-5: API endpoints

#### Week 3: Scheduling
- Days 1-3: Cron jobs and scheduler service
- Days 4-5: External integrations (APNs, FCM, Resend)

#### Week 4: Testing & Launch
- Days 1-2: Unit and integration tests
- Days 3-4: E2E tests and manual testing
- Day 5: Deployment and beta rollout

---

### 9.3 Resource Requirements

**Engineering:**
- 1 Backend Engineer (full-time, 4 weeks)
- 1 Frontend Engineer (part-time, Week 4 for UI)

**Infrastructure:**
- Apple Developer Account ($99/year)
- Firebase project (free tier)
- Resend account ($20/month for 100K emails)
- Vercel Pro plan (includes cron jobs)

**External Services Costs:**
| Service | Cost | Notes |
|---------|------|-------|
| Apple APNs | Free | Included with Apple Dev account |
| Firebase FCM | Free | Up to 10M messages/month |
| Resend | $20/month | 100K emails/month |
| Vercel Pro | $20/month | Includes cron jobs |
| **Total** | **$40/month** | |

---

## 10. Success Metrics & Monitoring

### 10.1 Key Metrics to Track

**Notification Metrics:**
- Opt-in rate (target: 75%+)
- Push notification delivery rate (target: 95%+)
- Push notification open rate (target: 25%+)
- Email deliverability rate (target: 99%+)
- Email open rate (target: 30%+ weekly digest, 40%+ streak risk)
- Email click-through rate (target: 15%+)
- Notification-driven app return rate (target: 25%+)
- Opt-out rate (target: <10% within 30 days)

**Engagement Metrics:**
- D7 retention (target: 35%+)
- DAU lift (target: +50%)
- Daily check-in completion rate (target: 85%+)
- Streak maintenance (7+ days) (target: 40%)

**System Metrics:**
- Cron job success rate (target: 100%)
- API endpoint latency (target: <500ms p95)
- Database query performance (target: <100ms p95)
- Error rate (target: <1%)

---

### 10.2 Monitoring Dashboards

**Datadog Dashboard:**
```
Notification Performance Dashboard
- Push notification send rate (per hour)
- Push notification delivery rate (%)
- Push notification open rate (%)
- Email send rate (per hour)
- Email deliverability rate (%)
- Email open rate (%)
- Cron job execution time (ms)
- API endpoint latency (ms)
- Error rate (%)
```

**Alerts:**
- Alert if notification delivery rate drops below 90%
- Alert if cron job fails to execute
- Alert if API endpoint latency exceeds 1s
- Alert if error rate exceeds 5%

---

## 11. Future Enhancements (Post-Phase 2)

### 11.1 Phase 3 Considerations

**Advanced Notification Features:**
- In-app notifications (notification bell)
- Web push notifications (desktop browsers)
- SMS notifications (Twilio integration)
- Slack/Discord integrations for team notifications

**Machine Learning:**
- Personalized send time optimization (ML-based)
- Predictive churn detection (send re-engagement notification)
- Content personalization (A/B test notification copy)

**Analytics:**
- Notification A/B testing framework
- User cohort analysis (notification engagement by segment)
- Funnel analysis (notification → app open → action)

---

## Appendix A: Migration SQL

**File:** `/supabase/migrations/030_phase2_notifications.sql`

```sql
-- ============================================================================
-- Phase 2: Notification Infrastructure
-- PRD: /docs/PRD-ENGAGEMENT-V2.md
-- Spec: /docs/PHASE2_BACKEND_DEV_SPEC.md
-- ============================================================================

-- 1. USER PUSH TOKENS
CREATE TABLE user_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
    active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_push_tokens_user ON user_push_tokens(user_id, active);
CREATE INDEX idx_push_tokens_device ON user_push_tokens(device_token) WHERE active = TRUE;

ALTER TABLE user_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own push tokens"
    ON user_push_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens"
    ON user_push_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens"
    ON user_push_tokens FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens"
    ON user_push_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- 2. NOTIFICATION PREFERENCES
CREATE TABLE notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    push_enabled BOOLEAN DEFAULT TRUE,
    email_enabled BOOLEAN DEFAULT TRUE,
    inapp_enabled BOOLEAN DEFAULT TRUE,
    push_daily_checkin BOOLEAN DEFAULT TRUE,
    push_streak_risk BOOLEAN DEFAULT TRUE,
    push_weekly_goal BOOLEAN DEFAULT TRUE,
    push_data_submission BOOLEAN DEFAULT TRUE,
    push_leaderboard_change BOOLEAN DEFAULT TRUE,
    push_social_engagement BOOLEAN DEFAULT TRUE,
    push_weekly_digest BOOLEAN DEFAULT TRUE,
    push_challenge_milestone BOOLEAN DEFAULT TRUE,
    email_daily_checkin BOOLEAN DEFAULT TRUE,
    email_streak_risk BOOLEAN DEFAULT TRUE,
    email_weekly_digest BOOLEAN DEFAULT TRUE,
    email_monthly_report BOOLEAN DEFAULT TRUE,
    email_fitcircle_invite BOOLEAN DEFAULT TRUE,
    email_challenge_milestone BOOLEAN DEFAULT TRUE,
    daily_reminder_time TIME DEFAULT '20:00:00',
    dnd_start TIME DEFAULT '22:00:00',
    dnd_end TIME DEFAULT '07:00:00',
    pause_weekends BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_prefs_user ON notification_preferences(user_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification preferences"
    ON notification_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
    ON notification_preferences FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
    ON notification_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- 3. NOTIFICATION LOGS
CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('push', 'email', 'inapp')),
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ,
    opened BOOLEAN DEFAULT FALSE,
    opened_at TIMESTAMPTZ,
    clicked BOOLEAN DEFAULT FALSE,
    clicked_at TIMESTAMPTZ,
    payload JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_logs_user_type ON notification_logs(user_id, notification_type, sent_at DESC);
CREATE INDEX idx_notification_logs_sent_at ON notification_logs(sent_at DESC);
CREATE INDEX idx_notification_logs_opened ON notification_logs(user_id, opened) WHERE opened = TRUE;

ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification logs"
    ON notification_logs FOR SELECT
    USING (auth.uid() = user_id);

-- 4. EMAIL PREFERENCES
CREATE TABLE email_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    daily_checkin_reminder BOOLEAN DEFAULT TRUE,
    streak_at_risk BOOLEAN DEFAULT TRUE,
    weekly_digest BOOLEAN DEFAULT TRUE,
    monthly_report BOOLEAN DEFAULT TRUE,
    fitcircle_invites BOOLEAN DEFAULT TRUE,
    challenge_milestones BOOLEAN DEFAULT TRUE,
    unsubscribe_token TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
    unsubscribed_all BOOLEAN DEFAULT FALSE,
    unsubscribed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_prefs_user ON email_preferences(user_id);
CREATE INDEX idx_email_prefs_token ON email_preferences(unsubscribe_token);

ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own email preferences"
    ON email_preferences FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own email preferences"
    ON email_preferences FOR UPDATE
    USING (auth.uid() = user_id);

-- 5. EMAIL LOGS
CREATE TABLE email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email_type TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered BOOLEAN DEFAULT FALSE,
    opened BOOLEAN DEFAULT FALSE,
    clicked BOOLEAN DEFAULT FALSE,
    bounced BOOLEAN DEFAULT FALSE,
    resend_email_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_logs_user ON email_logs(user_id, sent_at DESC);
CREATE INDEX idx_email_logs_type ON email_logs(email_type, sent_at DESC);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own email logs"
    ON email_logs FOR SELECT
    USING (auth.uid() = user_id);

-- 6. UPDATE TRIGGERS
CREATE TRIGGER update_user_push_tokens_timestamp
    BEFORE UPDATE ON user_push_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notification_preferences_timestamp
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_email_preferences_timestamp
    BEFORE UPDATE ON email_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 7. ADD USER TIMEZONE COLUMN
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York';

COMMENT ON COLUMN profiles.timezone IS 'User timezone for notification scheduling (IANA format)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
```

---

## Appendix B: TypeScript Types

**File:** `/apps/web/app/lib/types/notifications.ts`

```typescript
export type NotificationChannel = 'push' | 'email' | 'inapp';
export type Platform = 'ios' | 'android';

export interface NotificationPreferences {
  id: string;
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  inapp_enabled: boolean;
  push_daily_checkin: boolean;
  push_streak_risk: boolean;
  push_weekly_goal: boolean;
  push_data_submission: boolean;
  push_leaderboard_change: boolean;
  push_social_engagement: boolean;
  push_weekly_digest: boolean;
  push_challenge_milestone: boolean;
  email_daily_checkin: boolean;
  email_streak_risk: boolean;
  email_weekly_digest: boolean;
  email_monthly_report: boolean;
  email_fitcircle_invite: boolean;
  email_challenge_milestone: boolean;
  daily_reminder_time: string;
  dnd_start: string;
  dnd_end: string;
  pause_weekends: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  notification_type: string;
  channel: NotificationChannel;
  sent_at: string;
  delivered: boolean;
  delivered_at: string | null;
  opened: boolean;
  opened_at: string | null;
  clicked: boolean;
  clicked_at: string | null;
  payload: any;
  error_message: string | null;
  created_at: string;
}

export interface PushToken {
  id: string;
  user_id: string;
  device_token: string;
  platform: Platform;
  active: boolean;
  last_used: string;
  created_at: string;
  updated_at: string;
}

export interface EmailPreferences {
  id: string;
  user_id: string;
  daily_checkin_reminder: boolean;
  streak_at_risk: boolean;
  weekly_digest: boolean;
  monthly_report: boolean;
  fitcircle_invites: boolean;
  challenge_milestones: boolean;
  unsubscribe_token: string;
  unsubscribed_all: boolean;
  unsubscribed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  data: {
    type: string;
    deep_link: string;
    [key: string]: any;
  };
}

export interface APNsPayload {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    badge?: number;
    sound?: string;
  };
  data: {
    type: string;
    deep_link: string;
    [key: string]: any;
  };
}

export interface FCMPayload {
  notification: {
    title: string;
    body: string;
  };
  data: {
    type: string;
    deep_link: string;
    [key: string]: any;
  };
  android: {
    priority: string;
  };
}

export interface WeeklyDigestData {
  steps: number;
  streakDays: number;
  weightChange: number;
  leaderboardRank: number;
  circleName: string;
}

export interface MonthlyReportData {
  totalSteps: number;
  totalWeightLoss: number;
  streakDays: number;
  goalsCompleted: number;
  totalGoals: number;
}
```

---

**End of Document**

Total Length: ~6,000 lines
Document Status: Ready for Implementation
Next Steps: Review with engineering team, then begin Week 1 implementation.
