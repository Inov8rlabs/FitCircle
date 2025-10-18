# Usage Examples
**Progress History & Check-In Detail Components**

## Quick Start

### 1. Import Components

```typescript
import { CheckInCard, CheckInDetailModal, CheckInDetailSheet } from '@/components/check-ins';
import { getFilteredCheckIns } from '@/lib/services/check-in-service';
```

### 2. Fetch Check-Ins

```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { getFilteredCheckIns } from '@/lib/services/check-in-service';

export function ProgressHistoryView({ userId, challengeId, challengeType }) {
  const [checkIns, setCheckIns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data, error } = await getFilteredCheckIns(
        userId,
        challengeType,
        supabase,
        20, // limit
        0   // offset
      );

      if (!error) {
        setCheckIns(data);
      }
      setLoading(false);
    }

    fetchData();
  }, [userId, challengeType]);

  // ... render logic
}
```

### 3. Display Check-In List

```typescript
import { CheckInCard } from '@/components/check-ins';

export function CheckInList({ checkIns, onCardClick }) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Progress History</h3>
      <div className="grid gap-3">
        {checkIns.map((checkIn, index) => (
          <CheckInCard
            key={checkIn.id}
            checkIn={checkIn}
            previousCheckIn={index > 0 ? checkIns[index - 1] : null}
            onClick={() => onCardClick(checkIn)}
          />
        ))}
      </div>
    </div>
  );
}
```

### 4. Desktop Detail Modal

```typescript
import { useState } from 'react';
import { CheckInDetailModal } from '@/components/check-ins';

export function DesktopProgressView() {
  const [selectedCheckIn, setSelectedCheckIn] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCardClick = (checkIn) => {
    setSelectedCheckIn(checkIn);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    const response = await fetch(`/api/check-ins/${selectedCheckIn.id}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      // Refresh check-ins list
      setIsModalOpen(false);
    }
  };

  const handleTogglePrivacy = async (isPublic) => {
    const response = await fetch(`/api/check-ins/${selectedCheckIn.id}/privacy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic }),
    });

    if (response.ok) {
      // Update local state
      setSelectedCheckIn({ ...selectedCheckIn, is_public: isPublic });
    }
  };

  return (
    <>
      <CheckInList checkIns={checkIns} onCardClick={handleCardClick} />

      <CheckInDetailModal
        checkIn={selectedCheckIn}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        canEdit={selectedCheckIn?.user_id === currentUser?.id}
        onEdit={() => router.push(`/check-ins/${selectedCheckIn.id}/edit`)}
        onDelete={handleDelete}
        onTogglePrivacy={handleTogglePrivacy}
      />
    </>
  );
}
```

### 5. Mobile Bottom Sheet

```typescript
import { useState } from 'react';
import { CheckInDetailSheet } from '@/components/check-ins';

export function MobileProgressView() {
  const [selectedCheckIn, setSelectedCheckIn] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const handleCardClick = (checkIn) => {
    setSelectedCheckIn(checkIn);
    setIsSheetOpen(true);
  };

  const handleDelete = async () => {
    const response = await fetch(`/api/check-ins/${selectedCheckIn.id}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      setIsSheetOpen(false);
    }
  };

  const handleTogglePrivacy = async (isPublic) => {
    const response = await fetch(`/api/check-ins/${selectedCheckIn.id}/privacy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic }),
    });
  };

  return (
    <>
      <CheckInList checkIns={checkIns} onCardClick={handleCardClick} />

      <CheckInDetailSheet
        checkIn={selectedCheckIn}
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        canEdit={selectedCheckIn?.user_id === currentUser?.id}
        onEdit={() => router.push(`/check-ins/${selectedCheckIn.id}/edit`)}
        onDelete={handleDelete}
        onTogglePrivacy={handleTogglePrivacy}
      />
    </>
  );
}
```

### 6. Responsive (Auto-Detect)

```typescript
'use client';

import { useState, useEffect } from 'react';
import { CheckInDetailModal, CheckInDetailSheet } from '@/components/check-ins';

export function ResponsiveProgressView() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const DetailComponent = isMobile ? CheckInDetailSheet : CheckInDetailModal;

  return (
    <>
      <CheckInList checkIns={checkIns} onCardClick={handleCardClick} />

      <DetailComponent
        checkIn={selectedCheckIn}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        canEdit={selectedCheckIn?.user_id === currentUser?.id}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onTogglePrivacy={handleTogglePrivacy}
      />
    </>
  );
}
```

## API Integration Examples

### Fetch Check-Ins for Challenge

```typescript
async function fetchChallengeCheckIns(challengeId: string, userId: string) {
  const response = await fetch(
    `/api/challenges/${challengeId}/check-ins?userId=${userId}&limit=20&offset=0`
  );

  const data = await response.json();

  return {
    checkIns: data.checkIns,
    hasMore: data.hasMore,
    challengeType: data.challengeType,
  };
}
```

### Get Single Check-In

```typescript
async function getCheckInDetail(checkInId: string, challengeId?: string) {
  const url = challengeId
    ? `/api/check-ins/${checkInId}?challengeId=${challengeId}`
    : `/api/check-ins/${checkInId}`;

  const response = await fetch(url);
  const data = await response.json();

  return {
    checkIn: data.checkIn,
    canEdit: data.canEdit,
  };
}
```

### Toggle Privacy

```typescript
async function togglePrivacy(checkInId: string, isPublic: boolean) {
  const response = await fetch(`/api/check-ins/${checkInId}/privacy`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic }),
  });

  if (!response.ok) {
    throw new Error('Failed to update privacy');
  }

  return await response.json();
}
```

### Delete Check-In

```typescript
async function deleteCheckIn(checkInId: string) {
  const response = await fetch(`/api/check-ins/${checkInId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete check-in');
  }

  return await response.json();
}
```

## Filtering Examples

### Filter by Challenge Type

```typescript
import { filterCheckInsByType } from '@/lib/services/check-in-service';

// Weight loss challenge - only weight check-ins
const weightCheckIns = filterCheckInsByType(allCheckIns, 'weight_loss');

// Step count challenge - only steps check-ins
const stepsCheckIns = filterCheckInsByType(allCheckIns, 'step_count');

// Custom challenge - all check-ins
const allFilteredCheckIns = filterCheckInsByType(allCheckIns, 'custom');
```

### Permission Checking

```typescript
import { canViewCheckIn, canEditCheckIn } from '@/lib/services/check-in-service';

// Check if user can view check-in
const canView = canViewCheckIn(
  checkIn,
  currentUser,
  challenge,
  isCircleMember
);

// Check if user can edit check-in
const canEdit = canEditCheckIn(checkIn, currentUser);
```

## Component Props Reference

### CheckInCard

```typescript
interface CheckInCardProps {
  checkIn: CheckIn;                    // Required: Check-in data
  onClick: () => void;                 // Required: Click handler
  compact?: boolean;                   // Optional: Use compact layout
  previousCheckIn?: CheckIn | null;    // Optional: For delta calculation
}
```

### CheckInDetailModal

```typescript
interface CheckInDetailModalProps {
  checkIn: CheckInWithProfile | null;  // Required: Check-in with profile
  isOpen: boolean;                     // Required: Modal open state
  onClose: () => void;                 // Required: Close handler
  canEdit: boolean;                    // Required: Edit permission
  onEdit?: () => void;                 // Optional: Edit handler
  onDelete?: () => Promise<void>;      // Optional: Delete handler
  onTogglePrivacy?: (isPublic: boolean) => Promise<void>; // Optional: Privacy toggle
  previousCheckIn?: CheckInWithProfile | null; // Optional: For delta
  challengeContext?: {                 // Optional: Challenge data
    name: string;
    startValue?: number;
    currentValue?: number;
    goalValue?: number;
    streak?: number;
  };
}
```

### CheckInDetailSheet

Same props as `CheckInDetailModal` (see above).

## Styling Customization

### Override Card Colors

```typescript
// In CheckInCard.tsx, update CHECK_IN_COLORS constant
const CHECK_IN_COLORS = {
  weight: {
    background: 'bg-gradient-to-br from-blue-500/10 to-blue-600/5', // Custom
    border: 'border-blue-500/30',
    icon: 'text-blue-400',
    accent: 'text-blue-300',
  },
  // ... other types
};
```

### Custom Animations

```typescript
// In CheckInCard.tsx
<motion.div
  whileHover={{ scale: 1.05 }} // More aggressive hover
  whileTap={{ scale: 0.95 }}   // More feedback
>
```

## Error Handling

```typescript
async function fetchWithErrorHandling(checkInId: string) {
  try {
    const response = await fetch(`/api/check-ins/${checkInId}`);

    if (!response.ok) {
      if (response.status === 404) {
        toast.error('Check-in not found');
      } else if (response.status === 403) {
        toast.error('Not authorized to view this check-in');
      } else {
        toast.error('Failed to load check-in');
      }
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching check-in:', error);
    toast.error('Network error. Please try again.');
    return null;
  }
}
```

## Loading States

```typescript
export function ProgressHistoryWithLoading() {
  const [loading, setLoading] = useState(true);
  const [checkIns, setCheckIns] = useState([]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 bg-slate-800/50 rounded-xl animate-pulse"
          />
        ))}
      </div>
    );
  }

  return <CheckInList checkIns={checkIns} onCardClick={handleClick} />;
}
```

## Empty States

```typescript
export function ProgressHistoryWithEmpty({ checkIns }) {
  if (checkIns.length === 0) {
    return (
      <div className="text-center py-12">
        <Footprints className="h-20 w-20 text-slate-600 mx-auto mb-4" />
        <h3 className="text-xl font-bold mb-2">No Progress Logged Yet</h3>
        <p className="text-slate-400 mb-6">
          Start your journey with your first check-in
        </p>
        <Button onClick={openCheckInModal}>
          <Plus className="h-5 w-5 mr-2" />
          Log First Check-In
        </Button>
      </div>
    );
  }

  return <CheckInList checkIns={checkIns} onCardClick={handleClick} />;
}
```

## Next.js App Router Integration

```typescript
// app/challenges/[id]/progress/page.tsx
'use client';

import { use } from 'react';
import { CheckInCard, CheckInDetailModal } from '@/components/check-ins';

export default function ProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [checkIns, setCheckIns] = useState([]);

  useEffect(() => {
    async function loadCheckIns() {
      const response = await fetch(`/api/challenges/${id}/check-ins?userId=${currentUser.id}`);
      const data = await response.json();
      setCheckIns(data.checkIns);
    }

    loadCheckIns();
  }, [id]);

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-2xl font-bold mb-6">Progress History</h1>
      {/* Component usage here */}
    </div>
  );
}
```

## Testing Examples

```typescript
// CheckInCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CheckInCard } from './CheckInCard';

describe('CheckInCard', () => {
  const mockCheckIn = {
    id: '1',
    user_id: 'user-1',
    tracking_date: '2025-01-18',
    weight_kg: 75.5,
    steps: null,
    mood_score: 7,
    energy_level: 8,
    notes: 'Feeling great!',
    is_public: true,
    created_at: '2025-01-18T10:00:00Z',
    updated_at: '2025-01-18T10:00:00Z',
  };

  it('renders weight check-in correctly', () => {
    const onClick = vi.fn();
    render(<CheckInCard checkIn={mockCheckIn} onClick={onClick} />);

    expect(screen.getByText('Weight Check-In')).toBeInTheDocument();
    expect(screen.getByText('75.5')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<CheckInCard checkIn={mockCheckIn} onClick={onClick} />);

    fireEvent.click(screen.getByText('Weight Check-In'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

## Common Patterns

### Pagination

```typescript
const [offset, setOffset] = useState(0);
const [hasMore, setHasMore] = useState(true);
const limit = 20;

async function loadMore() {
  const response = await fetch(
    `/api/challenges/${challengeId}/check-ins?userId=${userId}&limit=${limit}&offset=${offset}`
  );
  const data = await response.json();

  setCheckIns([...checkIns, ...data.checkIns]);
  setHasMore(data.hasMore);
  setOffset(offset + limit);
}
```

### Infinite Scroll

```typescript
import { useInView } from 'react-intersection-observer';

export function InfiniteCheckInList() {
  const { ref, inView } = useInView();

  useEffect(() => {
    if (inView && hasMore && !loading) {
      loadMore();
    }
  }, [inView, hasMore, loading]);

  return (
    <div>
      {checkIns.map((checkIn) => (
        <CheckInCard key={checkIn.id} checkIn={checkIn} onClick={handleClick} />
      ))}
      {hasMore && <div ref={ref}>Loading more...</div>}
    </div>
  );
}
```

---

**For more details, see:**
- PRD: `/docs/progress-history-checkin-detail-prd.md`
- Implementation Summary: `/PHASE1_IMPLEMENTATION_SUMMARY.md`
- Service Layer: `/apps/web/app/lib/services/check-in-service.ts`
