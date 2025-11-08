# Mobile API Setup Guide

This guide explains how to set up and use the mobile API endpoints for the FitCircle iOS app.

## Environment Variables

Add these to your `.env.local` file:

```bash
# JWT Configuration (REQUIRED for mobile API)
JWT_SECRET=<generate-with: openssl rand -base64 32>
JWT_REFRESH_SECRET=<generate-with: openssl rand -base64 32>
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d
```

### Generate JWT Secrets

Run these commands to generate secure JWT secrets:

```bash
# Generate JWT secret
openssl rand -base64 32

# Generate JWT refresh secret
openssl rand -base64 32
```

Copy the output and add to your `.env.local` file.

## Supabase Storage Buckets Setup

The mobile API uses Supabase Storage for image uploads. You need to create two storage buckets:

### 1. Create Buckets in Supabase Dashboard

Go to **Storage** in your Supabase dashboard and create these buckets:

#### Bucket 1: `avatars`
- **Name:** `avatars`
- **Public:** Yes
- **File size limit:** 5MB
- **Allowed MIME types:** `image/jpeg, image/png, image/webp, image/heic`

#### Bucket 2: `checkin-photos`
- **Name:** `checkin-photos`
- **Public:** Yes
- **File size limit:** 10MB
- **Allowed MIME types:** `image/jpeg, image/png, image/webp, image/heic`

### 2. Set Up RLS Policies

For each bucket, add these Row Level Security (RLS) policies:

#### Avatars Bucket Policies

```sql
-- Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access to all avatars
CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');
```

#### Check-in Photos Bucket Policies

```sql
-- Allow authenticated users to upload check-in photos
CREATE POLICY "Users can upload check-in photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'checkin-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to view their own check-in photos
CREATE POLICY "Users can view own check-in photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'checkin-photos' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow circle members to view each other's check-in photos
-- (Optional - implement if needed for social features)
```

## API Endpoints

### Authentication

All mobile API endpoints use Bearer token authentication:

```
Authorization: Bearer <access_token>
```

#### POST /api/mobile/auth/login
Login with email and password, returns JWT tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "user": { ... },
  "session": {
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_at": 1234567890,
    "token_type": "Bearer"
  }
}
```

#### POST /api/mobile/auth/register
Register new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "username": "johndoe",
  "displayName": "John Doe"
}
```

#### POST /api/mobile/auth/refresh
Refresh expired access token.

**Request:**
```json
{
  "refresh_token": "eyJhbGc..."
}
```

#### GET /api/mobile/auth/session
Check current session validity.

**Headers:**
```
Authorization: Bearer <access_token>
```

### Daily Tracking

#### GET /api/mobile/tracking/daily
Get daily tracking data with stats.

**Query params:**
- `startDate` (optional): YYYY-MM-DD
- `endDate` (optional): YYYY-MM-DD
- `limit` (optional): number (default: 30)

**Response:**
```json
{
  "success": true,
  "data": [...],
  "stats": {
    "todaySteps": 5000,
    "todayWeight": 75.5,
    "weeklyAvgSteps": 8500,
    "currentStreak": 7
  }
}
```

#### POST /api/mobile/tracking/daily
Create or update daily tracking entry.

**Request:**
```json
{
  "trackingDate": "2025-01-10",
  "weightKg": 75.5,
  "steps": 10000,
  "moodScore": 8,
  "energyLevel": 7,
  "notes": "Feeling great today!"
}
```

#### PUT /api/mobile/tracking/daily/[date]
Update tracking for specific date.

#### DELETE /api/mobile/tracking/daily/[date]
Delete tracking for specific date.

### FitCircles

#### GET /api/mobile/circles
Get all circles for the authenticated user.

**Response:**
```json
{
  "success": true,
  "circles": {
    "active": [...],
    "upcoming": [...],
    "completed": [...]
  },
  "summary": {
    "totalActive": 2,
    "totalCompleted": 5
  }
}
```

#### GET /api/mobile/circles/[id]
Get detailed information about a specific circle.

**Response:**
```json
{
  "success": true,
  "circle": {
    ...circle_details,
    "participants": [...],
    "leaderboard": [...],
    "userProgress": {...},
    "stats": {...}
  }
}
```

#### POST /api/mobile/circles
Create a new circle.

**Request:**
```json
{
  "name": "New Year Weight Loss",
  "description": "Let's lose weight together!",
  "startDate": "2025-01-15",
  "endDate": "2025-03-15",
  "allowLateJoin": true,
  "lateJoinDeadline": 7
}
```

#### POST /api/mobile/circles/join
Join a circle using invite code.

**Request:**
```json
{
  "inviteCode": "ABC123XYZ",
  "goal": {
    "goal_type": "weight_loss",
    "goal_start_value": 180,
    "goal_target_value": 160,
    "goal_unit": "lbs"
  }
}
```

### Profile

#### GET /api/mobile/profile
Get user profile with stats and goals.

**Response:**
```json
{
  "success": true,
  "user": {
    ...profile_data,
    "stats": {
      "totalPoints": 1500,
      "currentStreak": 14,
      "challengesCompleted": 3
    },
    "goals": [...],
    "preferences": {...}
  }
}
```

#### PUT /api/mobile/profile
Update user profile.

**Request:**
```json
{
  "displayName": "John Doe",
  "username": "johndoe",
  "bio": "Fitness enthusiast"
}
```

#### PUT /api/mobile/profile/goals
Update user goals.

**Request:**
```json
{
  "goals": [
    {
      "type": "weight_loss",
      "target": 160,
      "unit": "lbs",
      "deadline": "2025-06-01"
    }
  ]
}
```

### Image Upload

#### POST /api/mobile/upload/avatar
Upload user avatar image.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (max 5MB, JPEG/PNG/WEBP/HEIC)

**Response:**
```json
{
  "success": true,
  "url": "https://...supabase.co/storage/v1/object/public/avatars/...",
  "message": "Avatar uploaded successfully"
}
```

#### POST /api/mobile/upload/checkin-photo
Upload check-in progress photo.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (max 10MB, JPEG/PNG/WEBP/HEIC)

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": {} // Optional, for validation errors
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/expired token)
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict (duplicate username, already a member, etc.)
- `500` - Internal Server Error

## Token Expiry and Refresh

Access tokens expire after 15 minutes. When you receive a `401 Unauthorized` response:

1. Call `/api/mobile/auth/refresh` with the refresh token
2. Store the new access token
3. Retry the original request with the new access token

Refresh tokens expire after 7 days. When a refresh token expires, the user must login again.

## Testing

Use tools like Postman, Insomnia, or cURL to test the endpoints:

```bash
# Login
curl -X POST http://localhost:3000/api/mobile/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Get tracking data with Bearer token
curl -X GET http://localhost:3000/api/mobile/tracking/daily \
  -H "Authorization: Bearer eyJhbGc..."

# Upload avatar
curl -X POST http://localhost:3000/api/mobile/upload/avatar \
  -H "Authorization: Bearer eyJhbGc..." \
  -F "file=@avatar.jpg"
```

## iOS Integration

Example Swift code for using the API:

```swift
// Login
let loginRequest = LoginRequest(email: "user@example.com", password: "password123")
let response = try await apiClient.login(loginRequest)
// Store tokens securely in Keychain
KeychainHelper.save(response.session.accessToken, forKey: "access_token")
KeychainHelper.save(response.session.refreshToken, forKey: "refresh_token")

// Make authenticated request
let accessToken = KeychainHelper.get("access_token")
var request = URLRequest(url: url)
request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
```

## Security Best Practices

1. **Never log tokens** - JWT tokens contain sensitive data
2. **Store tokens securely** - Use iOS Keychain for token storage
3. **Use HTTPS** - Always use HTTPS in production
4. **Validate SSL certificates** - Enable certificate pinning for extra security
5. **Handle token refresh** - Implement automatic token refresh logic
6. **Clear tokens on logout** - Delete all tokens from secure storage
7. **Rate limiting** - The API has built-in rate limiting (configurable)

## Troubleshooting

### 401 Unauthorized

- Check that the access token is valid and not expired
- Ensure the token is sent with `Bearer ` prefix
- Try refreshing the token

### 409 Conflict

- Username already exists (during registration or profile update)
- User already a member of the circle (when joining)

### 500 Internal Server Error

- Check server logs for detailed error message
- Ensure all environment variables are set correctly
- Verify Supabase connection is working

## Next Steps

1. Set up environment variables
2. Create Supabase storage buckets
3. Configure RLS policies
4. Test endpoints with Postman
5. Integrate with iOS app
