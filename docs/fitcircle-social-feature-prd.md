# FitCircle Social Feature - Product Requirements Document

**Version 1.0 | Created: 2025-10-04**
**Product Manager: FitCircle PM Team**
**Status: Planning**

---

## Table of Contents

1. [Feature Vision & Strategy](#feature-vision--strategy)
2. [User Stories & Journeys](#user-stories--journeys)
3. [Core Features Specification](#core-features-specification)
4. [Technical Requirements](#technical-requirements)
5. [Implementation Plan](#implementation-plan)
6. [Gap Analysis](#gap-analysis)
7. [Success Metrics](#success-metrics)
8. [Risks & Mitigations](#risks--mitigations)

---

## Feature Vision & Strategy

### Problem Statement

FitCircle currently lacks the social infrastructure that drives engagement in leading fitness platforms. While we have basic challenges and leaderboards, users cannot:
- Connect with friends beyond challenge participation
- See real-time activity from their network
- Provide encouragement and support outside of challenges
- Discover new circles through social connections
- Build lasting fitness relationships

**Competitor Benchmarks:**
- **Strava**: 58% of users made new friends through clubs; groups see 95% more kudos than solo activities
- **Peloton**: Teams of up to 50,000 members with shared leaderboards and @mentions
- **Nike Run Club**: Live run sharing, friend challenges, community leaderboards

### User Value Proposition

**"Turn fitness into a social adventure where every workout counts, every achievement is celebrated, and every friend makes you stronger."**

FitCircle's social features will create:
1. **Accountability Through Connection**: Friends see your progress, creating positive peer pressure
2. **Celebration Culture**: Every achievement gets recognized with reactions and comments
3. **Competitive Camaraderie**: Compete with friends while supporting each other
4. **Discovery & Growth**: Find new circles and challenges through your network
5. **Real-time Engagement**: Live activity updates keep the community active 24/7

### Success Metrics (KPIs)

| Metric | Current | Target (3 months) | Target (6 months) |
|--------|---------|-------------------|-------------------|
| **Friend Connections per User** | 0 | 5 | 12 |
| **Daily Social Actions** | 0 | 3.5 | 7.2 |
| **Viral Coefficient (K-factor)** | 0.1 | 0.6 | 1.2 |
| **Social-driven DAU** | 5% | 35% | 60% |
| **Activity Feed Engagement Rate** | N/A | 45% | 65% |

### Competitive Positioning

**Our Differentiation:**
- **Holistic Competition**: Unlike Strava (running/cycling only), we track weight, steps, workouts, mood
- **Fair Matchmaking**: AI-balanced teams vs Peloton's open groups
- **Financial Stakes**: Real money competitions vs Nike's badges-only system
- **Integrated Coaching**: AI coach Fitzy provides personalized guidance within social context

---

## User Stories & Journeys

### Epic 1: Friend Discovery & Connection

**User Story 1.1: Find Friends**
```
As a new user, I want to find my existing friends on FitCircle
So that I can start my fitness journey with people I know

Acceptance Criteria:
- GIVEN I'm on the friends page
- WHEN I tap "Find Friends"
- THEN I see options for: contacts sync, search by name/email, QR code, social media import
- AND I can send friend requests in bulk
- AND I see which contacts are already on FitCircle
```

**User Story 1.2: Accept Friend Requests**
```
As a user receiving friend requests, I want to review and manage requests
So that I can control my social network

Acceptance Criteria:
- GIVEN I have pending friend requests
- WHEN I open the notifications tab
- THEN I see all pending requests with user profiles
- AND I can accept, decline, or block requests
- AND accepted friends immediately appear in my friends list
```

**User Story 1.3: Privacy Controls**
```
As a privacy-conscious user, I want to control who sees my activity
So that I feel safe sharing my fitness journey

Acceptance Criteria:
- GIVEN I'm in privacy settings
- WHEN I configure my preferences
- THEN I can set visibility for: weight, photos, achievements, activity
- AND I can choose between: Public, Friends Only, Private
- AND I can block specific users
```

### Epic 2: Activity Feed & Engagement

**User Story 2.1: View Activity Feed**
```
As an active user, I want to see my friends' fitness activities
So that I stay motivated and connected

Acceptance Criteria:
- GIVEN I open the app
- WHEN I navigate to the activity feed
- THEN I see a chronological feed of friends' activities
- AND each post shows: user, activity type, key metrics, timestamp
- AND I can filter by: all friends, close friends, circles
- AND new posts appear in real-time
```

**User Story 2.2: React to Activities**
```
As a supportive friend, I want to react to friends' achievements
So that I can encourage their progress

Acceptance Criteria:
- GIVEN I see a friend's check-in or achievement
- WHEN I tap the reaction button
- THEN I can choose from: 💪 (Strong), 🔥 (Fire), 🏆 (Champion), ❤️ (Love), 👏 (Applause), 🚀 (Rocket)
- AND my reaction appears instantly
- AND the friend receives a notification
```

**User Story 2.3: Comment on Activities**
```
As an engaged user, I want to comment on friends' posts
So that I can provide specific encouragement or advice

Acceptance Criteria:
- GIVEN I see a friend's activity
- WHEN I tap "Comment"
- THEN I can write a text comment (max 500 chars)
- AND I can @mention other friends
- AND comments appear in real-time
- AND participants get notified of new comments
```

### Epic 3: FitCircle Social Enhancements

**User Story 3.1: Circle Discovery**
```
As a user looking for challenges, I want to discover circles my friends are in
So that I can join communities I trust

Acceptance Criteria:
- GIVEN I'm browsing FitCircles
- WHEN I tap "Friends' Circles"
- THEN I see all circles my friends participate in
- AND I see how many friends are in each circle
- AND I can join directly or request invite
```

**User Story 3.2: Circle Chat**
```
As a circle member, I want to chat with my circle
So that we can coordinate and motivate each other

Acceptance Criteria:
- GIVEN I'm in an active circle
- WHEN I open the circle page
- THEN I see a chat tab
- AND I can send text messages and emojis
- AND I can share photos and achievements
- AND I receive push notifications for @mentions
```

**User Story 3.3: Circle Activity Feed**
```
As a circle member, I want to see my circle's activity
So that I stay engaged with the competition

Acceptance Criteria:
- GIVEN I'm viewing a circle
- WHEN I check the activity tab
- THEN I see all members' check-ins and progress
- AND I see leaderboard changes
- AND I can react/comment on circle activities
```

### Epic 4: Social Leaderboards

**User Story 4.1: Friends Leaderboard**
```
As a competitive user, I want to see how I rank against friends
So that I have ongoing motivation beyond specific challenges

Acceptance Criteria:
- GIVEN I have friends on FitCircle
- WHEN I view the Friends leaderboard
- THEN I see rankings based on: weekly points, total weight lost, streak days, challenges won
- AND I can toggle between time periods (week, month, all-time)
- AND I can challenge friends directly from the leaderboard
```

**User Story 4.2: Real-time Updates**
```
As a user watching leaderboards, I want to see live changes
So that I feel the excitement of competition

Acceptance Criteria:
- GIVEN I'm viewing any leaderboard
- WHEN someone's rank changes
- THEN I see an animated transition
- AND new check-ins appear with animation
- AND I get notified if I'm passed or pass someone
```

### Epic 5: Viral & Discovery Features

**User Story 5.1: Share Achievements**
```
As a proud user, I want to share my achievements
So that I can celebrate with my network and inspire others

Acceptance Criteria:
- GIVEN I complete an achievement
- WHEN I tap "Share"
- THEN I can share to: FitCircle feed, Instagram Stories, Facebook, X/Twitter
- AND shares include branded graphics with my stats
- AND shares have a join link for non-users
```

**User Story 5.2: Challenge Friends**
```
As a motivated user, I want to challenge friends directly
So that we can compete head-to-head

Acceptance Criteria:
- GIVEN I'm viewing a friend's profile
- WHEN I tap "Challenge"
- THEN I can create a 1v1 challenge with: type, duration, stakes
- AND the friend receives a notification
- AND accepted challenges appear in both users' active challenges
```

---

## Core Features Specification

### 3.1 Friend System

#### Database Schema
```sql
-- Friends/connections table
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  friend_id UUID NOT NULL REFERENCES profiles(id),
  status TEXT CHECK (status IN ('pending', 'accepted', 'blocked')),
  requester_id UUID REFERENCES profiles(id),
  became_friends_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  blocked_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Friend groups for filtering
CREATE TABLE friend_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  name TEXT NOT NULL,
  member_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Features
- **Discovery Methods**:
  - Phone contacts sync (permission-based)
  - Search by username/email
  - QR code for in-person connections
  - Facebook/Instagram friend import
  - Suggested friends based on mutual connections

- **Privacy Levels**:
  - Public: Anyone can send requests
  - Friends of Friends: Only mutual connections
  - Private: Only via invite code/QR

- **Friend Management**:
  - Categorize friends (Close Friends, Workout Buddies, etc.)
  - Bulk actions (invite, remove)
  - Friend activity preferences

### 3.2 Activity Feed

#### Database Schema
```sql
-- Activity feed events
CREATE TABLE activity_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'check_in', 'achievement', 'challenge_joined', 'challenge_completed',
    'milestone', 'friend_joined', 'circle_created', 'level_up'
  )),
  activity_data JSONB NOT NULL,
  visibility TEXT DEFAULT 'friends' CHECK (visibility IN ('public', 'friends', 'circle', 'private')),
  circle_id UUID REFERENCES challenges(id),
  related_user_id UUID REFERENCES profiles(id),
  media_urls TEXT[] DEFAULT '{}',
  reaction_counts JSONB DEFAULT '{}',
  comment_count INTEGER DEFAULT 0,
  is_highlighted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_activity_feed_user_created ON activity_feed(user_id, created_at DESC);
CREATE INDEX idx_activity_feed_visibility ON activity_feed(visibility, created_at DESC);
```

#### Feed Algorithm
**Chronological with Boosts** (not purely algorithmic to maintain transparency):
1. Base: Chronological order
2. Boost factors:
   - Close friends: 2x visibility window
   - High engagement posts: Extended visibility
   - Achievements: Highlighted for 24 hours
   - Circle members: Priority during active challenges

#### Activity Types
- **Check-ins**: Weight, steps, workouts with optional photos
- **Achievements**: Badges, milestones, personal records
- **Social**: Friend connections, circle joins
- **Competition**: Challenge starts/completions, rank changes
- **Celebrations**: Goal completions, streak milestones

### 3.3 FitCircle Enhancements

#### Additional Schema
```sql
-- Circle invitations
CREATE TABLE circle_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES challenges(id),
  inviter_id UUID NOT NULL REFERENCES profiles(id),
  invitee_id UUID REFERENCES profiles(id),
  invite_code TEXT UNIQUE DEFAULT substring(md5(random()::text), 1, 8),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circle messages
CREATE TABLE circle_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id UUID NOT NULL REFERENCES challenges(id),
  sender_id UUID NOT NULL REFERENCES profiles(id),
  message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'achievement', 'system')),
  content TEXT,
  media_url TEXT,
  mentioned_user_ids UUID[] DEFAULT '{}',
  is_pinned BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Discovery Features
- **Trending Circles**: Based on growth rate and engagement
- **Friends' Circles**: See all circles with friend participation
- **Recommended**: AI-based matching on goals and fitness level
- **Geographic**: Local circles and challenges
- **Categories**: Browse by type (weight loss, steps, etc.)

#### Circle Roles
- **Admin**: Creator, can modify settings
- **Moderator**: Can remove members, pin messages
- **Member**: Participate and engage
- **Observer**: View-only (for completed challenges)

### 3.4 Social Leaderboards

#### Types
1. **Global Friends Leaderboard**
   - All friends regardless of challenges
   - Metrics: Total points, weight lost, active days, challenges won
   - Time periods: Daily, Weekly, Monthly, All-time

2. **Circle Leaderboards**
   - Real-time websocket updates
   - Show position changes with animations
   - "Hot Streak" indicators for momentum

3. **Mini Leaderboards**
   - Widget showing top 3 friends
   - Quick challenge buttons
   - Daily motivation nudges

#### Leaderboard Features
- **Live Mode**: Real-time updates during active hours
- **Filters**: By metric, friend group, time period
- **Achievements**: Special badges for leaderboard positions
- **History**: Track position changes over time

### 3.5 Engagement Mechanics

#### Reactions System
```sql
-- Already exists in schema, but enhanced usage:
CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('activity', 'comment', 'achievement', 'check_in')),
  target_id UUID NOT NULL,
  reaction_type reaction_type NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, target_type, target_id)
);
```

**Reaction Types**:
- 💪 Strong (default for workouts)
- 🔥 Fire (streaks, intense workouts)
- 🏆 Champion (achievements, wins)
- ❤️ Love (support, encouragement)
- 👏 Applause (milestones, progress)
- 🚀 Rocket (personal records, breakthroughs)

#### Comments System
- Threading support for conversations
- @mentions with notifications
- Markdown support for formatting
- Auto-moderation for inappropriate content
- Edit window: 5 minutes

#### Nudges & Encouragement
- **Auto-prompts**: "John hasn't checked in for 2 days, send encouragement?"
- **Milestone alerts**: "Sarah is 1 lb from her goal, cheer her on!"
- **Challenge prompts**: "You're tied with Mike, challenge him to a sprint?"

---

## Technical Requirements

### 4.1 Database Schema Additions

#### New Tables Required
```sql
-- 1. Friendships table (see above)
-- 2. Friend groups table (see above)
-- 3. Activity feed table (see above)
-- 4. Circle invitations table (see above)
-- 5. Circle messages table (see above)

-- 6. Notification preferences
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id),
  friend_requests BOOLEAN DEFAULT true,
  friend_activity BOOLEAN DEFAULT true,
  reactions BOOLEAN DEFAULT true,
  comments BOOLEAN DEFAULT true,
  mentions BOOLEAN DEFAULT true,
  circle_updates BOOLEAN DEFAULT true,
  leaderboard_changes BOOLEAN DEFAULT true,
  daily_summary BOOLEAN DEFAULT false,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. User blocks
CREATE TABLE user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES profiles(id),
  blocked_id UUID NOT NULL REFERENCES profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);
```

#### Schema Modifications
```sql
-- Add to profiles table
ALTER TABLE profiles ADD COLUMN friend_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN activity_count INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN reactions_received INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN is_verified BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN friend_code TEXT UNIQUE DEFAULT substring(md5(random()::text), 1, 6);

-- Add to challenges table
ALTER TABLE challenges ADD COLUMN is_discoverable BOOLEAN DEFAULT true;
ALTER TABLE challenges ADD COLUMN friend_participant_ids UUID[] DEFAULT '{}';
ALTER TABLE challenges ADD COLUMN trending_score DECIMAL(5,2) DEFAULT 0;

-- Add indexes for performance
CREATE INDEX idx_friendships_status ON friendships(status);
CREATE INDEX idx_activity_feed_friends ON activity_feed(user_id, visibility, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
```

### 4.2 API Endpoints Required

#### Friend Management
```typescript
// Friend endpoints
POST   /api/friends/request         // Send friend request
POST   /api/friends/accept/:id      // Accept friend request
POST   /api/friends/decline/:id     // Decline friend request
DELETE /api/friends/:id             // Remove friend
GET    /api/friends                 // List friends
GET    /api/friends/pending         // List pending requests
POST   /api/friends/import          // Import from contacts/social
GET    /api/friends/suggestions     // Get friend suggestions
POST   /api/friends/block           // Block user
POST   /api/friends/groups          // Create friend group
GET    /api/friends/search          // Search for users
```

#### Activity Feed
```typescript
// Activity feed endpoints
GET    /api/feed                    // Get activity feed
GET    /api/feed/:userId           // Get user's activities
POST   /api/feed/activity          // Create activity (auto-generated)
DELETE /api/feed/:activityId       // Delete own activity
GET    /api/feed/circle/:circleId  // Get circle feed
```

#### Social Interactions
```typescript
// Reactions
POST   /api/reactions              // Add reaction
DELETE /api/reactions/:id          // Remove reaction
GET    /api/reactions/:targetId    // Get reactions for target

// Comments
POST   /api/comments               // Add comment
PUT    /api/comments/:id           // Edit comment
DELETE /api/comments/:id           // Delete comment
GET    /api/comments/:targetId     // Get comments for target

// Notifications
GET    /api/notifications          // Get notifications
PUT    /api/notifications/read     // Mark as read
PUT    /api/notifications/settings // Update preferences
```

#### Leaderboards
```typescript
// Leaderboard endpoints
GET    /api/leaderboards/friends          // Friends leaderboard
GET    /api/leaderboards/friends/:metric  // Specific metric
GET    /api/leaderboards/global           // Global leaderboard
GET    /api/leaderboards/circle/:id       // Circle leaderboard
GET    /api/leaderboards/live/:id         // Real-time updates
```

#### Circle Social Features
```typescript
// Circle enhancements
POST   /api/circles/:id/invite           // Invite to circle
GET    /api/circles/discover             // Discover circles
GET    /api/circles/trending             // Trending circles
GET    /api/circles/friends              // Friends' circles
POST   /api/circles/:id/messages         // Send message
GET    /api/circles/:id/messages         // Get messages
GET    /api/circles/:id/activity         // Get circle activity
```

### 4.3 Real-time Requirements

#### WebSocket Events (via Supabase Realtime)
```typescript
// Real-time subscriptions
interface RealtimeEvents {
  // Friend events
  'friend:request': { from: User };
  'friend:accepted': { friend: User };
  'friend:online': { friendId: string };

  // Activity events
  'activity:new': { activity: Activity };
  'activity:reaction': { reaction: Reaction };
  'activity:comment': { comment: Comment };

  // Leaderboard events
  'leaderboard:update': { rankings: LeaderboardEntry[] };
  'leaderboard:passed': { by: User; position: number };

  // Circle events
  'circle:message': { message: CircleMessage };
  'circle:member_joined': { member: User };
  'circle:member_progress': { update: ProgressUpdate };

  // Notifications
  'notification:new': { notification: Notification };
}
```

#### Performance Requirements
- Activity feed load: <500ms for 50 items
- Real-time updates: <100ms latency
- Notification delivery: <2 seconds
- Leaderboard updates: <200ms
- Search results: <300ms for 1000+ users

### 4.4 Frontend Components

#### New Components Needed

```typescript
// Core Social Components
<FriendsList />              // Display friends with online status
<FriendRequests />           // Manage pending requests
<FindFriends />              // Discovery interface
<UserSearch />               // Search with autocomplete

// Activity Feed
<ActivityFeed />             // Main feed component
<ActivityCard />             // Individual activity display
<ReactionPicker />           // Reaction selector
<CommentThread />            // Nested comments
<ShareModal />               // Share to social media

// Leaderboards
<FriendsLeaderboard />       // Global friend rankings
<LeaderboardCard />          // Compact leaderboard widget
<RankChange />               // Animated rank changes
<LiveLeaderboard />          // Real-time updating board

// Circle Social
<CircleDiscovery />          // Browse and search circles
<CircleChat />               // In-circle messaging
<CircleActivityFeed />       // Circle-specific feed
<InviteFriends />           // Invite flow

// Notifications
<NotificationBell />         // Header notification icon
<NotificationList />         // Notification center
<NotificationToast />        // Pop-up notifications
```

#### Component Architecture
```typescript
// Example: ActivityCard Component
interface ActivityCardProps {
  activity: Activity;
  showReactions?: boolean;
  showComments?: boolean;
  compact?: boolean;
  onReaction?: (type: ReactionType) => void;
  onComment?: () => void;
  onShare?: () => void;
}

// Features:
// - Optimistic updates for reactions
// - Lazy-load comments
// - Image carousel for photos
// - Relative timestamps with auto-update
// - Swipe actions on mobile
```

---

## Implementation Plan

### Sprint 1 (Week 1): Foundation
**Goal**: Establish core friend system and basic connections

#### Backend Tasks (3 days)
- [ ] Create friendships table and migrations
- [ ] Implement friend request/accept/decline API endpoints
- [ ] Add friend search functionality
- [ ] Create notification system for friend requests
- [ ] Add privacy settings to profiles
- [ ] Implement user blocking functionality

#### Frontend Tasks (2 days)
- [ ] Create FindFriends page
- [ ] Build FriendsList component
- [ ] Add friend request notifications
- [ ] Implement friend search UI
- [ ] Add privacy settings page

#### Testing & Polish (1 day)
- [ ] Test friend request flows
- [ ] Verify privacy controls
- [ ] Performance testing for friend queries

**Deliverables**:
- Users can find and add friends
- Friend requests with notifications
- Basic privacy controls
- Friend list display

**Success Criteria**:
- 50% of beta users add at least 1 friend
- <500ms friend search response time
- Zero friendship data inconsistencies

### Sprint 2 (Week 2): Activity Feed
**Goal**: Launch core activity feed with reactions

#### Backend Tasks (3 days)
- [ ] Create activity_feed table and indexes
- [ ] Implement activity generation on check-ins
- [ ] Build feed API with pagination
- [ ] Add reactions table and endpoints
- [ ] Create feed filtering logic

#### Frontend Tasks (2 days)
- [ ] Build ActivityFeed component
- [ ] Create ActivityCard with reactions
- [ ] Add real-time updates via WebSocket
- [ ] Implement infinite scroll
- [ ] Add feed filters UI

#### Testing & Polish (1 day)
- [ ] Load test feed with 10,000+ activities
- [ ] Verify real-time updates
- [ ] Test reaction animations

**Deliverables**:
- Functional activity feed showing friend activities
- 6 reaction types available
- Real-time feed updates
- Chronological feed with friend filtering

**Success Criteria**:
- 70% of users view feed daily
- Average 3+ reactions per user per day
- <500ms feed load time

### Sprint 3 (Week 3): Social Leaderboards
**Goal**: Implement friend and circle leaderboards with live updates

#### Backend Tasks (3 days)
- [ ] Create leaderboard aggregation queries
- [ ] Implement WebSocket channels for live updates
- [ ] Build leaderboard API endpoints
- [ ] Add position change tracking
- [ ] Create leaderboard caching layer

#### Frontend Tasks (2 days)
- [ ] Build FriendsLeaderboard page
- [ ] Create LiveLeaderboard component
- [ ] Add rank change animations
- [ ] Implement leaderboard widgets
- [ ] Add challenge buttons

#### Testing & Polish (1 day)
- [ ] Stress test with 1000+ simultaneous updates
- [ ] Verify calculation accuracy
- [ ] Test animation performance

**Deliverables**:
- Global friends leaderboard
- Circle-specific leaderboards
- Real-time rank updates
- Historical position tracking

**Success Criteria**:
- 60% of users check leaderboards weekly
- <200ms real-time update latency
- 100% calculation accuracy

### Sprint 4 (Week 4): Engagement & Polish
**Goal**: Add comments, circle chat, and viral features

#### Backend Tasks (2 days)
- [ ] Implement comments system with threading
- [ ] Add circle messaging functionality
- [ ] Create share-to-social endpoints
- [ ] Build friend invitation system
- [ ] Add achievement sharing

#### Frontend Tasks (2 days)
- [ ] Build CommentThread component
- [ ] Create CircleChat interface
- [ ] Add ShareModal for social sharing
- [ ] Implement invitation flows
- [ ] Create viral loops (share achievements)

#### Testing & Polish (2 days)
- [ ] Full end-to-end testing
- [ ] Performance optimization
- [ ] UI/UX polish based on feedback
- [ ] A/B test sharing mechanisms

**Deliverables**:
- Complete commenting system
- Circle group chat
- Social media sharing
- Friend invitation system
- Polished UX for all features

**Success Criteria**:
- 40% of users share achievements
- K-factor reaches 0.6
- 90% user satisfaction with social features

### Sprint 5 (Week 5): Discovery & Advanced Features
**Goal**: Circle discovery and advanced social mechanics

#### Backend Tasks (3 days)
- [ ] Build circle recommendation engine
- [ ] Create trending algorithm
- [ ] Implement friend-of-friend suggestions
- [ ] Add geographic discovery
- [ ] Build notification preferences

#### Frontend Tasks (2 days)
- [ ] Create CircleDiscovery page
- [ ] Build recommendation cards
- [ ] Add trending circles section
- [ ] Implement smart notifications
- [ ] Create onboarding for social features

#### Testing & Polish (1 day)
- [ ] Test recommendation accuracy
- [ ] Verify trending calculations
- [ ] Polish discovery UX

**Deliverables**:
- Circle discovery with 5 methods
- Smart friend suggestions
- Trending circles section
- Advanced notification controls

**Success Criteria**:
- 30% of circles discovered through social
- 25% friend suggestion acceptance rate
- 50% reduction in notification opt-outs

---

## Gap Analysis

### Current State vs Required State

#### Database Gaps

| Required | Current Status | Action Needed |
|----------|---------------|---------------|
| friendships table | ❌ Missing | Create in Sprint 1 |
| activity_feed table | ❌ Missing | Create in Sprint 2 |
| friend_groups table | ❌ Missing | Create in Sprint 1 |
| circle_messages table | ❌ Missing | Create in Sprint 4 |
| notification_preferences | ❌ Missing | Create in Sprint 5 |
| reactions table | ✅ Exists | Enhance usage |
| comments table | ✅ Exists | Add threading support |
| notifications table | ✅ Exists | Add social types |

#### API Gaps

| Category | Endpoints Needed | Current | Gap |
|----------|-----------------|---------|-----|
| Friends | 12 | 0 | 12 endpoints |
| Activity Feed | 5 | 0 | 5 endpoints |
| Reactions | 3 | 0 | 3 endpoints |
| Comments | 4 | 0 | 4 endpoints |
| Leaderboards | 5 | 1 | 4 endpoints |
| Circle Social | 6 | 2 | 4 endpoints |
| **Total** | **35** | **3** | **32 endpoints** |

#### Frontend Gaps

| Component Category | Required | Existing | To Build |
|-------------------|----------|----------|----------|
| Friend Management | 4 | 0 | 4 |
| Activity Feed | 5 | 0 | 5 |
| Leaderboards | 4 | 1 (basic) | 3 |
| Circle Social | 4 | 1 (basic) | 3 |
| Notifications | 3 | 0 | 3 |
| **Total** | **20** | **2** | **18 components** |

#### Infrastructure Gaps

| Requirement | Current | Gap | Priority |
|-------------|---------|-----|----------|
| WebSocket/Realtime | ✅ Supabase Realtime | Configure channels | P0 |
| Push Notifications | ❌ Not implemented | Add FCM/APNS | P1 |
| Background Jobs | ⚠️ Basic cron | Add queue system | P2 |
| Caching Layer | ❌ None | Add Redis | P2 |
| CDN for Media | ✅ Vercel CDN | Optimize for images | P1 |

### Migration Strategy

#### Phase 1: Non-Breaking Additions (Week 1-2)
- Add new tables without modifying existing ones
- Deploy friend system alongside current features
- Enable for beta users first

#### Phase 2: Integration (Week 3-4)
- Connect activity feed to existing check-ins
- Add social features to current challenges
- Maintain backward compatibility

#### Phase 3: Migration (Week 5)
- Migrate existing users to friend system
- Generate historical activity feed
- Update all leaderboards to social version

#### Rollback Plan
- Feature flags for all social features
- Database migrations are additive only
- Can disable via environment variables
- Keep non-social version available

---

## Success Metrics

### North Star Metric
**Social-Driven Weekly Active Users (S-WAU)**: Users who engage with at least one social feature weekly

**Target Evolution**:
- Month 1: 25% of WAU
- Month 3: 60% of WAU
- Month 6: 80% of WAU

### Leading Indicators

| Metric | Week 1 | Week 4 | Week 12 | Industry Benchmark |
|--------|--------|--------|---------|-------------------|
| Friend Connections/User | 2 | 5 | 12 | 8 (Facebook Fitness) |
| Daily Social Actions | 1 | 3.5 | 7.2 | 5 (Strava) |
| Activity Feed Views/DAU | 2 | 4 | 8 | 6 (Instagram) |
| Reaction Rate | 15% | 35% | 50% | 40% (Social fitness apps) |
| Comment Rate | 5% | 12% | 20% | 15% (Community apps) |
| Share Rate | 2% | 8% | 15% | 10% (Viral apps) |

### Engagement Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Social Sessions** | 12/week | Sessions with social interaction |
| **Friend Retention** | 85% D30 | Users with friends vs without |
| **Circle Discovery** | 30% | Circles joined via social discovery |
| **Viral Coefficient** | 0.6 → 1.2 | Invites sent × conversion rate |
| **Social NPS** | 60+ | "Would you recommend to a friend?" |

### Business Impact

| Metric | Baseline | With Social | Impact |
|--------|----------|-------------|---------|
| **D7 Retention** | 25% | 40% | +60% |
| **D30 Retention** | 15% | 28% | +87% |
| **LTV** | $85 | $145 | +71% |
| **CAC** | $25 | $18 | -28% |
| **Conversion to Pro** | 8% | 14% | +75% |
| **Challenge Completion** | 65% | 78% | +20% |

### Feature-Specific KPIs

#### Friend System
- Average friend request acceptance rate: 70%
- Time to first friend: <24 hours
- Friend discovery methods used: 2.3 average

#### Activity Feed
- Feed engagement rate: 65%
- Posts with reactions: 80%
- Posts with comments: 30%
- Time spent in feed: 4 min/session

#### Leaderboards
- Leaderboard views/user/week: 8
- Challenge initiated from leaderboard: 20%
- Position improvement correlation: +15%

#### Circle Social
- Messages per active circle: 50/day
- Circle retention with chat: 85%
- Cross-circle friendships: 3 per user

---

## Risks & Mitigations

### Technical Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|------------|-------------------|
| **Real-time scaling issues** | High | Medium | - Use Supabase connection pooling<br>- Implement WebSocket throttling<br>- Add fallback to polling<br>- Cache frequently accessed data |
| **Database performance degradation** | High | Medium | - Add composite indexes<br>- Implement query optimization<br>- Use materialized views for leaderboards<br>- Archive old activity data |
| **Notification overload** | Medium | High | - Smart notification batching<br>- ML-based relevance filtering<br>- Granular user preferences<br>- Quiet hours by default |
| **Privacy/data breach** | Critical | Low | - End-to-end encryption for messages<br>- Regular security audits<br>- GDPR/CCPA compliance<br>- Privacy by default settings |

### UX Complexity Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|------------|-------------------|
| **Feature discovery issues** | Medium | Medium | - Progressive disclosure<br>- Interactive onboarding<br>- In-app tutorials<br>- Feature highlights |
| **Social anxiety/pressure** | Medium | Medium | - Private mode options<br>- Anonymous participation<br>- Positive-only reactions<br>- Supportive language throughout |
| **Information overload** | Medium | High | - Smart feed filtering<br>- Customizable feed preferences<br>- Summary digests<br>- Focus mode option |

### Business Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|---------|------------|-------------------|
| **Low adoption rate** | High | Medium | - Incentivize friend invites<br>- Showcase social benefits<br>- Create FOMO moments<br>- Influencer partnerships |
| **Negative community behavior** | High | Low | - Community guidelines<br>- Automated moderation<br>- Report/block features<br>- Positive reinforcement system |
| **Competitor feature parity** | Medium | High | - Rapid iteration cycle<br>- Unique AI integration<br>- Focus on our differentiators<br>- Patent key innovations |

### Mitigation Priority Matrix

```
High Impact + High Probability = P0 (Address immediately)
High Impact + Low Probability = P1 (Have plan ready)
Low Impact + High Probability = P2 (Monitor closely)
Low Impact + Low Probability = P3 (Accept risk)
```

**P0 Mitigations** (Week 1):
- Notification controls
- Performance optimization
- Privacy settings
- Anti-spam measures

**P1 Mitigations** (Week 2-3):
- Scaling infrastructure
- Moderation tools
- Security hardening
- Backup systems

**P2 Mitigations** (Week 4-5):
- A/B testing framework
- Analytics pipeline
- User education
- Feedback loops

---

## Appendix A: Competitive Feature Matrix

| Feature | FitCircle | Strava | Peloton | Nike Run Club | MyFitnessPal |
|---------|-----------|---------|----------|---------------|--------------|
| **Friend System** | ✅ Planned | ✅ Following | ✅ Following | ✅ Friends | ✅ Friends |
| **Activity Feed** | ✅ Planned | ✅ Advanced | ✅ Basic | ✅ Basic | ✅ Basic |
| **Reactions** | ✅ 6 types | ✅ Kudos only | ✅ High-fives | ✅ Cheers | ❌ None |
| **Comments** | ✅ Planned | ✅ Yes | ✅ Limited | ✅ Yes | ✅ Yes |
| **Group Chat** | ✅ Planned | ❌ No | ✅ Yes | ❌ No | ❌ No |
| **Live Tracking** | ✅ Planned | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| **Challenges** | ✅ Advanced | ✅ Segments | ✅ Yes | ✅ Basic | ❌ No |
| **AI Coach** | ✅ Fitzy | ❌ No | ⚠️ Basic | ❌ No | ❌ No |
| **Money Stakes** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| **Multi-metric** | ✅ Yes | ❌ Activity only | ⚠️ Limited | ❌ Running only | ✅ Nutrition focus |

## Appendix B: Technical Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Client Layer                       │
├─────────────────────────────────────────────────────┤
│  Web App (Next.js)  │  Mobile PWA  │  Native Apps   │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│                    API Layer                        │
├─────────────────────────────────────────────────────┤
│  REST API  │  WebSocket  │  GraphQL (future)        │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│                 Service Layer                       │
├─────────────────────────────────────────────────────┤
│ FriendService │ FeedService │ LeaderboardService    │
│ NotificationService │ RealtimeService │ AIService   │
└────────────┬────────────────────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│                  Data Layer                         │
├─────────────────────────────────────────────────────┤
│  PostgreSQL  │  Redis Cache  │  Supabase Realtime   │
│  File Storage (S3)  │  Analytics (Mixpanel)         │
└─────────────────────────────────────────────────────┘
```

## Appendix C: Sample SQL Queries

```sql
-- Get friend activity feed
WITH friend_ids AS (
  SELECT friend_id FROM friendships
  WHERE user_id = $1 AND status = 'accepted'
)
SELECT af.*, p.display_name, p.avatar_url,
       COUNT(r.id) as reaction_count,
       COUNT(c.id) as comment_count
FROM activity_feed af
JOIN profiles p ON af.user_id = p.id
LEFT JOIN reactions r ON r.target_id = af.id
LEFT JOIN comments c ON c.target_id = af.id
WHERE af.user_id IN (SELECT friend_id FROM friend_ids)
  AND af.visibility IN ('public', 'friends')
  AND af.created_at > NOW() - INTERVAL '7 days'
GROUP BY af.id, p.display_name, p.avatar_url
ORDER BY af.created_at DESC
LIMIT 50;

-- Get friends leaderboard
WITH friend_metrics AS (
  SELECT
    f.friend_id,
    p.display_name,
    p.avatar_url,
    p.total_points,
    p.current_streak,
    p.challenges_won,
    COUNT(DISTINCT cp.challenge_id) as active_challenges,
    SUM(dt.weight_kg - LAG(dt.weight_kg) OVER (PARTITION BY f.friend_id ORDER BY dt.tracking_date)) as weight_change
  FROM friendships f
  JOIN profiles p ON f.friend_id = p.id
  LEFT JOIN challenge_participants cp ON cp.user_id = f.friend_id
  LEFT JOIN daily_tracking dt ON dt.user_id = f.friend_id
  WHERE f.user_id = $1
    AND f.status = 'accepted'
    AND dt.tracking_date > NOW() - INTERVAL '30 days'
  GROUP BY f.friend_id, p.display_name, p.avatar_url, p.total_points, p.current_streak, p.challenges_won
)
SELECT *,
  RANK() OVER (ORDER BY total_points DESC) as rank
FROM friend_metrics
ORDER BY total_points DESC;
```

---

**Document Status**: Ready for Implementation
**Next Steps**:
1. Technical review and approval
2. Resource allocation
3. Sprint planning session
4. Begin Sprint 1 implementation

**Success Criteria for Launch**:
- [ ] All P0 features implemented
- [ ] Performance benchmarks met
- [ ] Security audit passed
- [ ] Beta user feedback incorporated
- [ ] Analytics tracking verified
- [ ] Documentation complete