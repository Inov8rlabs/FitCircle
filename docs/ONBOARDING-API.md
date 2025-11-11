# FitCircle Onboarding API Documentation

**Version:** 1.0
**Last Updated:** 2025-11-11

This document describes all API endpoints required to support the FitCircle iOS/mobile onboarding flow.

## Table of Contents

- [Authentication](#authentication)
- [Profile Management](#profile-management)
- [Persona Detection](#persona-detection)
- [Goals Management](#goals-management)
- [First Check-In](#first-check-in)
- [Onboarding Progress](#onboarding-progress)
- [FitCircle Setup](#fitcircle-setup)
- [Challenge Discovery](#challenge-discovery)
- [Error Codes](#error-codes)

---

## Authentication

All endpoints require authentication via Bearer token in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

Tokens are obtained from the `/api/mobile/auth/login` or `/api/mobile/auth/register` endpoints.

---

## Profile Management

### GET /api/onboarding/profile

Get current user's profile (for resuming onboarding).

**Request:**
```http
GET /api/onboarding/profile
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "displayName": "John Doe",
      "username": "johndoe",
      "avatarUrl": "https://...",
      "bio": "Fitness enthusiast",
      "persona": "casey",
      "fitnessLevel": "intermediate",
      "timeCommitment": "30-60",
      "onboardingCompleted": false
    }
  },
  "meta": {
    "requestTime": 123
  },
  "error": null
}
```

### POST /api/onboarding/profile

Create or update user profile during onboarding.

**Request:**
```http
POST /api/onboarding/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "John Doe",
  "username": "johndoe",
  "avatarUrl": "https://...",
  "bio": "Fitness enthusiast"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "profile": {
      "id": "uuid",
      "displayName": "John Doe",
      "username": "johndoe",
      "avatarUrl": "https://...",
      "bio": "Fitness enthusiast"
    }
  },
  "meta": {
    "requestTime": 145
  },
  "error": null
}
```

**Errors:**
- `USERNAME_TAKEN` (409): Username already in use
- `VALIDATION_ERROR` (400): Invalid input data

---

## Persona Detection

### POST /api/onboarding/persona

Submit questionnaire answers and detect user persona.

**Request:**
```http
POST /api/onboarding/persona
Authorization: Bearer <token>
Content-Type: application/json

{
  "primaryGoal": "lose_weight",
  "motivationStyle": "competition",
  "fitnessLevel": "intermediate",
  "timeCommitment": "30-60"
}
```

**Fields:**
- `primaryGoal`: `"lose_weight" | "get_stronger" | "stay_accountable" | "stay_active"`
- `motivationStyle`: `"competition" | "community" | "progress_tracking" | "rewards"`
- `fitnessLevel`: `"beginner" | "intermediate" | "advanced" | "athlete"`
- `timeCommitment`: `"15-30" | "30-60" | "60+" | "flexible"`

**Response:**
```json
{
  "success": true,
  "data": {
    "persona": {
      "primary": "casey",
      "secondary": "mike",
      "scores": {
        "casey": 5,
        "sarah": 0,
        "mike": 3,
        "fiona": 1
      },
      "description": "You're a competitive achiever who thrives on challenges...",
      "recommendations": [
        "Join high-stakes challenges with cash prizes",
        "Compete on leaderboards against other top performers",
        "Set aggressive goals and track your ranking",
        "Challenge friends to head-to-head competitions"
      ]
    }
  },
  "meta": {
    "requestTime": 234
  },
  "error": null
}
```

**Persona Types:**
- `casey`: Competitive achiever
- `sarah`: Social connector
- `mike`: Practical go-getter
- `fiona`: Fitness enthusiast

---

## Goals Management

### POST /api/onboarding/goals

Set initial fitness goals during onboarding.

**Request:**
```http
POST /api/onboarding/goals
Authorization: Bearer <token>
Content-Type: application/json

{
  "weightGoal": {
    "currentWeight": 180,
    "targetWeight": 165,
    "targetDate": "2025-03-01",
    "unit": "lbs"
  },
  "stepsGoal": {
    "dailySteps": 10000
  },
  "workoutFrequency": {
    "daysPerWeek": 4,
    "minutesPerDay": 30
  },
  "customGoals": [
    {
      "name": "Drink more water",
      "description": "8 glasses per day",
      "targetValue": 8,
      "unit": "glasses"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "goals": [
      {
        "id": "uuid",
        "userId": "uuid",
        "goalType": "weight",
        "goalName": "Weight Loss Goal",
        "goalDescription": "Lose 15.0 lbs",
        "currentValue": 81.65,
        "targetValue": 74.84,
        "startValue": 81.65,
        "targetDate": "2025-03-01",
        "status": "active",
        "progressPercentage": 0,
        "createdAt": "2025-11-11T10:00:00Z"
      }
    ],
    "message": "Created 4 goal(s) successfully"
  },
  "meta": {
    "requestTime": 189
  },
  "error": null
}
```

### GET /api/onboarding/goals

Get user's goals.

**Request:**
```http
GET /api/onboarding/goals
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "goals": [
      {
        "id": "uuid",
        "goalType": "weight",
        "goalName": "Weight Loss Goal",
        "targetValue": 74.84,
        "currentValue": 81.65,
        "progressPercentage": 0,
        "status": "active"
      }
    ]
  },
  "meta": {
    "requestTime": 98
  },
  "error": null
}
```

---

## First Check-In

### POST /api/onboarding/first-checkin

Record initial measurements and first check-in.

**Request:**
```http
POST /api/onboarding/first-checkin
Authorization: Bearer <token>
Content-Type: application/json

{
  "weight": 180,
  "height": 72,
  "measurements": {
    "chest": 42,
    "waist": 36,
    "hips": 38
  },
  "mood": 4,
  "energy": 3,
  "notes": "Feeling motivated to start!",
  "unit": "lbs"
}
```

**Fields:**
- `weight`: Current weight (optional)
- `height`: Height in inches (optional)
- `measurements`: Body measurements (optional)
- `mood`: 1-5 scale (optional)
- `energy`: 1-5 scale (optional)
- `notes`: Text notes (optional)
- `unit`: `"kg" | "lbs"` (default: "lbs")

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "First check-in recorded successfully",
    "checkIn": {
      "weight": 180,
      "height": 72,
      "mood": 4,
      "energy": 3
    }
  },
  "meta": {
    "requestTime": 156
  },
  "error": null
}
```

---

## Onboarding Progress

### GET /api/onboarding/progress

Get saved onboarding progress (for resuming).

**Request:**
```http
GET /api/onboarding/progress
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": {
      "id": "uuid",
      "userId": "uuid",
      "currentStep": 3,
      "completedSteps": [1, 2, 3],
      "isComplete": false,
      "questionnaireAnswers": {
        "primaryGoal": "lose_weight",
        "motivationStyle": "competition"
      },
      "personaScores": {
        "casey": 5,
        "sarah": 0,
        "mike": 2,
        "fiona": 0
      },
      "detectedPersona": "casey",
      "goalsData": {},
      "createdAt": "2025-11-11T09:00:00Z",
      "updatedAt": "2025-11-11T10:00:00Z"
    }
  },
  "meta": {
    "requestTime": 87
  },
  "error": null
}
```

Returns `null` for `progress` if user hasn't started or has completed onboarding.

### POST /api/onboarding/progress

Save onboarding progress (allows resume if user closes app).

**Request:**
```http
POST /api/onboarding/progress
Authorization: Bearer <token>
Content-Type: application/json

{
  "currentStep": 3,
  "completedSteps": [1, 2, 3],
  "questionnaireAnswers": {
    "primaryGoal": "lose_weight",
    "motivationStyle": "competition"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress": {
      "id": "uuid",
      "currentStep": 3,
      "completedSteps": [1, 2, 3],
      "isComplete": false
    }
  },
  "meta": {
    "requestTime": 134
  },
  "error": null
}
```

### POST /api/onboarding/complete

Mark onboarding as complete and award achievement.

**Request:**
```http
POST /api/onboarding/complete
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "user": {
      "id": "uuid",
      "displayName": "John Doe",
      "persona": "casey",
      "totalXp": 250,
      "currentLevel": 1
    },
    "achievement": {
      "id": "uuid",
      "name": "Getting Started",
      "description": "Completed onboarding and started your fitness journey!",
      "xpAwarded": 250
    },
    "goals": [
      {
        "id": "uuid",
        "goalType": "weight",
        "goalName": "Weight Loss Goal"
      }
    ]
  },
  "meta": {
    "requestTime": 267
  },
  "error": null
}
```

---

## FitCircle Setup

### POST /api/fitcircles/create

Create a new FitCircle during onboarding (Sarah persona flow).

**Request:**
```http
POST /api/fitcircles/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Fitness Squad",
  "description": "Friends getting fit together!",
  "type": "weight_loss",
  "startDate": "2025-11-15T00:00:00Z",
  "endDate": "2025-12-15T00:00:00Z",
  "visibility": "invite_only",
  "entryFee": 0,
  "maxParticipants": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fitCircle": {
      "id": "uuid",
      "name": "My Fitness Squad",
      "description": "Friends getting fit together!",
      "type": "weight_loss",
      "status": "upcoming",
      "visibility": "invite_only",
      "startDate": "2025-11-15T00:00:00Z",
      "endDate": "2025-12-15T00:00:00Z",
      "participantCount": 1,
      "creatorId": "uuid"
    }
  },
  "meta": {
    "requestTime": 198
  },
  "error": null
}
```

### POST /api/fitcircles/join

Join an existing FitCircle.

**Request:**
```http
POST /api/fitcircles/join
Authorization: Bearer <token>
Content-Type: application/json

{
  "fitCircleId": "uuid"
}
```

Or with invite code:
```json
{
  "inviteCode": "abc123def456"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fitCircle": {
      "id": "uuid",
      "name": "My Fitness Squad",
      "type": "weight_loss",
      "status": "upcoming"
    },
    "participation": {
      "id": "uuid",
      "joinedAt": "2025-11-11T10:00:00Z",
      "status": "active"
    }
  },
  "meta": {
    "requestTime": 145
  },
  "error": null
}
```

**Errors:**
- `INVALID_INVITE_CODE` (404): Invalid invite code
- `CHALLENGE_NOT_FOUND` (404): FitCircle not found
- `ALREADY_JOINED` (409): Already a member
- `MAX_PARTICIPANTS_REACHED` (409): FitCircle is full

### GET /api/fitcircles/suggested

Get suggested FitCircles to join.

**Request:**
```http
GET /api/fitcircles/suggested
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fitCircles": [
      {
        "id": "uuid",
        "name": "30-Day Weight Loss Challenge",
        "description": "Lose weight together!",
        "type": "weight_loss",
        "status": "upcoming",
        "participantCount": 15,
        "maxParticipants": 50,
        "entryFee": 10,
        "prizePool": 500,
        "startDate": "2025-11-20T00:00:00Z",
        "endDate": "2025-12-20T00:00:00Z",
        "isRecommended": true,
        "recommendationReason": "Competitive challenge with prizes"
      }
    ]
  },
  "meta": {
    "requestTime": 234
  },
  "error": null
}
```

---

## Challenge Discovery

### GET /api/challenges/beginner

Get beginner-friendly challenges (Casey persona flow).

**Request:**
```http
GET /api/challenges/beginner
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "challenges": [
      {
        "id": "uuid",
        "name": "First Steps Challenge",
        "description": "Walk 10,000 steps daily for 2 weeks",
        "type": "step_count",
        "difficulty": "beginner",
        "duration": 14,
        "participantCount": 8,
        "entryFee": 0,
        "prizePool": 0,
        "startDate": "2025-11-15T00:00:00Z",
        "isRecommended": true,
        "recommendationReason": "Perfect for beginners"
      }
    ]
  },
  "meta": {
    "requestTime": 187
  },
  "error": null
}
```

---

## Error Codes

All errors follow this format:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {},
    "timestamp": "2025-11-11T10:00:00Z"
  },
  "meta": null
}
```

### Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or expired token |
| `VALIDATION_ERROR` | 400 | Invalid input data |
| `USERNAME_TAKEN` | 409 | Username already in use |
| `USER_NOT_FOUND` | 404 | User not found |
| `CHALLENGE_NOT_FOUND` | 404 | Challenge/FitCircle not found |
| `ALREADY_JOINED` | 409 | Already a member of this FitCircle |
| `MAX_PARTICIPANTS_REACHED` | 409 | FitCircle has reached max participants |
| `INVALID_INVITE_CODE` | 404 | Invalid invite code |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |

---

## Response Format

All API responses follow this standard format:

```typescript
{
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details: Record<string, any>;
    timestamp: string;
  } | null;
  meta: {
    requestTime: number; // milliseconds
  } | null;
}
```

---

## Database Schema

### Tables Created

1. **onboarding_progress** - Track onboarding state
2. **user_goals** - Store user fitness goals
3. **user_achievements** - Track achievements and XP

### Columns Added to profiles

- `persona` - Detected persona type
- `persona_secondary` - Secondary persona
- `fitness_level` - Beginner/Intermediate/Advanced/Athlete
- `time_commitment` - Daily time available
- `onboarding_completed_at` - Completion timestamp
- `onboarding_current_step` - Current step number
- `total_xp` - Total XP earned
- `current_level` - User's current level

---

## Testing

Run tests with:

```bash
npm test -- persona-service.test.ts
```

Test coverage includes:
- Persona detection algorithm
- All persona types (Casey, Sarah, Mike, Fiona)
- Scoring system validation
- Welcome message generation
- Persona flow customization

---

## Migration

To apply the database schema:

1. Run migration `032_onboarding_system.sql` in Supabase SQL Editor
2. Verify tables created with RLS policies enabled
3. Test with a new user registration

---

**Last Updated:** 2025-11-11
**Maintained By:** FitCircle Backend Team
