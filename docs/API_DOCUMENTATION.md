# FitCircle API Documentation

## Overview

The FitCircle backend is built with Next.js 15 App Router and Supabase, providing a robust REST API for the fitness tracking application.

## Setup Instructions

### 1. Database Setup

Run the migration SQL in your Supabase dashboard:
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the contents of `/supabase/migrations/001_initial_schema.sql`
4. Execute the SQL

### 2. Environment Configuration

Ensure your `.env.local` file has all required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (keep secret!)

### 3. Run Setup Script

```bash
npm run setup:db
```

## API Endpoints

### Authentication

#### POST `/api/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "fullName": "John Doe",
  "username": "johndoe" // optional
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe"
  },
  "session": { ... },
  "message": "Registration successful!"
}
```

#### POST `/api/auth/login`
Login to an existing account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "profile": { ... }
  },
  "session": { ... },
  "message": "Login successful!"
}
```

#### POST `/api/auth/logout`
Logout the current user.

**Response:**
```json
{
  "message": "Logout successful"
}
```

#### GET `/api/auth/session`
Get current user session.

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "profile": { ... }
  },
  "session": { ... }
}
```

### Check-ins

#### GET `/api/checkins`
Get user's check-ins.

**Query Parameters:**
- `startDate` (optional) - Filter by start date
- `endDate` (optional) - Filter by end date
- `limit` (optional) - Limit number of results (default: 100)

**Response:**
```json
{
  "checkIns": [...],
  "streak": {
    "current": 5,
    "longest": 10,
    "lastCheckIn": "2024-01-01"
  },
  "total": 50
}
```

#### POST `/api/checkins`
Create a new check-in.

**Request Body:**
```json
{
  "date": "2024-01-01",
  "weight": 75.5,
  "photos": {
    "front": "url",
    "side": "url",
    "back": "url"
  },
  "measurements": {
    "chest": 100,
    "waist": 80,
    "hips": 95
  },
  "mood": "good",
  "energy": 7,
  "sleep": 8,
  "water": 8,
  "notes": "Feeling great!",
  "workouts": [
    {
      "type": "Cardio",
      "duration": 30,
      "calories": 250
    }
  ],
  "nutrition": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fat": 65
  }
}
```

**Response:**
```json
{
  "checkIn": { ... },
  "message": "Check-in created successfully!",
  "xpEarned": 75
}
```

#### GET `/api/checkins/[id]`
Get a specific check-in.

**Response:**
```json
{
  "checkIn": { ... }
}
```

#### PATCH `/api/checkins/[id]`
Update a check-in.

**Request Body:** (partial update)
```json
{
  "weight": 74.5,
  "notes": "Updated notes"
}
```

**Response:**
```json
{
  "checkIn": { ... },
  "message": "Check-in updated successfully!"
}
```

#### DELETE `/api/checkins/[id]`
Delete a check-in.

**Response:**
```json
{
  "message": "Check-in deleted successfully!"
}
```

### Profile

#### GET `/api/profile`
Get current user's profile.

**Response:**
```json
{
  "profile": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "John Doe",
    "username": "johndoe",
    "bio": "Fitness enthusiast",
    "avatar_url": "url",
    "total_xp": 500,
    "level": 5
  },
  "stats": {
    "totalCheckIns": 50,
    "currentStreak": 5,
    "activeChallenges": 2,
    "completedChallenges": 3,
    "teamsJoined": 1
  }
}
```

#### PATCH `/api/profile`
Update user profile.

**Request Body:**
```json
{
  "full_name": "Jane Doe",
  "bio": "New bio",
  "target_weight": 70,
  "activity_level": "moderately_active",
  "preferences": {
    "units": "metric",
    "notifications": true,
    "privacy": "public"
  }
}
```

**Response:**
```json
{
  "profile": { ... },
  "message": "Profile updated successfully!"
}
```

#### DELETE `/api/profile`
Delete user account (permanent).

**Response:**
```json
{
  "message": "Account deleted successfully"
}
```

### File Upload

#### POST `/api/upload`
Upload a file (images only).

**Form Data:**
- `file` - The file to upload (max 5MB)
- `type` - Type of upload (e.g., 'avatar', 'checkin', 'general')

**Response:**
```json
{
  "url": "https://...",
  "fileName": "path/to/file.jpg",
  "message": "File uploaded successfully!"
}
```

#### DELETE `/api/upload?fileName=[path]`
Delete an uploaded file.

**Response:**
```json
{
  "message": "File deleted successfully!"
}
```

### Health Check

#### GET `/api/health`
Check API and service health.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "checks": {
    "api": "operational",
    "database": "operational",
    "auth": "operational"
  },
  "version": "1.0.0",
  "environment": "production"
}
```

## Authentication

All protected endpoints require authentication via cookies set during login. The middleware automatically handles:
- Session validation
- Token refresh
- CORS headers
- Rate limiting (future implementation)

## Error Responses

All endpoints follow a consistent error format:

```json
{
  "error": "Error message",
  "details": [ ... ] // Optional, for validation errors
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable

## Rate Limiting

Rate limiting will be implemented with:
- 100 requests per minute per IP
- 1000 requests per hour per authenticated user

## Security Features

1. **Row Level Security (RLS)** - Database-level security policies
2. **Input Validation** - Zod schemas for all inputs
3. **SQL Injection Prevention** - Parameterized queries via Supabase
4. **XSS Protection** - Content-Type headers and input sanitization
5. **CORS** - Configured for production domains
6. **HTTPS Only** - Secure cookies in production
7. **JWT Tokens** - Secure session management

## Development

To start the development server:

```bash
npm run dev
```

The API will be available at `http://localhost:3000/api`

## Production Deployment

1. Set all environment variables in production
2. Run database migrations
3. Build the application: `npm run build`
4. Start the server: `npm start`

## Testing API Endpoints

You can test the API using tools like:
- Postman
- Thunder Client (VS Code extension)
- curl commands
- The built-in Swagger UI (coming soon)

Example curl command:

```bash
# Register
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","fullName":"Test User"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## Monitoring

The application includes:
- Health check endpoint for uptime monitoring
- Structured logging for debugging
- Error tracking (Sentry integration ready)
- Performance monitoring hooks

## Future Enhancements

- [ ] WebSocket support for real-time features
- [ ] GraphQL API option
- [ ] API versioning
- [ ] Swagger/OpenAPI documentation
- [ ] Rate limiting implementation
- [ ] Caching layer (Redis)
- [ ] Background job processing
- [ ] Email notifications
- [ ] Push notifications
- [ ] AI-powered features integration