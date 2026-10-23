'use client';

import { motion } from 'framer-motion';
import {
  Trophy,
  Users,
  Calendar,
  Target,
  Crown,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowLeft,
  Settings,
  UserPlus,
  Activity,
  AlertCircle,
  Lock,
  Copy,
  CheckCircle,
  Edit,
  Trash2,
  Share2,
  X,
  Check,
  Loader2,
  MessageCircle,
  LayoutGrid,
  Salad,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import CircleChallengesSection from '@/components/challenges/CircleChallengesSection';
import { CircleChat } from '@/components/chat/CircleChat';
import { CheckInCard } from '@/components/check-ins';
import CircleQuestsSection from '@/components/CircleQuestsSection';
import { CircleDetailSkeleton } from '@/components/circles/CircleDetailSkeleton';
import { CircleStreakLiveCard } from '@/components/circles/CircleStreakLiveCard';
import { LeaderboardRow } from '@/components/circles/LeaderboardRow';
import { circleTypeLabel, durationLabel } from '@/components/circles/types';
import { useCircleStreak } from '@/components/circles/useCircleStreak';
import DashboardNav from '@/components/DashboardNav';
import { BathroomScale } from '@/components/icons/BathroomScale';
import { CircleFoodFeed } from '@/components/nutrition/CircleFoodFeed';
import { FitzyChat } from '@/components/nutrition/FitzyChat';
import { FoodSearch } from '@/components/nutrition/FoodSearch';
import { GroupMealComposer } from '@/components/nutrition/GroupMealComposer';
import { GroupMealInbox } from '@/components/nutrition/GroupMealInbox';
import { InsightsList } from '@/components/nutrition/InsightsList';
import { NutritionChallengeCard } from '@/components/nutrition/NutritionChallengeCard';
import { PhotoLog } from '@/components/nutrition/PhotoLog';
import { PlateScoreCard } from '@/components/nutrition/PlateScoreCard';
import { VoiceLog } from '@/components/nutrition/VoiceLog';
import { ShareFitCircleDialog } from '@/components/ShareFitCircleDialog';
import { SubmitProgressDialog } from '@/components/SubmitProgressDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { GradientText } from '@/components/ui/gradient-text';
import { GlassCard, ListGroup, ListRow, Screen } from '@/components/ui/ios';
import { Progress } from '@/components/ui/progress';
import { StatTile } from '@/components/ui/stat-tile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { nutritionClient, type PrivacyTier } from '@/lib/api/nutrition-client';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';



interface FitCircle {
  id: string;
  name: string;
  description: string;
  type: string;
  start_date: string;
  end_date: string;
  creator_id: string;
  invite_code: string;
  visibility: string;
  max_participants: number;
  created_at: string;
  participant_count: number;
  is_creator: boolean;
  is_participant: boolean;
}

interface Participant {
  id: string;
  user_id: string;
  challenge_id?: string;
  status?: string;
  joined_at?: string;
  display_name: string;
  avatar_url: string;
  progress: number;
  current_value?: number;
  target_value?: number;
  starting_value?: number;
  total_entries?: number;
  latest_entry_date?: string;
  is_public?: boolean;
  is_creator?: boolean;
  is_current_user?: boolean;
  checked_in_today?: boolean;
  entries?: ProgressEntry[];
}

interface ProgressEntry {
  tracking_date: string;
  value: number;
  is_public: boolean;
}

export default function FitCirclePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const { unitSystem } = useUnitPreference();
  const [fitCircle, setFitCircle] = useState<FitCircle | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showSubmitProgressDialog, setShowSubmitProgressDialog] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [foodPrivacyTier, setFoodPrivacyTier] = useState<PrivacyTier | null>(null);
  const [foodFeedKey, setFoodFeedKey] = useState(0);
  // Live circle streak + today's check-ins (GET /api/mobile/circles/[id]/streak).
  const { status: circleStreak, setStatus: setCircleStreak } = useCircleStreak(params.id as string);

  // Generate invite URL using environment variable or window location
  const inviteUrl = fitCircle?.invite_code
    ? `${process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')}/join/${fitCircle.invite_code}`
    : '';
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isEditingStartDate, setIsEditingStartDate] = useState(false);
  const [editedStartDate, setEditedStartDate] = useState('');
  const [isSavingStartDate, setIsSavingStartDate] = useState(false);
  const [isEditingEndDate, setIsEditingEndDate] = useState(false);
  const [editedEndDate, setEditedEndDate] = useState('');
  const [isSavingEndDate, setIsSavingEndDate] = useState(false);
  const [removingParticipantId, setRemovingParticipantId] = useState<string | null>(null);

  // Edit states for participant goals
  const [isEditingStartingValue, setIsEditingStartingValue] = useState(false);
  const [editedStartingValue, setEditedStartingValue] = useState('');
  const [isSavingStartingValue, setIsSavingStartingValue] = useState(false);
  const [isEditingTargetValue, setIsEditingTargetValue] = useState(false);
  const [editedTargetValue, setEditedTargetValue] = useState('');
  const [isSavingTargetValue, setIsSavingTargetValue] = useState(false);

  // Edit states for daily entries
  const [editingEntryDate, setEditingEntryDate] = useState<string | null>(null);
  const [editedEntryValue, setEditedEntryValue] = useState('');
  const [isSavingEntry, setIsSavingEntry] = useState(false);

  // Chat tab: unread badge (messages newer than the viewer's read cursor).
  // CircleChat marks read when the tab opens, so opening the tab clears it.
  const [activeTab, setActiveTab] = useState('overview');
  const [chatUnread, setChatUnread] = useState(0);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  // FitCircle Viewed fires once per circle, after the member list loads.
  const viewedCircleRef = useRef<string | null>(null);

  const circleId = params.id as string;

  useEffect(() => {
    if (circleId && user) {
      void fetchFitCircle();
      void fetchParticipants();
      nutritionClient
        .getFoodPrivacy(circleId)
        .then((p) => setFoodPrivacyTier(p.tier))
        .catch(() => setFoodPrivacyTier(null));
    }
  }, [circleId, user]);

  // Initial unread-chat count: messages newer than circle_chat_state.last_read_at,
  // excluding the viewer's own. Best-effort — RLS scopes both reads to members.
  useEffect(() => {
    if (!circleId || !user) return;
    let cancelled = false;

    const loadUnread = async () => {
      try {
        const { data: chatState } = await supabase
          .from('circle_chat_state')
          .select('last_read_at')
          .eq('fitcircle_id', circleId)
          .eq('user_id', user.id)
          .maybeSingle<{ last_read_at: string | null }>();

        let query = supabase
          .from('circle_messages')
          .select('id', { count: 'exact', head: true })
          .eq('fitcircle_id', circleId)
          .or(`sender_id.neq.${user.id},sender_id.is.null`);

        if (chatState?.last_read_at) {
          query = query.gt('created_at', chatState.last_read_at);
        }

        const { count } = await query;
        if (!cancelled && activeTabRef.current !== 'chat') {
          setChatUnread(count ?? 0);
        }
      } catch (err) {
        console.warn('[fitcircle] unread chat count failed', err);
      }
    };

    void loadUnread();
    return () => {
      cancelled = true;
    };
  }, [circleId, user]);

  // Live unread updates: bump the badge on new messages while the chat tab is
  // closed (CircleChat handles its own realtime while the tab is open).
  useEffect(() => {
    if (!circleId || !user) return;

    const channel = supabase
      .channel(`circle-chat-unread:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'circle_messages',
          filter: `fitcircle_id=eq.${circleId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, any>;
          if (row?.sender_id === user.id) return; // own messages never count
          if (activeTabRef.current === 'chat') return; // being read live
          setChatUnread((prev) => prev + 1);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [circleId, user]);

  const fetchFitCircle = async () => {
    try {
      // Cross-user / private circle rows are no longer readable by the browser
      // anon-key client (migration 069). The service-role /api/fitcircles/[id]
      // route returns the single circle (public preview, or private if the caller
      // is the creator/an active member) with an authorization gate.
      const response = await fetch(`/api/fitcircles/${circleId}`);

      if (!response.ok) {
        setError('FitCircle not found');
        return;
      }

      const data = await response.json();
      const challengeData = data.circle;

      if (!challengeData) {
        setError('FitCircle not found');
        return;
      }

      setFitCircle({
        id: challengeData.id,
        name: challengeData.name,
        description: challengeData.description || '',
        type: challengeData.type,
        start_date: challengeData.start_date,
        end_date: challengeData.end_date,
        creator_id: challengeData.creator_id,
        invite_code: challengeData.invite_code || '',
        visibility: challengeData.visibility || 'public',
        max_participants: challengeData.max_participants || 0,
        created_at: challengeData.created_at || '',
        participant_count: challengeData.participant_count || 0, // May be refined by participants fetch
        is_creator: challengeData.creator_id === user?.id,
        is_participant: challengeData.is_participant ?? false, // May be refined by participants fetch
      });
    } catch (err) {
      console.error('Error fetching FitCircle:', err);
      setError('Failed to load FitCircle');
    }
  };

  const fetchParticipants = async () => {
    try {
      console.log('Fetching leaderboard for challenge:', circleId);

      // Use new leaderboard API that pulls from daily_tracking
      const response = await fetch(`/api/fitcircles/${circleId}/leaderboard`);

      if (response.ok) {
        const data = await response.json();
        console.log('Leaderboard data received:', data.leaderboard?.length || 0);

        const leaderboardData = data.leaderboard || [];

        // Transform leaderboard data to participant format
        const participantsList = leaderboardData.map((entry: any) => ({
          id: entry.user_id,
          user_id: entry.user_id,
          display_name: entry.display_name,
          avatar_url: entry.avatar_url,
          progress: Math.round(entry.progress_percentage),
          current_value: entry.current_value,
          starting_value: entry.starting_value,
          target_value: entry.target_value,
          total_entries: entry.total_entries,
          is_creator: entry.is_creator,
          is_current_user: entry.is_current_user,
          checked_in_today: Boolean(entry.checked_in_today),
          is_public: true, // daily_tracking visibility will be handled separately
        }));

        setParticipants(participantsList);
        if (viewedCircleRef.current !== circleId) {
          viewedCircleRef.current = circleId;
          analytics.track(AnalyticsEvents.fitCircleViewed({ member_count: participantsList.length }));
        }

        // Check if current user is a participant
        const userIsParticipant = participantsList.some((p: any) => p.is_current_user);
        console.log('User is participant (from leaderboard):', userIsParticipant);

        // Update fitCircle state with participant info
        setFitCircle(prev => prev ? {
          ...prev,
          participant_count: participantsList.length,
          is_participant: userIsParticipant,
        } : null);

        setLoading(false);
        return;
      }

      console.error('Leaderboard API failed:', response.status, response.statusText);
      const errorData = await response.json().catch(() => ({}));
      console.error('Error response:', errorData);

      // Fallback: Try direct query approach
      console.log('Trying fallback direct query...');
      await fetchParticipantsFallback();

    } catch (err) {
      console.error('Error fetching participants:', err);
      // Fallback to empty participants list
      setParticipants([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchParticipantsFallback = async () => {
    try {
      // Fallback: the member list is served by the service-role participants
      // route (migration 069: browser anon-key can no longer read other
      // members' fitcircle_members rows directly).
      const response = await fetch(`/api/fitcircles/${circleId}/participants`);

      if (!response.ok) {
        console.error('Fallback participants API failed:', response.status, response.statusText);
        setParticipants([]);
        return;
      }

      const data = await response.json();
      const participantsData = data.participants || [];

      // Create basic participant objects from the route response
      const basicParticipants = participantsData.map((participant: any) => {
        const isCurrentUser = participant.user_id === user?.id;
        return {
          ...participant,
          display_name: participant.display_name || 'Unknown User',
          avatar_url: participant.avatar_url || '',
          latest_value: participant.latest_value || 0,
          latest_date: participant.latest_date || new Date().toISOString().split('T')[0],
          total_entries: participant.total_entries || 0,
          is_public: participant.is_public ?? false,
          is_creator: participant.is_creator ?? (participant.user_id === fitCircle?.creator_id),
          is_current_user: isCurrentUser,
          progress: Math.round(participant.progress_percentage || 0),
          current_value: participant.latest_value || 0,
          target_value: 100,
          progress_percentage: participant.progress_percentage || 0,
          entries: []
        };
      });

      console.log('Participants loaded:', basicParticipants);
      console.log('Current user is participant:', basicParticipants.some((p: any) => p.is_current_user));

      setParticipants(basicParticipants);

      // Update is_participant flag in fitCircle
      const userIsParticipant = basicParticipants.some((p: any) => p.is_current_user);

      setFitCircle(prev => prev ? {
        ...prev,
        participant_count: basicParticipants.length,
        is_participant: userIsParticipant,
      } : null);
    } catch (err) {
      console.error('Error in fallback fetch:', err);
      setParticipants([]);
    }
  };

  const copyInviteCode = async () => {
    if (!inviteUrl) return;

    await navigator.clipboard.writeText(inviteUrl);
    analytics.track(AnalyticsEvents.inviteShared({ method: 'copy_link' }));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDeleteChallenge = async () => {
    if (!confirm('Are you sure you want to delete this FitCircle? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/fitcircles/${circleId}/delete`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete challenge');
      }

      toast.success('FitCircle deleted successfully');
      void router.push('/fitcircles');
    } catch (err: any) {
      console.error('Error deleting challenge:', err);
      toast.error(err.message || 'Failed to delete challenge');
    }
  };

  const handleStartEditName = () => {
    setEditedName(fitCircle?.name || '');
    setIsEditingName(true);
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName('');
  };

  const handleSaveName = async () => {
    if (!editedName.trim() || !fitCircle) return;

    setIsSavingName(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editedName.trim() }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update name');
      }

      // Update local state
      setFitCircle({
        ...fitCircle,
        name: editedName.trim(),
      });

      setIsEditingName(false);
      setEditedName('');
    } catch (err: any) {
      console.error('Error updating challenge name:', err);
      alert(err.message || 'Failed to update name');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleStartEditStartDate = () => {
    // Convert date to YYYY-MM-DD format for the date input
    const dateValue = fitCircle?.start_date || '';
    const formattedDate = dateValue.split('T')[0]; // Extract just the date part
    setEditedStartDate(formattedDate);
    setIsEditingStartDate(true);
  };

  const handleCancelEditStartDate = () => {
    setIsEditingStartDate(false);
    setEditedStartDate('');
  };

  const handleSaveStartDate = async () => {
    if (!editedStartDate || !fitCircle) return;

    // Validate that start date is before end date
    if (new Date(editedStartDate) >= new Date(fitCircle.end_date)) {
      alert('Start date must be before end date');
      return;
    }

    setIsSavingStartDate(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: editedStartDate }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update start date');
      }

      // Update local state
      setFitCircle({
        ...fitCircle,
        start_date: editedStartDate,
      });

      setIsEditingStartDate(false);
      setEditedStartDate('');
    } catch (err: any) {
      console.error('Error saving start date:', err);
      alert(err.message || 'Failed to update start date');
    } finally {
      setIsSavingStartDate(false);
    }
  };

  const handleStartEditEndDate = () => {
    // Convert date to YYYY-MM-DD format for the date input
    const dateValue = fitCircle?.end_date || '';
    const formattedDate = dateValue.split('T')[0]; // Extract just the date part
    setEditedEndDate(formattedDate);
    setIsEditingEndDate(true);
  };

  const handleCancelEditEndDate = () => {
    setIsEditingEndDate(false);
    setEditedEndDate('');
  };

  const handleSaveEndDate = async () => {
    if (!editedEndDate || !fitCircle) return;

    // Validate that end date is after start date
    if (new Date(editedEndDate) <= new Date(fitCircle.start_date)) {
      alert('End date must be after start date');
      return;
    }

    setIsSavingEndDate(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/update`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_date: editedEndDate }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update end date');
      }

      // Update local state
      setFitCircle({
        ...fitCircle,
        end_date: editedEndDate,
      });

      setIsEditingEndDate(false);
      setEditedEndDate('');
    } catch (err: any) {
      console.error('Error saving end date:', err);
      alert(err.message || 'Failed to update end date');
    } finally {
      setIsSavingEndDate(false);
    }
  };

  const handleRemoveParticipant = async (participantId: string, participantName: string) => {
    // Show confirmation dialog
    const confirmed = window.confirm(
      `Are you sure you want to remove ${participantName} from this FitCircle?\n\nThis action cannot be undone. The participant will lose access to this challenge.`
    );

    if (!confirmed) {
      return; // User cancelled
    }

    setRemovingParticipantId(participantId);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/participants/${participantId}/remove`, {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to remove participant');
      }

      // Show success message
      toast.success(`${participantName} has been removed from the FitCircle`);

      // Refresh participants list
      await fetchParticipants();
    } catch (err: any) {
      console.error('Error removing participant:', err);
      toast.error(err.message || 'Failed to remove participant. Please try again.');
    } finally {
      setRemovingParticipantId(null);
    }
  };

  const handleParticipantClick = async (participant: Participant) => {
    // Only allow viewing details if:
    // 1. It's the user's own profile, OR
    // 2. The participant has made their data public
    if (participant.user_id === user?.id || participant.is_public) {
      // Fetch progress history from daily_tracking
      try {
        const url = `/api/fitcircles/${circleId}/progress/${participant.user_id}`;
        console.log('Fetching progress history from:', url);

        const response = await fetch(url);
        console.log('Progress history response:', response.status, response.statusText);

        if (response.ok) {
          const data = await response.json();
          console.log('Progress history data:', data);
          setSelectedParticipant({
            ...participant,
            entries: data.entries || []
          });
        } else {
          const errorText = await response.text();
          console.error('Progress history API error:', errorText);
          setSelectedParticipant(participant);
        }
      } catch (err) {
        console.error('Error fetching progress history:', err);
        setSelectedParticipant(participant);
      }
      setShowDetailModal(true);
    }
  };

  // Handlers for editing starting value
  const handleStartEditStartingValue = () => {
    setEditedStartingValue(selectedParticipant?.starting_value?.toString() || '');
    setIsEditingStartingValue(true);
  };

  const handleCancelEditStartingValue = () => {
    setIsEditingStartingValue(false);
    setEditedStartingValue('');
  };

  const handleSaveStartingValue = async () => {
    if (!editedStartingValue || !selectedParticipant) return;

    const value = parseFloat(editedStartingValue);
    if (isNaN(value) || value <= 0) {
      toast.error('Please enter a valid starting value');
      return;
    }

    setIsSavingStartingValue(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/participants/${selectedParticipant.user_id}/update-goals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starting_value: value }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update starting value');
      }

      toast.success('Starting value updated successfully');

      // Update local state
      setSelectedParticipant({
        ...selectedParticipant,
        starting_value: value,
      });

      setIsEditingStartingValue(false);
      setEditedStartingValue('');

      // Refresh participants to update calculated progress
      await fetchParticipants();
    } catch (err: any) {
      console.error('Error updating starting value:', err);
      toast.error(err.message || 'Failed to update starting value');
    } finally {
      setIsSavingStartingValue(false);
    }
  };

  // Handlers for editing target value
  const handleStartEditTargetValue = () => {
    setEditedTargetValue(selectedParticipant?.target_value?.toString() || '');
    setIsEditingTargetValue(true);
  };

  const handleCancelEditTargetValue = () => {
    setIsEditingTargetValue(false);
    setEditedTargetValue('');
  };

  const handleSaveTargetValue = async () => {
    if (!editedTargetValue || !selectedParticipant) return;

    const value = parseFloat(editedTargetValue);
    if (isNaN(value) || value <= 0) {
      toast.error('Please enter a valid target value');
      return;
    }

    setIsSavingTargetValue(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/participants/${selectedParticipant.user_id}/update-goals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_value: value }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update target value');
      }

      toast.success('Target value updated successfully');

      // Update local state
      setSelectedParticipant({
        ...selectedParticipant,
        target_value: value,
      });

      setIsEditingTargetValue(false);
      setEditedTargetValue('');

      // Refresh participants to update calculated progress
      await fetchParticipants();
    } catch (err: any) {
      console.error('Error updating target value:', err);
      toast.error(err.message || 'Failed to update target value');
    } finally {
      setIsSavingTargetValue(false);
    }
  };

  // Handlers for editing daily entries
  const handleStartEditEntry = (date: string, value: number) => {
    setEditingEntryDate(date);
    setEditedEntryValue(value.toString());
  };

  const handleCancelEditEntry = () => {
    setEditingEntryDate(null);
    setEditedEntryValue('');
  };

  const handleSaveEntry = async () => {
    if (!editedEntryValue || !editingEntryDate || !selectedParticipant) return;

    const value = parseFloat(editedEntryValue);
    if (isNaN(value) || value < 0) {
      toast.error('Please enter a valid value');
      return;
    }

    setIsSavingEntry(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/progress/${selectedParticipant.user_id}/update-entry`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracking_date: editingEntryDate,
          value: value,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update entry');
      }

      toast.success('Entry updated successfully');

      // Update local entry in the list
      if (selectedParticipant.entries) {
        const updatedEntries = selectedParticipant.entries.map(entry =>
          entry.tracking_date === editingEntryDate
            ? { ...entry, value }
            : entry
        );
        setSelectedParticipant({
          ...selectedParticipant,
          entries: updatedEntries,
        });
      }

      setEditingEntryDate(null);
      setEditedEntryValue('');

      // Refresh participants to update calculated progress
      await fetchParticipants();
    } catch (err: any) {
      console.error('Error updating entry:', err);
      toast.error(err.message || 'Failed to update entry');
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleDeleteEntry = async (date: string) => {
    if (!selectedParticipant || !confirm('Are you sure you want to delete this entry?')) return;

    try {
      const response = await fetch(`/api/fitcircles/${circleId}/progress/${selectedParticipant.user_id}/update-entry`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_date: date }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete entry');
      }

      toast.success('Entry deleted successfully');

      // Remove entry from local list
      if (selectedParticipant.entries) {
        const updatedEntries = selectedParticipant.entries.filter(
          entry => entry.tracking_date !== date
        );
        setSelectedParticipant({
          ...selectedParticipant,
          entries: updatedEntries,
        });
      }

      // Refresh participants to update calculated progress
      await fetchParticipants();
    } catch (err: any) {
      console.error('Error deleting entry:', err);
      toast.error(err.message || 'Failed to delete entry');
    }
  };

  if (loading) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-canvas">
          <Screen size="wide" className="max-w-5xl">
            <CircleDetailSkeleton />
          </Screen>
        </div>
      </>
    );
  }

  if (error || !fitCircle) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-canvas">
          <Screen>
            <GlassCard className="mt-10">
              <EmptyState
                icon={AlertCircle}
                tone="orange"
                title="Circle not found"
                description={error || "The circle you're looking for doesn't exist, or you're not a member."}
                action={
                  <Button variant="outline" onClick={() => { void router.push('/fitcircles'); }}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Circles
                  </Button>
                }
              />
            </GlassCard>
          </Screen>
        </div>
      </>
    );
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getDaysRemaining = (endDate: string) => {
    const diffDays = Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  // Today's check-in state per member, from the live circle streak (the
  // leaderboard's checked_in_today is the fallback).
  const loggedToday = new Set(
    (circleStreak?.today?.members ?? []).filter((m) => m.logged || m.covered).map((m) => m.userId)
  );
  const isInToday = (p: Participant) => (circleStreak?.today ? loggedToday.has(p.user_id) : Boolean(p.checked_in_today));

  const openTab = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'chat') {
      setChatUnread(0);
      analytics.track(AnalyticsEvents.chatOpened());
    }
    if (tab === 'nutrition') analytics.track(AnalyticsEvents.fitzyOpened({ surface: 'circle_nutrition' }));
  };

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-canvas">
        <Screen size="wide" className="max-w-5xl">
          {/* iOS nav bar: back + gear */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => { void router.push('/fitcircles'); }}
              aria-label="Back to Circles"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-glass bg-surface-raised/60 text-white transition hover:bg-surface-raised"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => (fitCircle.is_creator ? setShowManageModal(true) : setShowShareDialog(true))}
              aria-label={fitCircle.is_creator ? 'Manage circle' : 'Share circle'}
              data-testid="circle-settings"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-glass bg-surface-raised/60 text-brand-purple transition hover:bg-surface-raised"
            >
              {fitCircle.is_creator ? <Settings className="h-5 w-5" /> : <Share2 className="h-5 w-5" />}
            </button>
          </div>

          {/* Name, description, Invite + Chat pills */}
          <header className="mb-6 flex flex-col items-center text-center">
            <GradientText as="h1" className="break-words text-[30px] font-bold leading-tight sm:text-large-title">
              {fitCircle.name}
            </GradientText>
            {fitCircle.description && (
              <p className="mt-1 max-w-xl text-subhead text-fg-secondary">{fitCircle.description}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setShowShareDialog(true)}
                data-testid="circle-invite"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-brand px-4 text-footnote font-semibold text-white shadow-glow transition hover:brightness-110 active:scale-95"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Invite
              </button>
              <button
                type="button"
                onClick={() => openTab('chat')}
                data-testid="circle-chat"
                className="relative inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-indigo px-4 text-footnote font-semibold text-white transition hover:brightness-110 active:scale-95"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Chat
                {chatUnread > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold leading-none text-brand-indigo">
                    {chatUnread > 99 ? '99+' : chatUnread}
                  </span>
                )}
              </button>
            </div>
          </header>

          <Tabs value={activeTab} onValueChange={openTab} className="w-full">
            <TabsList className="mx-auto mb-5 grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="overview" className="gap-1.5">
                <LayoutGrid className="h-4 w-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="chat" className="gap-1.5">
                <MessageCircle className="h-4 w-4" />
                Chat
                {chatUnread > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-indigo px-1 text-[10px] font-semibold leading-none text-white">
                    {chatUnread > 99 ? '99+' : chatUnread}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="nutrition" className="gap-1.5">
                <Salad className="h-4 w-4" />
                Nutrition
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-0">
              {/* Phones: one column in the iOS order (streak, info, challenges, leaderboard).
                  Desktop: leaderboard column + info column. The column wrappers are
                  `display: contents` on phones so `order-*` can interleave them. */}
              <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
                <div className="contents lg:block lg:min-w-0 lg:space-y-5">
                  {/* Circle streak + today's check-ins + shared save pool */}
                  {circleStreak !== undefined && (
                    <div className="order-1 lg:order-none">
                    <CircleStreakLiveCard
                      circleId={circleId}
                      status={circleStreak}
                      viewerId={user?.id}
                      onChanged={setCircleStreak}
                    />
                    </div>
                  )}

                  {/* Leaderboard */}
                  <motion.section
                    className="order-5 lg:order-none"
                    viewport={{ once: true }}
                    onViewportEnter={() => analytics.track(AnalyticsEvents.leaderboardViewed())}
                    aria-labelledby="leaderboard-title"
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-brand-orange" aria-hidden />
                      <h2 id="leaderboard-title" className="text-title3 text-white">Leaderboard</h2>
                      {participants.length > 0 && (
                        <span className="ml-auto text-caption text-fg-tertiary">{participants.length} members</span>
                      )}
                    </div>
                    {participants.length === 0 ? (
                      <GlassCard>
                        <EmptyState
                          icon={Trophy}
                          tone="orange"
                          title="No Rankings Yet"
                          description="Check in daily to appear on the leaderboard"
                        />
                      </GlassCard>
                    ) : (
                      <ul className="space-y-2" data-testid="leaderboard">
                        {participants.map((participant, index) => (
                          <LeaderboardRow
                            key={participant.id}
                            rank={index + 1}
                            entry={participant}
                            isYou={participant.user_id === user?.id}
                            isCreator={participant.user_id === fitCircle.creator_id}
                            checkedInToday={isInToday(participant)}
                            onClick={() => void handleParticipantClick(participant)}
                          />
                        ))}
                      </ul>
                    )}
                  </motion.section>

                  {/* Primary action */}
                  <div className="order-6 lg:order-none">
                  {fitCircle.is_participant ? (
                    <Button size="lg" fullWidth onClick={() => setShowSubmitProgressDialog(true)} data-testid="submit-progress">
                      <TrendingUp className="mr-2 h-5 w-5" />
                      Submit Progress
                    </Button>
                  ) : (
                    <Button size="lg" fullWidth onClick={() => setShowShareDialog(true)}>
                      <UserPlus className="mr-2 h-5 w-5" />
                      Join Challenge
                    </Button>
                  )}
                  </div>
                </div>

                <div className="contents lg:block lg:min-w-0 lg:space-y-5">
                  {/* iOS InfoCards */}
                  <div className="order-2 grid grid-cols-2 gap-3 lg:order-none" data-testid="circle-stats">
                    <StatTile
                      icon={Users}
                      tone="indigo"
                      label="Participants"
                      value={fitCircle.max_participants ? `${participants.length}/${fitCircle.max_participants}` : participants.length}
                    />
                    <StatTile icon={Calendar} tone="orange" label="Days Left" value={getDaysRemaining(fitCircle.end_date)} />
                    <StatTile icon={Target} tone="green" label="Challenge Type" value={<span className="text-headline">{circleTypeLabel(fitCircle.type)}</span>} />
                    <StatTile
                      icon={Clock}
                      tone="purple"
                      label="Duration"
                      value={<span className="text-headline">{durationLabel(fitCircle.start_date, fitCircle.end_date)}</span>}
                      sub={`${formatDate(fitCircle.start_date)} – ${formatDate(fitCircle.end_date)}`}
                    />
                  </div>

                  <GlassCard className="order-3 lg:order-none">
                    <CircleChallengesSection
                      circleId={circleId}
                      circleMembers={participants.map((p) => ({
                        user_id: p.user_id,
                        display_name: p.display_name,
                        avatar_url: p.avatar_url,
                      }))}
                    />
                  </GlassCard>

                  <div className="order-4 empty:hidden lg:order-none">
                    <CircleQuestsSection circleId={circleId} />
                  </div>

                  <ListGroup className="order-7 mb-0 lg:order-none">
                    <ListRow
                      icon={Salad}
                      tone="green"
                      title="Food Feed"
                      subtitle="Meals your circle shared"
                      onClick={() => openTab('nutrition')}
                      chevron
                      testId="food-feed-row"
                    />
                    <ListRow
                      icon={Share2}
                      tone="indigo"
                      title="Share circle"
                      subtitle={fitCircle.invite_code ? `Code ${fitCircle.invite_code}` : 'Invite link'}
                      onClick={() => setShowShareDialog(true)}
                      chevron
                    />
                  </ListGroup>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="chat" className="mt-0">
              <GlassCard className="mx-auto max-w-3xl p-3 sm:p-4">
                <CircleChat circleId={circleId} />
              </GlassCard>
            </TabsContent>

            <TabsContent value="nutrition" className="mt-0">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Logging + Plate Score column */}
                <div className="space-y-4 lg:col-span-1">
                  <GlassCard>
                    <h3 className="mb-3 text-headline text-white">Log a meal</h3>
                    <div className="space-y-3">
                      <PhotoLog onLogged={() => setFoodFeedKey((k) => k + 1)} />
                      <VoiceLog onLogged={() => setFoodFeedKey((k) => k + 1)} />
                      <FoodSearch />
                    </div>
                  </GlassCard>

                  <PlateScoreCard />

                  <NutritionChallengeCard circleId={circleId} isCreator={fitCircle.is_creator} />

                  <FitzyChat circleId={circleId} />
                </div>

                {/* Feed column */}
                <div className="space-y-4 lg:col-span-2">
                  <GlassCard>
                    <h3 className="mb-3 text-headline text-white">Circle food feed</h3>
                    <CircleFoodFeed key={foodFeedKey} circleId={circleId} privacyTier={foodPrivacyTier} />
                  </GlassCard>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <GroupMealComposer
                      circleId={circleId}
                      members={participants.map((p) => ({
                        user_id: p.user_id,
                        display_name: p.display_name,
                        avatar_url: p.avatar_url,
                      }))}
                      currentUserId={user?.id}
                      onCreated={() => setFoodFeedKey((k) => k + 1)}
                    />
                    <GlassCard>
                      <h3 className="mb-3 text-headline text-white">Meal invites</h3>
                      <GroupMealInbox circleId={circleId} onChanged={() => setFoodFeedKey((k) => k + 1)} />
                    </GlassCard>
                  </div>

                  <GlassCard>
                    <h3 className="mb-3 text-headline text-white">Insights</h3>
                    <InsightsList />
                  </GlassCard>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </Screen>

        {/* Participant Detail Modal */}
        {showDetailModal && selectedParticipant && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-slate-900/95 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header - Sticky */}
              <div className="flex-shrink-0 flex items-center justify-between mb-6 p-6 border-b border-slate-800">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
                    {selectedParticipant.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                      <span>{selectedParticipant.display_name}</span>
                      {selectedParticipant.user_id === fitCircle?.creator_id && (
                        <Crown className="h-5 w-5 text-yellow-500" />
                      )}
                      {selectedParticipant.user_id === user?.id && (
                        <Badge variant="outline" className="text-xs border-indigo-500/50 text-indigo-400">
                          You
                        </Badge>
                      )}
                    </h2>
                    <p className="text-gray-400 text-sm">
                      {selectedParticipant.total_entries || 0} entries • {selectedParticipant.progress}% progress
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetailModal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ✕
                </Button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-6">

              {/* Progress Overview - Redesigned */}
              <div className="mb-6 p-6 bg-gradient-to-br from-slate-800/40 to-slate-800/20 rounded-xl border border-slate-700/50">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-sm font-semibold text-white flex items-center gap-2">
                    <BathroomScale className="h-4 w-4 text-purple-400" size={16} />
                    Weight Progress
                  </span>
                  <div className="px-3 py-1 bg-purple-500/20 rounded-full border border-purple-500/30">
                    <span className="text-sm font-bold text-purple-300">{selectedParticipant.progress}%</span>
                  </div>
                </div>

                {/* Weight Stats Grid */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {/* Starting Weight */}
                  <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-slate-700/30 relative group">
                    <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                      Starting
                      {selectedParticipant.user_id === user?.id && !isEditingStartingValue && (
                        <button
                          onClick={handleStartEditStartingValue}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-800 rounded"
                          aria-label="Edit starting weight"
                        >
                          <Edit className="h-3 w-3 text-indigo-400" />
                        </button>
                      )}
                    </div>
                    {isEditingStartingValue && selectedParticipant.user_id === user?.id ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          value={editedStartingValue}
                          onChange={(e) => setEditedStartingValue(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 rounded border border-slate-600 text-white text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          step="0.1"
                          min="0"
                        />
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={handleSaveStartingValue}
                            disabled={isSavingStartingValue}
                            className="p-1 bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
                          >
                            {isSavingStartingValue ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={handleCancelEditStartingValue}
                            disabled={isSavingStartingValue}
                            className="p-1 bg-gray-600 hover:bg-gray-700 rounded text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-lg font-bold text-gray-300">
                        {selectedParticipant.starting_value?.toFixed(1)}
                        <span className="text-xs text-gray-500 ml-1">kg</span>
                      </div>
                    )}
                  </div>

                  {/* Current Weight */}
                  <div className="text-center p-3 bg-gradient-to-br from-purple-500/20 to-purple-600/20 rounded-lg border border-purple-500/30">
                    <div className="text-xs text-purple-400 mb-1 font-medium">Current</div>
                    <div className="text-xl font-bold text-white">
                      {(() => {
                        const current = selectedParticipant.current_value && selectedParticipant.current_value > 0
                          ? selectedParticipant.current_value
                          : selectedParticipant.starting_value;
                        return current?.toFixed(1);
                      })()}
                      <span className="text-xs text-gray-400 ml-1">kg</span>
                    </div>
                  </div>

                  {/* Target Weight */}
                  <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-slate-700/30 relative group">
                    <div className="text-xs text-gray-500 mb-1 flex items-center justify-center gap-1">
                      Target
                      {selectedParticipant.user_id === user?.id && !isEditingTargetValue && (
                        <button
                          onClick={handleStartEditTargetValue}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-slate-800 rounded"
                          aria-label="Edit target weight"
                        >
                          <Edit className="h-3 w-3 text-indigo-400" />
                        </button>
                      )}
                    </div>
                    {isEditingTargetValue && selectedParticipant.user_id === user?.id ? (
                      <div className="space-y-2">
                        <input
                          type="number"
                          value={editedTargetValue}
                          onChange={(e) => setEditedTargetValue(e.target.value)}
                          className="w-full px-2 py-1 bg-slate-800 rounded border border-slate-600 text-white text-center text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          step="0.1"
                          min="0"
                        />
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={handleSaveTargetValue}
                            disabled={isSavingTargetValue}
                            className="p-1 bg-green-600 hover:bg-green-700 rounded text-white disabled:opacity-50"
                          >
                            {isSavingTargetValue ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            onClick={handleCancelEditTargetValue}
                            disabled={isSavingTargetValue}
                            className="p-1 bg-gray-600 hover:bg-gray-700 rounded text-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-lg font-bold text-gray-300">
                        {selectedParticipant.target_value?.toFixed(1)}
                        <span className="text-xs text-gray-500 ml-1">kg</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mb-4">
                  <Progress value={selectedParticipant.progress} className="h-3 bg-slate-800" />
                </div>

                {/* Progress Summary */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-green-400" />
                    <span className="text-gray-400">Lost:</span>
                    <span className="font-bold text-green-400">
                      {selectedParticipant.starting_value && selectedParticipant.current_value && selectedParticipant.current_value > 0
                        ? `${(selectedParticipant.starting_value - selectedParticipant.current_value).toFixed(1)} kg`
                        : '0.0 kg'
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-orange-400" />
                    <span className="text-gray-400">To Go:</span>
                    <span className="font-bold text-orange-400">
                      {selectedParticipant.current_value && selectedParticipant.target_value && selectedParticipant.current_value > 0
                        ? `${(selectedParticipant.current_value - selectedParticipant.target_value).toFixed(1)} kg`
                        : selectedParticipant.starting_value && selectedParticipant.target_value
                        ? `${(selectedParticipant.starting_value - selectedParticipant.target_value).toFixed(1)} kg`
                        : '0.0 kg'
                      }
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress Chart/Entries */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">Progress History</h3>
                  <div className="flex items-center space-x-2 text-sm text-gray-400">
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span>Public</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-3 h-3 bg-gray-500 rounded-full"></div>
                      <span>Private</span>
                    </div>
                  </div>
                </div>

                {selectedParticipant.entries && selectedParticipant.entries.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 max-h-96 overflow-y-auto">
                    {selectedParticipant.entries.map((entry) => (
                      <CheckInCard
                        key={`${entry.tracking_date}`}
                        checkIn={{
                          id: `${selectedParticipant.user_id}-${entry.tracking_date}`,
                          user_id: selectedParticipant.user_id,
                          tracking_date: entry.tracking_date,
                          weight_kg: entry.value,
                          steps: null,
                          mood_score: null,
                          energy_level: null,
                          notes: null,
                          is_public: entry.is_public,
                          created_at: entry.tracking_date,
                          updated_at: entry.tracking_date,
                        }}
                        onClick={() => {
                          // For now, just show a toast - full modal integration can be added later
                          toast.info(`${selectedParticipant.display_name}'s check-in on ${new Date(entry.tracking_date).toLocaleDateString()}`);
                        }}
                        compact={true}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400">No progress entries yet</p>
                  </div>
                )}
              </div>

              {/* Privacy Notice */}
              {selectedParticipant.user_id !== user?.id && (
                <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                  <div className="flex items-center space-x-2 text-sm text-gray-400">
                    <Lock className="h-4 w-4" />
                    <span>
                      {selectedParticipant.is_public
                        ? 'This participant has chosen to share their progress publicly.'
                        : 'This participant has chosen to keep their progress private.'
                      }
                    </span>
                  </div>
                </div>
              )}

              </div>
            </motion.div>
          </div>
        )}

        {/* Manage Modal */}
        {showManageModal && fitCircle && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setShowManageModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-slate-900/95 border border-slate-800 rounded-lg max-w-lg w-full my-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="max-h-[80vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-white">Manage FitCircle</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowManageModal(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    ✕
                  </Button>
                </div>

                <div className="space-y-4">
                  {/* Edit Name */}
                  <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <Edit className="h-4 w-4 text-purple-400" />
                        <span className="text-sm font-semibold text-white">FitCircle Name</span>
                      </div>
                      {!isEditingName && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleStartEditName}
                          className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      )}
                    </div>
                    {isEditingName ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editedName}
                          onChange={(e) => setEditedName(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-900 rounded border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="Enter FitCircle name"
                          maxLength={50}
                        />
                        <div className="flex items-center space-x-2">
                          <Button
                            size="sm"
                            onClick={handleSaveName}
                            disabled={!editedName.trim() || isSavingName}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            {isSavingName ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Check className="h-3 w-3 mr-1" />
                                Save
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEditName}
                            disabled={isSavingName}
                            className="text-gray-400 hover:text-white"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-white font-medium">{fitCircle.name}</div>
                    )}
                  </div>

                  {/* Invite Link */}
                  <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <Share2 className="h-4 w-4 text-indigo-400" />
                        <span className="text-sm font-semibold text-white">Invite Link</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="flex-1 px-3 py-2 bg-slate-900 rounded border border-slate-700 text-sm text-gray-300 overflow-x-auto">
                        {inviteUrl}
                      </div>
                      <Button
                        size="sm"
                        onClick={copyInviteCode}
                        className={`${
                          copySuccess
                            ? 'bg-green-600 hover:bg-green-700'
                            : 'bg-indigo-600 hover:bg-indigo-700'
                        }`}
                      >
                        {copySuccess ? (
                          <>
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-1" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">
                      Share this link with friends to invite them to join
                    </p>
                  </div>

                  {/* Challenge Info */}
                  <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                    <h3 className="text-sm font-semibold text-white mb-3">Challenge Details</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Invite Code:</span>
                        <span className="text-white font-mono">{fitCircle.invite_code}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Visibility:</span>
                        <span className="text-white capitalize">{fitCircle.visibility}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Type:</span>
                        <span className="text-white capitalize">{fitCircle.type.replace('_', ' ')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Edit Start Date - Creator Only */}
                  {fitCircle.is_creator && (
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-4 w-4 text-green-400" />
                          <span className="text-sm font-semibold text-white">Start Date</span>
                        </div>
                        {!isEditingStartDate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleStartEditStartDate}
                            className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                      {isEditingStartDate ? (
                        <div className="space-y-2">
                          <DatePicker
                            value={editedStartDate}
                            onChange={(value) => setEditedStartDate(value)}
                            max={fitCircle.end_date}
                          />
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              onClick={handleSaveStartDate}
                              disabled={!editedStartDate || isSavingStartDate}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isSavingStartDate ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3 mr-1" />
                                  Save
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEditStartDate}
                              disabled={isSavingStartDate}
                              className="text-gray-400 hover:text-white"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-white font-medium">
                          {new Date(fitCircle.start_date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Edit End Date - Creator Only */}
                  {fitCircle.is_creator && (
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-4 w-4 text-orange-400" />
                          <span className="text-sm font-semibold text-white">End Date</span>
                        </div>
                        {!isEditingEndDate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleStartEditEndDate}
                            className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>
                      {isEditingEndDate ? (
                        <div className="space-y-2">
                          <DatePicker
                            value={editedEndDate}
                            onChange={(value) => setEditedEndDate(value)}
                            min={fitCircle.start_date}
                          />
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              onClick={handleSaveEndDate}
                              disabled={!editedEndDate || isSavingEndDate}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isSavingEndDate ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Check className="h-3 w-3 mr-1" />
                                  Save
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEditEndDate}
                              disabled={isSavingEndDate}
                              className="text-gray-400 hover:text-white"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-white font-medium">
                          {new Date(fitCircle.end_date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Remove Participants - Creator Only */}
                  {fitCircle.is_creator && participants.length > 0 && (
                    <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
                      <div className="flex items-center space-x-2 mb-3">
                        <Users className="h-4 w-4 text-red-400" />
                        <span className="text-sm font-semibold text-white">Manage Participants</span>
                      </div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {participants.map((participant) => (
                          <div
                            key={participant.id}
                            className="flex items-center justify-between p-2 bg-slate-900/50 rounded border border-slate-700/30"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                                {participant.display_name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-white flex items-center gap-2">
                                  {participant.display_name}
                                  {participant.is_creator && (
                                    <Crown className="h-3 w-3 text-yellow-500" />
                                  )}
                                  {participant.is_current_user && (
                                    <span className="text-xs text-gray-400">(You)</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {participant.progress}% progress
                                </div>
                              </div>
                            </div>
                            {!participant.is_creator && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRemoveParticipant(participant.user_id, participant.display_name)}
                                disabled={removingParticipantId === participant.user_id}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                {removingParticipantId === participant.user_id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <X className="h-3 w-3" />
                                )}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2 pt-2">
                    <Button
                      variant="outline"
                      className="w-full border-red-500/50 text-red-400 hover:bg-red-500/10"
                      onClick={handleDeleteChallenge}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete FitCircle
                    </Button>
                  </div>
                </div>
              </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Share Dialog */}
        {fitCircle && (
          <ShareFitCircleDialog
            open={showShareDialog}
            onOpenChange={setShowShareDialog}
            fitCircleId={fitCircle.id}
            fitCircleName={fitCircle.name}
            inviteCode={fitCircle.invite_code}
          />
        )}

        {/* Submit Progress Dialog */}
        {fitCircle && user && (
          <SubmitProgressDialog
            open={showSubmitProgressDialog}
            onOpenChange={setShowSubmitProgressDialog}
            challengeId={fitCircle.id}
            challengeName={fitCircle.name}
            challengeType={fitCircle.type as 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom'}
            userId={user.id}
            unitSystem={unitSystem}
            onSubmitSuccess={() => {
              // Refresh participants/leaderboard after submitting progress
              void fetchParticipants();
            }}
          />
        )}
      </div>
    </>
  );
}
