# FitCircle API Reference

Quick reference guide for all FitCircle backend endpoints.

---

## Circle Management

### Create Circle
```http
POST /api/circles
```

**Request Body:**
```json
{
  "name": "Summer Shred Challenge",
  "description": "Let's get fit together!",
  "start_date": "2025-10-10",
  "end_date": "2025-11-10",
  "allow_late_join": true,
  "late_join_deadline": 3
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "circle": { /* circle object */ },
    "invite_code": "ABC123XYZ",
    "invite_link": "https://fitcircle.app/join/ABC123XYZ"
  }
}
```

### Get Circle Details
```http
GET /api/circles/{id}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Summer Shred Challenge",
    "description": "Let's get fit together!",
    "start_date": "2025-10-10",
    "end_date": "2025-11-10",
    "member_count": 12,
    "days_remaining": 15,
    "is_member": true,
    "user_progress": 45.5,
    "user_rank": 3
  }
}
```

### Get My Circles
```http
GET /api/circles/my-circles
```

**Response:**
```json
{
  "success": true,
  "data": {
    "active": [/* active circles */],
    "upcoming": [/* upcoming circles */],
    "completed": [/* completed circles */]
  }
}
```

---

## Invite System

### Generate Invite
```http
POST /api/circles/{id}/invite
```

**Request Body (Optional):**
```json
{
  "emails": ["friend@example.com", "buddy@example.com"],
  "message": "Join my fitness challenge!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "invite_code": "ABC123XYZ",
    "invite_link": "https://fitcircle.app/join/ABC123XYZ",
    "share_text": "Hey! I'm starting a 30-day fitness challenge...",
    "sent": 2,
    "failed": []
  }
}
```

### Validate Invite Code
```http
GET /api/circles/join/{code}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "circle_name": "Summer Shred Challenge",
    "circle_description": "Let's get fit together!",
    "starts_in_days": 5,
    "member_count": 12,
    "inviter_name": "John Doe"
  }
}
```

### Join Circle
```http
POST /api/circles/join/{code}
```

**Request Body:**
```json
{
  "goal_type": "weight_loss",
  "goal_start_value": 200,
  "goal_target_value": 180,
  "goal_unit": "lbs"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "circle_id": "uuid",
    "redirect_url": "/circles/uuid",
    "message": "Successfully joined the circle!"
  }
}
```

---

## Goals & Progress

### Set Personal Goal
```http
POST /api/circles/{id}/goal
PUT /api/circles/{id}/goal
```

**Request Body (Weight Loss):**
```json
{
  "goal_type": "weight_loss",
  "goal_start_value": 200,
  "goal_target_value": 180,
  "goal_unit": "lbs"
}
```

**Request Body (Step Count):**
```json
{
  "goal_type": "step_count",
  "goal_start_value": 5000,
  "goal_target_value": 10000,
  "goal_unit": "steps"
}
```

**Request Body (Custom):**
```json
{
  "goal_type": "custom",
  "goal_target_value": 100,
  "goal_unit": "percent",
  "goal_description": "Complete Couch to 5K"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "goal_id": "uuid",
    "progress_percentage": 0,
    "message": "Goal set successfully"
  }
}
```

### Submit Check-in
```http
POST /api/circles/{id}/checkin
```

**Request Body:**
```json
{
  "value": 195,
  "mood_score": 8,
  "energy_level": 7,
  "note": "Feeling great today!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "progress_percentage": 25.0,
    "rank_change": 2,
    "streak_days": 7,
    "milestone_reached": "progress_25",
    "new_rank": 5
  }
}
```

### Get My Progress
```http
GET /api/circles/{id}/progress
```

**Response:**
```json
{
  "success": true,
  "data": {
    "member_id": "uuid",
    "goal_type": "weight_loss",
    "goal_unit": "lbs",
    "progress_percentage": 45.5,
    "total_check_ins": 21,
    "streak_days": 7,
    "longest_streak": 14,
    "last_check_in_at": "2025-10-04T10:00:00Z",
    "rank": 3,
    "check_in_history": [
      {
        "check_in_date": "2025-10-04",
        "progress_percentage": 45.5,
        "mood_score": 8,
        "energy_level": 7,
        "note": "Feeling great!"
      }
    ]
  }
}
```

---

## Leaderboard

### Get Leaderboard
```http
GET /api/circles/{id}/leaderboard
```

**Response:**
```json
{
  "success": true,
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "user_id": "uuid",
        "display_name": "Sarah M.",
        "avatar_url": "https://...",
        "progress_percentage": 78.5,
        "streak_days": 14,
        "last_check_in_at": "2025-10-04T08:00:00Z",
        "checked_in_today": true,
        "high_fives_received": 23,
        "is_current_user": false
      }
    ],
    "user_rank": 3,
    "circle_stats": {
      "average_progress": 45.2,
      "total_check_ins": 234,
      "completion_rate": 0.65,
      "average_streak": 8.5
    },
    "last_updated": "2025-10-04T12:00:00Z"
  }
}
```

---

## Social Features

### Send Encouragement
```http
POST /api/circles/{id}/encourage
```

**Request Body (High-Five):**
```json
{
  "to_user_id": "uuid",
  "type": "high_five"
}
```

**Request Body (Message):**
```json
{
  "to_user_id": "uuid",
  "type": "message",
  "content": "Great progress! Keep it up!"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sent": true,
    "daily_limit_remaining": 7,
    "message": "Encouragement sent!"
  }
}
```

### Get Encouragements
```http
GET /api/circles/{id}/encouragements
GET /api/circles/{id}/encouragements?personal_only=true
GET /api/circles/{id}/encouragements?type=high_five
```

**Response:**
```json
{
  "success": true,
  "data": {
    "encouragements": [
      {
        "id": "uuid",
        "type": "high_five",
        "from_user": {
          "id": "uuid",
          "display_name": "John D.",
          "avatar_url": "https://..."
        },
        "to_user": {
          "id": "uuid",
          "display_name": "Sarah M.",
          "avatar_url": "https://..."
        },
        "created_at": "2025-10-04T10:00:00Z"
      },
      {
        "id": "uuid",
        "type": "milestone",
        "milestone_type": "progress_50",
        "content": "Sarah M. is halfway to their goal!",
        "from_user": {
          "id": "uuid",
          "display_name": "Sarah M.",
          "avatar_url": "https://..."
        },
        "created_at": "2025-10-04T09:00:00Z"
      }
    ],
    "total_count": 45
  }
}
```

---

## Error Responses

### Validation Error
```json
{
  "error": "Validation failed",
  "validation_errors": [
    {
      "field": "goal_target_value",
      "message": "Required"
    }
  ]
}
```

### Unauthorized
```json
{
  "error": "Unauthorized"
}
```

### Already Checked In
```json
{
  "error": "You have already checked in today"
}
```

### Rate Limit Exceeded
```json
{
  "error": "You've reached your daily limit of 10 high-fives"
}
```

---

## Goal Types Reference

### weight_loss
```json
{
  "goal_type": "weight_loss",
  "goal_start_value": 200,
  "goal_target_value": 180,
  "goal_unit": "lbs"
}
```
Progress: `(start - current) / (start - target) × 100`

### step_count
```json
{
  "goal_type": "step_count",
  "goal_start_value": 5000,
  "goal_target_value": 10000,
  "goal_unit": "steps"
}
```
Progress: `current / target × 100`

### workout_frequency
```json
{
  "goal_type": "workout_frequency",
  "goal_start_value": 2,
  "goal_target_value": 5,
  "goal_unit": "sessions/week"
}
```
Progress: `current / target × 100`

### custom
```json
{
  "goal_type": "custom",
  "goal_target_value": 100,
  "goal_unit": "percent",
  "goal_description": "Complete Couch to 5K"
}
```
Progress: `current / target × 100`

---

## Milestone Types

Auto-detected when checking in:

**Progress Milestones:**
- `progress_25` - Reached 25%
- `progress_50` - Reached 50%
- `progress_75` - Reached 75%
- `progress_100` - Reached 100% (completed goal!)

**Streak Milestones:**
- `streak_7` - 7-day streak
- `streak_14` - 14-day streak
- `streak_30` - 30-day streak

---

## Rate Limits

- **High-Fives:** 10 per user per circle per day
- **Check-ins:** 1 per user per circle per day

---

## Authentication

All endpoints (except `GET /api/circles/join/{code}`) require authentication.

**Headers:**
```
Cookie: sb-access-token=...
```

Authentication is handled automatically by Next.js middleware and Supabase.

---

## Privacy Guarantees

**Never Exposed:**
- Actual weight/measurement values
- Goal start/target values
- Check-in values (only % shown)
- Personal notes from check-ins

**Shared Within Circle:**
- Progress percentage
- Streak days
- Check-in status (did/didn't today)
- High-fives sent/received

---

## Status Codes

- `200` - Success
- `400` - Bad Request (validation errors, already exists, etc.)
- `401` - Unauthorized (not logged in)
- `403` - Forbidden (not a member, no permission)
- `404` - Not Found (circle doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

---

**Last Updated:** 2025-10-04