# Beverage Logging API Quick Reference

Quick reference for iOS developers integrating with the beverage logging backend.

---

## Base URL

```
https://your-domain.com/api/mobile/beverages
```

---

## Authentication

All endpoints require JWT authentication:

```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Endpoints

### 1. Create Beverage Entry

**POST** `/api/mobile/beverages`

**Request Body:**
```json
{
  "category": "coffee",
  "beverage_type": "Latte",
  "volume_ml": 355,
  "customizations": {
    "size": "medium",
    "temperature": "hot",
    "milk_type": "oat",
    "shots": 2
  },
  "calories": 150,
  "caffeine_mg": 150,
  "sugar_g": 12.5,
  "notes": "Optional notes",
  "is_favorite": false,
  "logged_at": "2025-11-14T10:30:00Z",
  "entry_date": "2025-11-14",
  "source": "ios"
}
```

**Required Fields:**
- `category` (see categories below)
- `beverage_type` (string)
- `volume_ml` (integer, 1-10000)

**Optional Fields:**
- `customizations` (object)
- `calories` (integer, 0-5000)
- `caffeine_mg` (integer, 0-1000)
- `sugar_g` (decimal, 0-500)
- `notes` (string, max 2000 chars)
- `is_favorite` (boolean)
- `favorite_name` (string, required if is_favorite=true)
- `is_private` (boolean, default: true)
- `logged_at` (ISO datetime, default: now)
- `entry_date` (ISO date, default: today)
- `source` (string, use "ios")

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "category": "coffee",
    "beverage_type": "Latte",
    "volume_ml": 355,
    "customizations": { ... },
    "calories": 150,
    "caffeine_mg": 150,
    "sugar_g": 12.5,
    "notes": "Optional notes",
    "is_favorite": false,
    "favorite_name": null,
    "is_private": true,
    "logged_at": "2025-11-14T10:30:00Z",
    "entry_date": "2025-11-14",
    "source": "ios",
    "metadata": {},
    "created_at": "2025-11-14T10:30:00Z",
    "updated_at": "2025-11-14T10:30:00Z",
    "deleted_at": null
  },
  "meta": {
    "requestTime": 123
  },
  "error": null
}
```

---

### 2. Get Beverage List

**GET** `/api/mobile/beverages`

**Query Parameters:**
- `page` (integer, default: 1)
- `limit` (integer, default: 20, max: 100)
- `category` (string, one of the categories or "all")
- `start_date` (ISO date, e.g., "2025-11-01")
- `end_date` (ISO date, e.g., "2025-11-14")
- `favorites_only` (boolean, "true" or "false")

**Example Requests:**
```
GET /api/mobile/beverages
GET /api/mobile/beverages?page=1&limit=20
GET /api/mobile/beverages?category=coffee
GET /api/mobile/beverages?start_date=2025-11-01&end_date=2025-11-14
GET /api/mobile/beverages?favorites_only=true
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "category": "coffee",
      "beverage_type": "Latte",
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "hasMore": true
  },
  "meta": {
    "requestTime": 145
  },
  "error": null
}
```

---

### 3. Get Single Beverage

**GET** `/api/mobile/beverages/:id`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "entry": {
      "id": "uuid",
      "category": "coffee",
      ...
    },
    "canEdit": true
  },
  "meta": {
    "requestTime": 89
  },
  "error": null
}
```

---

### 4. Update Beverage

**PATCH** `/api/mobile/beverages/:id`

**Request Body:**
```json
{
  "notes": "Updated notes",
  "is_favorite": true,
  "favorite_name": "My Morning Latte"
}
```

**Updatable Fields:**
- `beverage_type`
- `customizations`
- `volume_ml`
- `calories`
- `caffeine_mg`
- `sugar_g`
- `notes`
- `is_favorite`
- `favorite_name`
- `is_private`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    ...
  },
  "meta": {
    "requestTime": 112
  },
  "error": null
}
```

---

### 5. Delete Beverage

**DELETE** `/api/mobile/beverages/:id`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "entryId": "uuid"
  },
  "meta": {
    "requestTime": 78
  },
  "error": null
}
```

---

### 6. Get Statistics

**GET** `/api/mobile/beverages/stats`

**Query Parameters:**
- `start_date` (ISO date, default: 7 days ago)
- `end_date` (ISO date, default: today)

**Example Requests:**
```
GET /api/mobile/beverages/stats
GET /api/mobile/beverages/stats?start_date=2025-11-01&end_date=2025-11-14
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "total_entries": 42,
    "by_category": {
      "water": 20,
      "coffee": 15,
      "tea": 7
    },
    "total_volume_ml": 15000,
    "total_water_ml": 10000,
    "total_caffeine_mg": 1200,
    "total_calories": 3500,
    "total_sugar_g": 250.5,
    "avg_daily_entries": 3.2,
    "avg_daily_water_ml": 1428,
    "streak_days": 14,
    "favorite_count": 5,
    "most_common_beverage": {
      "beverage_type": "Water",
      "category": "water",
      "count": 20
    }
  },
  "date_range": {
    "start_date": "2025-11-01",
    "end_date": "2025-11-14"
  },
  "meta": {
    "requestTime": 234
  },
  "error": null
}
```

---

## Beverage Categories

Valid values for the `category` field:

- `water` - Plain water, sparkling water
- `coffee` - All coffee drinks
- `tea` - All tea varieties
- `smoothie` - Fruit/vegetable smoothies
- `protein_shake` - Protein shakes
- `juice` - Fruit/vegetable juices
- `soda` - Soft drinks
- `alcohol` - Alcoholic beverages
- `energy_drink` - Energy drinks
- `sports_drink` - Sports/electrolyte drinks
- `milk` - Dairy and plant-based milk
- `other` - Everything else

---

## Customization Fields

Common customization properties (all optional):

```json
{
  "size": "small" | "medium" | "large" | "extra_large",
  "temperature": "hot" | "cold" | "iced" | "room_temp",
  "milk_type": "whole" | "skim" | "2_percent" | "oat" | "almond" | "soy" | "coconut" | "none",
  "sweetener": "sugar" | "honey" | "stevia" | "none",
  "add_ins": ["cinnamon", "vanilla", "protein powder"],
  "ice": true | false,
  "shots": 2,
  "flavor": "vanilla"
}
```

You can add any custom properties you need!

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token",
    "details": {},
    "timestamp": "2025-11-14T10:30:00Z"
  },
  "meta": null
}
```

### 400 Validation Error
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "volume_ml": "Number must be greater than or equal to 1",
      "category": "Invalid enum value"
    },
    "timestamp": "2025-11-14T10:30:00Z"
  },
  "meta": null
}
```

### 404 Not Found
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Entry not found or access denied",
    "details": {},
    "timestamp": "2025-11-14T10:30:00Z"
  },
  "meta": null
}
```

### 500 Server Error
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INTERNAL_SERVER_ERROR",
    "message": "An unexpected error occurred",
    "details": {},
    "timestamp": "2025-11-14T10:30:00Z"
  },
  "meta": null
}
```

---

## iOS Implementation Tips

### 1. Creating a Simple Water Entry
```swift
let waterEntry: [String: Any] = [
    "category": "water",
    "beverage_type": "Water",
    "volume_ml": 500
]
```

### 2. Creating a Coffee with Customizations
```swift
let latteEntry: [String: Any] = [
    "category": "coffee",
    "beverage_type": "Latte",
    "volume_ml": 355,
    "customizations": [
        "size": "medium",
        "temperature": "hot",
        "milk_type": "oat",
        "shots": 2
    ],
    "calories": 150,
    "caffeine_mg": 150
]
```

### 3. Saving a Favorite
```swift
let favoriteEntry: [String: Any] = [
    "category": "coffee",
    "beverage_type": "Iced Vanilla Latte",
    "volume_ml": 473,
    "customizations": [
        "size": "large",
        "temperature": "iced",
        "milk_type": "almond",
        "flavor": "vanilla",
        "ice": true
    ],
    "is_favorite": true,
    "favorite_name": "My Favorite Iced Latte",
    "calories": 200,
    "caffeine_mg": 200
]
```

### 4. Fetching Recent Beverages
```swift
let url = URL(string: "https://your-domain.com/api/mobile/beverages?limit=50")!
var request = URLRequest(url: url)
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
```

### 5. Fetching Water Only
```swift
let url = URL(string: "https://your-domain.com/api/mobile/beverages?category=water")!
```

### 6. Fetching Today's Stats
```swift
let today = ISO8601DateFormatter().string(from: Date()).prefix(10)
let url = URL(string: "https://your-domain.com/api/mobile/beverages/stats?start_date=\(today)&end_date=\(today)")!
```

### 7. Pagination Example
```swift
// First page
GET /api/mobile/beverages?page=1&limit=20

// Check response.pagination.hasMore
if hasMore {
    // Load next page
    GET /api/mobile/beverages?page=2&limit=20
}
```

---

## Caching Recommendations

- **List endpoint:** Cache for 1 minute (server sends Cache-Control header)
- **Stats endpoint:** Cache for 5 minutes
- **Single entry:** No cache (always fresh)
- **After create/update/delete:** Invalidate list and stats cache

---

## Testing Checklist

- [ ] Create water entry
- [ ] Create coffee with customizations
- [ ] Fetch beverage list
- [ ] Filter by category
- [ ] Filter by date range
- [ ] Fetch single beverage
- [ ] Update beverage notes
- [ ] Save as favorite
- [ ] Fetch favorites only
- [ ] Delete beverage
- [ ] Get today's stats
- [ ] Get weekly stats
- [ ] Test pagination
- [ ] Test offline queue
- [ ] Test error handling

---

**Need help?** Check the full implementation guide: `BEVERAGE_LOGGING_IMPLEMENTATION.md`
