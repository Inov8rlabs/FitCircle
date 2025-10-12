# FitCircle Mobile API - Quick Reference

## Base URL
```
Development: http://localhost:3000
Production: https://fitcircle.app
```

## Authentication

All endpoints (except login/register) require:
```
Authorization: Bearer <access_token>
```

## Quick Start

### 1. Login
```http
POST /api/mobile/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "success": true,
  "user": { "id": "...", "email": "...", ... },
  "session": {
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "expires_at": 1234567890,
    "token_type": "Bearer"
  }
}
```

### 2. Get Daily Tracking
```http
GET /api/mobile/tracking/daily?limit=30
Authorization: Bearer <access_token>
```

### 3. Submit Daily Check-in
```http
POST /api/mobile/tracking/daily
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "trackingDate": "2025-01-10",
  "weightKg": 75.5,
  "steps": 10000,
  "moodScore": 8,
  "energyLevel": 7
}
```

### 4. Get My Circles
```http
GET /api/mobile/circles
Authorization: Bearer <access_token>
```

## All Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/mobile/auth/login | Login user |
| POST | /api/mobile/auth/register | Register new user |
| POST | /api/mobile/auth/refresh | Refresh access token |
| GET | /api/mobile/auth/session | Check session |

### Daily Tracking
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/mobile/tracking/daily | Get tracking data + stats |
| POST | /api/mobile/tracking/daily | Create/update entry |
| GET | /api/mobile/tracking/daily/[date] | Get specific date |
| PUT | /api/mobile/tracking/daily/[date] | Update specific date |
| DELETE | /api/mobile/tracking/daily/[date] | Delete entry |

### FitCircles
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/mobile/circles | Get all circles |
| POST | /api/mobile/circles | Create circle |
| GET | /api/mobile/circles/[id] | Get circle details |
| POST | /api/mobile/circles/join | Join with invite code |

### Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/mobile/profile | Get profile + stats |
| PUT | /api/mobile/profile | Update profile |
| PUT | /api/mobile/profile/goals | Update goals |

### Uploads
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/mobile/upload/avatar | Upload avatar (max 5MB) |
| POST | /api/mobile/upload/checkin-photo | Upload photo (max 10MB) |

## Data Types

### Daily Tracking Entry
```typescript
{
  trackingDate: string;      // "YYYY-MM-DD"
  weightKg?: number;         // 0-1000
  steps?: number;            // >= 0
  moodScore?: number;        // 1-10
  energyLevel?: number;      // 1-10
  notes?: string;            // Optional text
}
```

### Circle
```typescript
{
  name: string;              // Required
  description?: string;      // Optional
  startDate: string;         // "YYYY-MM-DD"
  endDate: string;           // "YYYY-MM-DD"
  allowLateJoin?: boolean;   // Default: true
  lateJoinDeadline?: number; // Days (1-30)
}
```

### User Profile Update
```typescript
{
  displayName?: string;      // 1-100 chars
  username?: string;         // 3-30 chars, alphanumeric + _
  avatarUrl?: string;        // Valid URL
  bio?: string;              // Max 500 chars
}
```

## Error Handling

### Token Refresh Flow
```
1. Make API request
2. Receive 401 Unauthorized
3. POST /api/mobile/auth/refresh with refresh_token
4. Get new access_token
5. Retry original request
```

### Error Response Format
```json
{
  "error": "Error type",
  "message": "Human-readable message",
  "details": {}  // Optional validation errors
}
```

### Status Codes
- 200: Success
- 201: Created
- 400: Bad request / Validation error
- 401: Unauthorized / Invalid token
- 404: Not found
- 409: Conflict (username exists, already member)
- 500: Server error

## iOS Code Examples

### Setup URLSession with Token
```swift
func makeAuthenticatedRequest(url: URL) async throws -> Data {
    let token = KeychainHelper.get("access_token")
    var request = URLRequest(url: url)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
        throw APIError.invalidResponse
    }

    if httpResponse.statusCode == 401 {
        // Token expired, refresh it
        try await refreshToken()
        // Retry request
        return try await makeAuthenticatedRequest(url: url)
    }

    return data
}
```

### Upload Image
```swift
func uploadAvatar(imageData: Data) async throws -> String {
    let url = URL(string: "\(baseURL)/api/mobile/upload/avatar")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"

    let boundary = UUID().uuidString
    request.setValue("multipart/form-data; boundary=\(boundary)",
                     forHTTPHeaderField: "Content-Type")

    let token = KeychainHelper.get("access_token")
    request.setValue("Bearer \(token)",
                     forHTTPHeaderField: "Authorization")

    var body = Data()
    body.append("--\(boundary)\r\n")
    body.append("Content-Disposition: form-data; name=\"file\"; filename=\"avatar.jpg\"\r\n")
    body.append("Content-Type: image/jpeg\r\n\r\n")
    body.append(imageData)
    body.append("\r\n--\(boundary)--\r\n")

    request.httpBody = body

    let (data, _) = try await URLSession.shared.data(for: request)
    let response = try JSONDecoder().decode(UploadResponse.self, from: data)

    return response.url
}
```

## Rate Limits

Currently no rate limits enforced. Recommended client-side limits:
- Authentication: 5 requests/minute
- API calls: 100 requests/minute
- Image uploads: 10 requests/minute

## Best Practices

1. **Store tokens securely** - Use iOS Keychain
2. **Implement token refresh** - Before expiry (15 min)
3. **Handle offline mode** - Queue requests, sync later
4. **Validate before upload** - Check file size/type client-side
5. **Use HTTPS** - Always in production
6. **Clear tokens on logout** - Security best practice

## Testing

Use these test credentials (development only):
```
Email: test@fitcircle.app
Password: TestPassword123
```

Test invite code for joining circles:
```
ABC123XYZ
```

## Support

- Setup Guide: MOBILE_API_SETUP.md
- Full Documentation: MOBILE_API_IMPLEMENTATION_SUMMARY.md
- Base URL (dev): http://localhost:3000
- Base URL (prod): https://fitcircle.app

## Version

API Version: 1.0.0
Last Updated: October 11, 2025
