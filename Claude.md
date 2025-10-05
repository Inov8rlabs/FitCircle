# Claude Development Guidelines for FitCircle

## Critical Project Rules

### 🚫 **NEVER COMMIT CODE WITHOUT EXPLICIT PERMISSION**

**IMPORTANT:** Do NOT run `git commit` or `git push` commands unless the user explicitly asks you to commit and push the code.

- ❌ Do NOT auto-commit after completing a feature
- ❌ Do NOT commit "for convenience"
- ❌ Do NOT assume the user wants changes committed
- ✅ ONLY commit when the user explicitly says "commit" or "push"
- ✅ Wait for user approval before any git operations

### 🚫 **NEVER USE STORED PROCEDURES**

**Important:** All business logic MUST be implemented in the backend (Next.js API routes and service layers). Do NOT create PostgreSQL stored procedures, functions, or triggers for business logic.

#### Why No Stored Procedures?

- ❌ Business logic split between database and application
- ❌ Harder to test and debug
- ❌ Vendor lock-in to PostgreSQL
- ❌ Difficult to version control
- ❌ No easy logging/monitoring
- ❌ TypeScript type safety lost

#### What To Do Instead

✅ **Implement all business logic in TypeScript:**

1. **Service Layer** (`/apps/web/app/lib/services/`)
   - Create service classes for business logic
   - Example: `challenge-service.ts`, `user-service.ts`, `leaderboard-service.ts`

2. **API Routes** (`/apps/web/app/api/`)
   - Handle HTTP requests
   - Call service layer methods
   - Return responses

3. **Simple RLS Policies** (Database)
   - Keep RLS policies simple: only check `auth.uid()`
   - No complex logic or function dependencies
   - Just basic authentication checks

#### Example Pattern

```typescript
// ✅ CORRECT: Business logic in service layer
// /apps/web/app/lib/services/challenge-service.ts
export class ChallengeService {
  static async updateParticipantCount(challengeId: string, increment: boolean) {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('challenges')
      .select('participant_count')
      .eq('id', challengeId)
      .single();

    const newCount = increment
      ? (data.participant_count || 0) + 1
      : Math.max((data.participant_count || 0) - 1, 0);

    await supabaseAdmin
      .from('challenges')
      .update({ participant_count: newCount })
      .eq('id', challengeId);
  }
}

// ✅ CORRECT: Call from API route
// /apps/web/app/api/challenges/[id]/join/route.ts
export async function POST(request: NextRequest) {
  // ... authentication ...
  await ChallengeService.updateParticipantCount(challengeId, true);
  return NextResponse.json({ success: true });
}
```

```sql
-- ❌ WRONG: Don't create stored procedures like this
CREATE FUNCTION increment_participant_count(challenge_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE challenges SET participant_count = participant_count + 1
  WHERE id = challenge_id;
END;
$$ LANGUAGE plpgsql;
```

### Database Guidelines

#### ✅ What's Allowed in Database

1. **Tables and Schemas** - Define your data structure
2. **Indexes** - For performance optimization
3. **Foreign Keys & Constraints** - For data integrity
4. **Simple Triggers** - ONLY for:
   - Automatic timestamps (`updated_at`)
   - Simple audit logging
5. **Basic RLS Policies** - ONLY for:
   - Authentication checks: `auth.uid() = user_id`
   - Simple ownership checks

#### ❌ What's NOT Allowed in Database

1. **Stored Procedures** - Business logic
2. **Complex Functions** - Data processing/calculations
3. **RLS Helper Functions** - Use direct checks instead
4. **Database Cron Jobs** - Use API cron endpoints instead

### Cron Jobs Pattern

```typescript
// ✅ CORRECT: API endpoint for scheduled tasks
// /apps/web/app/api/cron/daily-updates/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ChallengeService.processDailyUpdates();
  return NextResponse.json({ success: true });
}

// Setup in vercel.json:
{
  "crons": [{
    "path": "/api/cron/daily-updates",
    "schedule": "0 0 * * *"
  }]
}
```

```sql
-- ❌ WRONG: Don't use database cron
SELECT cron.schedule('job-name', '0 0 * * *', 'SELECT my_function()');
```

## Technology Stack

### Backend
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **ORM:** Supabase Client (direct queries, no ORM)

### Frontend
- **Framework:** React 19
- **Styling:** Tailwind CSS
- **UI Components:** Radix UI + Custom components
- **Animations:** Framer Motion
- **Charts:** Recharts
- **Forms:** React Hook Form + Zod validation
- **State:** Zustand
- **Theme:** Dark mode (forced) with bright accent colors
- **Design System:** Circular progress meters inspired by Apple Fitness/Google Fit

### Architecture
- **Monorepo:** Turborepo with workspaces
- **Package Manager:** Bun (preferred), npm (fallback)
- **Deployment:** Vercel

## Project Structure

```
/apps/web/
  /app/
    /api/                    # API routes
      /cron/                 # Scheduled job endpoints
      /challenges/           # Challenge endpoints
    /lib/
      /services/             # ✅ Business logic HERE
    /components/
    /stores/                 # Zustand stores

/supabase/
  /migrations/               # Database schema ONLY
    001_initial_schema.sql   # Tables, indexes, constraints
    002_rls_policies.sql     # Simple RLS policies
    005_daily_tracking.sql   # New tables as needed

/docs/                       # Documentation
```

## Database Migration History

- ✅ `001_initial_schema.sql` - Core tables
- ✅ `002_rls_policies.sql` - RLS policies (cleaned up)
- ❌ `003_functions_procedures.sql` - **REMOVED** (violated no-stored-proc rule)
- ❌ `004_stored_procedures.sql` - **REMOVED** (violated no-stored-proc rule)
- ✅ `005_daily_tracking.sql` - Simple daily tracking table
- ✅ `006_remove_stored_procedures_v3.sql` - Cleanup migration

## Core Features Implemented

1. ✅ User authentication (Supabase Auth)
2. ✅ User registration with onboarding flow
3. ✅ Celebration animation on onboarding complete
4. ✅ Dashboard with daily stats
5. ✅ Daily check-ins (weight, steps, mood, energy)
6. ✅ Trend visualization with line charts
7. ✅ Data persistence to `daily_tracking` table
8. ✅ Dark theme with bright accent colors (forced dark mode)
9. ✅ Circular progress meters inspired by Apple Fitness/Google Fit
10. ✅ Activity rings for comprehensive progress tracking
11. ✅ Circular sliders for mood and energy input

## To-Do / Future Features

- [ ] FitCircles - Friend groups with shared goals
- [ ] Leaderboards for FitCircles
- [ ] Challenge creation and management
- [ ] Team formation and competition
- [ ] Photo uploads for check-ins
- [ ] Achievement system
- [ ] Notifications
- [ ] Payment integration (Stripe)

## Development Commands

```bash
# Start dev server
npm run dev

# Install dependencies (use npm, not bun for this workspace)
npm install <package>

# Add Radix UI component
npm install @radix-ui/react-<component>

# Database migrations
# Run in Supabase SQL Editor manually
```

## Common Patterns

### Creating a New Feature

1. **Database Schema** (if needed)
   ```sql
   -- In new migration file
   CREATE TABLE feature_name (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES profiles(id),
     -- ... other fields
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   -- Simple RLS
   CREATE POLICY "Users can view own data"
     ON feature_name FOR SELECT
     USING (auth.uid() = user_id);
   ```

2. **Service Layer**
   ```typescript
   // /apps/web/app/lib/services/feature-service.ts
   export class FeatureService {
     static async createFeature(userId: string, data: any) {
       // Business logic here
     }
   }
   ```

3. **API Route**
   ```typescript
   // /apps/web/app/api/features/route.ts
   export async function POST(request: NextRequest) {
     // Auth check
     // Call service
     // Return response
   }
   ```

4. **Frontend Component**
   ```typescript
   // /apps/web/app/components/FeatureComponent.tsx
   'use client';
   // Component logic
   ```

## Key Learnings

1. **Always verify auth in middleware** - Don't rely on RLS alone
2. **Use service layer** - Keep API routes thin
3. **Type everything** - Leverage TypeScript
4. **Test the happy path first** - Get it working, then add edge cases
5. **Use admin client for service layer** - After verifying auth in API routes
6. **Keep RLS simple** - Only check ownership/authentication
7. **All business logic in backend** - NEVER in database stored procedures

## Environment Variables

Required in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Optional
CRON_SECRET=  # For protecting cron endpoints
```

## Migration Lessons Learned

### The Stored Procedure Migration (v006)

**Problem:** Initial schema included stored procedures that:
- Made debugging difficult
- Created dependency issues with RLS policies
- Violated the "logic in backend" principle

**Solution:**
1. Drop ALL RLS policies first (they depend on functions)
2. Drop all functions
3. Recreate simple policies without function dependencies
4. Move all logic to TypeScript service layer

**Key Takeaway:** Always check policy dependencies before dropping functions. Use this pattern:
```sql
-- Step 1: Drop policies
DROP POLICY IF EXISTS "policy_name" ON table_name;

-- Step 2: Drop functions
DROP FUNCTION IF EXISTS function_name();

-- Step 3: Create new simple policies
CREATE POLICY "new_policy" ON table_name
  USING (auth.uid() = user_id);
```

## Design Philosophy

**Dark Theme with Bright Accents**:
- Primary background: Slate-950/900 gradients
- Accent colors: Cyan (#06b6d4), Purple (#8b5cf6), Orange (#f97316), Green (#10b981)
- Subtle translucent circle backgrounds for depth
- Glass-morphism cards with backdrop blur
- Forced dark mode for consistency

**Circular Progress Design**:
- Inspired by Apple Watch Activity Rings and Google Fit
- Activity rings showing multiple metrics at once
- Individual circular progress meters for each stat
- Circular sliders for interactive input (mood/energy)
- All progress visualizations use circular/ring patterns

**Brand Colors**:
- **Indigo** (#6366f1): Steps tracking, info states, accents
- **Purple** (#8b5cf6): Weight tracking, achievements, primary CTA buttons
- **Orange** (#f97316): Streaks, energy levels
- **Green** (#10b981): Success states, check-ins

---

**Last Updated:** 2025-10-04
**Project Status:** Active Development
**Primary Developer:** Ani (with Claude assistance)
