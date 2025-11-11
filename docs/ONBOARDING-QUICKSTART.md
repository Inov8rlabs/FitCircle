# FitCircle Onboarding API - Quick Start Guide

**For iOS Developers**

This guide will help you quickly integrate the FitCircle onboarding API into your iOS app.

## Table of Contents

1. [Setup](#setup)
2. [API Base URL](#api-base-url)
3. [Authentication](#authentication)
4. [Onboarding Flow](#onboarding-flow)
5. [Example Code](#example-code)
6. [Testing](#testing)

---

## Setup

### 1. Apply Database Migration

First, apply the database schema in Supabase:

1. Go to Supabase Dashboard → SQL Editor
2. Open `/supabase/migrations/032_onboarding_system.sql`
3. Copy the entire file contents
4. Paste into SQL Editor
5. Click "Run"

You should see: "Success. No rows returned"

### 2. Verify Tables Created

Run this query to verify:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_name IN ('onboarding_progress', 'user_goals', 'user_achievements');
```

You should see all 3 tables.

---

## API Base URL

**Development:** `http://localhost:3000/api`
**Production:** `https://your-domain.vercel.app/api`

---

## Authentication

All onboarding endpoints require authentication. Get the access token from the login/register endpoints:

```swift
// After login or registration
let accessToken = authResponse.session.accessToken

// Use in all API calls
request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
```

---

## Onboarding Flow

### Step-by-Step Integration

#### Screen 1: Welcome & Email Login

Use existing auth endpoints:
- `POST /api/mobile/auth/register`
- `POST /api/mobile/auth/login`

#### Screen 2: Questionnaire (Persona Detection)

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

**Response:**
```json
{
  "success": true,
  "data": {
    "persona": {
      "primary": "casey",
      "description": "You're a competitive achiever...",
      "recommendations": [...]
    }
  }
}
```

**Save:** Store `persona.primary` for later steps.

#### Screen 3: Meet Fitzy

Get personalized welcome message:

```swift
// Use PersonaService.getFitzyWelcomeMessage() on backend
// Or construct message based on persona:

let messages = [
  "casey": "Hey there, champion! 💪...",
  "sarah": "Welcome to the family! 🤗...",
  "mike": "Hi there! 📊...",
  "fiona": "What's up, athlete! 🔥..."
]

let message = messages[persona] ?? "Welcome!"
```

#### Screen 4: Profile Setup

```http
POST /api/onboarding/profile
Authorization: Bearer <token>
Content-Type: application/json

{
  "displayName": "John Doe",
  "username": "johndoe",
  "avatarUrl": "https://...",
  "bio": "Getting fit!"
}
```

#### Screen 5: Set Goals

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
  }
}
```

#### Screen 6: First Check-In

```http
POST /api/onboarding/first-checkin
Authorization: Bearer <token>
Content-Type: application/json

{
  "weight": 180,
  "height": 72,
  "mood": 4,
  "energy": 3,
  "unit": "lbs"
}
```

#### Screen 7: Complete Onboarding

```http
POST /api/onboarding/complete
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "totalXp": 250,
      "currentLevel": 1
    },
    "achievement": {
      "name": "Getting Started",
      "description": "Completed onboarding!",
      "xpAwarded": 250
    }
  }
}
```

**Show:** Celebration animation with achievement badge!

---

## Example Code

### Swift Example: Persona Detection

```swift
struct QuestionnaireAnswers: Codable {
    let primaryGoal: String
    let motivationStyle: String
    let fitnessLevel: String
    let timeCommitment: String
}

struct PersonaResponse: Codable {
    let success: Bool
    let data: PersonaData
}

struct PersonaData: Codable {
    let persona: Persona
}

struct Persona: Codable {
    let primary: String
    let secondary: String?
    let description: String
    let recommendations: [String]
}

func submitQuestionnaire(answers: QuestionnaireAnswers) async throws -> Persona {
    let url = URL(string: "\(baseURL)/onboarding/persona")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    request.httpBody = try JSONEncoder().encode(answers)

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw APIError.badResponse
    }

    let result = try JSONDecoder().decode(PersonaResponse.self, from: data)
    return result.data.persona
}

// Usage
let answers = QuestionnaireAnswers(
    primaryGoal: "lose_weight",
    motivationStyle: "competition",
    fitnessLevel: "intermediate",
    timeCommitment: "30-60"
)

let persona = try await submitQuestionnaire(answers: answers)
print("Detected persona: \(persona.primary)")
print("Description: \(persona.description)")
```

### Swift Example: Create Goals

```swift
struct GoalsRequest: Codable {
    let weightGoal: WeightGoal?
    let stepsGoal: StepsGoal?
}

struct WeightGoal: Codable {
    let currentWeight: Double
    let targetWeight: Double
    let targetDate: String?
    let unit: String
}

struct StepsGoal: Codable {
    let dailySteps: Int
}

func createGoals(request: GoalsRequest) async throws {
    let url = URL(string: "\(baseURL)/onboarding/goals")!
    var urlRequest = URLRequest(url: url)
    urlRequest.httpMethod = "POST"
    urlRequest.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

    urlRequest.httpBody = try JSONEncoder().encode(request)

    let (_, response) = try await URLSession.shared.data(for: urlRequest)

    guard let httpResponse = response as? HTTPURLResponse,
          httpResponse.statusCode == 200 else {
        throw APIError.badResponse
    }
}
```

---

## Progress Saving & Resume

### Save Progress

Save user's progress at each step so they can resume if they close the app:

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

### Resume Onboarding

When user reopens the app:

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
      "currentStep": 3,
      "completedSteps": [1, 2, 3],
      "questionnaireAnswers": {...}
    }
  }
}
```

If `progress` is `null`, they either haven't started or have completed onboarding.

---

## Persona-Specific Flows

After detecting persona, customize the experience:

### Casey (Competitive) Flow

1. Show competitive challenges
2. Emphasize prizes and leaderboards
3. Suggest joining high-stakes challenges

**API:** `GET /api/challenges/beginner`

### Sarah (Social) Flow

1. Prompt to create FitCircle with friends
2. Show invite flow
3. Suggest joining popular FitCircles

**API:**
- `POST /api/fitcircles/create`
- `GET /api/fitcircles/suggested`

### Mike (Practical) Flow

1. Show quick setup options
2. Emphasize progress tracking
3. Suggest beginner challenges

**API:** `GET /api/challenges/beginner`

### Fiona (Fitness Fanatic) Flow

1. Show advanced workout challenges
2. Emphasize intensity and metrics
3. Suggest multiple goal tracking

**API:** `GET /api/challenges/beginner` (filter for advanced)

---

## Testing

### 1. Test Persona Detection

```bash
curl -X POST http://localhost:3000/api/onboarding/persona \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "primaryGoal": "lose_weight",
    "motivationStyle": "competition",
    "fitnessLevel": "intermediate",
    "timeCommitment": "30-60"
  }'
```

Expected: `"primary": "casey"`

### 2. Test Goal Creation

```bash
curl -X POST http://localhost:3000/api/onboarding/goals \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "weightGoal": {
      "currentWeight": 180,
      "targetWeight": 165,
      "targetDate": "2025-03-01",
      "unit": "lbs"
    }
  }'
```

### 3. Test Complete Onboarding

```bash
curl -X POST http://localhost:3000/api/onboarding/complete \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: 250 XP awarded

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "primaryGoal": "Invalid enum value"
    },
    "timestamp": "2025-11-11T10:00:00Z"
  }
}
```

### Handle Errors in Swift

```swift
struct APIError: Codable {
    let code: String
    let message: String
    let details: [String: String]?
}

struct ErrorResponse: Codable {
    let success: Bool
    let error: APIError?
}

// Parse error
if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data),
   let error = errorResponse.error {
    print("Error: \(error.message)")

    switch error.code {
    case "UNAUTHORIZED":
        // Re-authenticate
    case "VALIDATION_ERROR":
        // Show field-specific errors
        if let details = error.details {
            for (field, message) in details {
                print("\(field): \(message)")
            }
        }
    case "USERNAME_TAKEN":
        // Show username taken message
    default:
        // Generic error
    }
}
```

---

## Common Issues

### Issue 1: "Unauthorized" Error

**Cause:** Token expired or invalid
**Solution:** Re-authenticate user

### Issue 2: "Username Already Taken"

**Cause:** Username exists
**Solution:** Prompt user to choose different username

### Issue 3: "Validation Error"

**Cause:** Invalid input data
**Solution:** Check `error.details` for specific field errors

---

## Next Steps

1. ✅ Apply database migration
2. ✅ Test endpoints with curl/Postman
3. ✅ Integrate into iOS app
4. ✅ Test onboarding flow end-to-end
5. ✅ Deploy to production

---

## Resources

- **Full API Documentation:** `/docs/ONBOARDING-API.md`
- **Implementation Summary:** `/docs/ONBOARDING-IMPLEMENTATION-SUMMARY.md`
- **Design Document:** `/docs/ONBOARDING-FLOW-DESIGN.md`
- **Service Layer Code:** `/apps/web/app/lib/services/`
- **API Routes:** `/apps/web/app/api/onboarding/`

---

## Support

For questions or issues:
1. Check `/docs/ONBOARDING-API.md` for detailed API reference
2. Review `/docs/ONBOARDING-FLOW-DESIGN.md` for UX flow
3. Test endpoints in isolation before integrating

---

**Happy coding! 🚀**
