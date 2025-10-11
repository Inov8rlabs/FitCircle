'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Trophy,
  Users,
  Calendar,
  Target,
  Crown,
  Medal,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowLeft,
  Settings,
  UserPlus,
  MoreHorizontal,
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
} from 'lucide-react';
import { BathroomScale } from '@/components/icons/BathroomScale';
import { DateRangeDisplay, DatePicker } from '@/components/ui/date-picker';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { ShareFitCircleDialog } from '@/components/ShareFitCircleDialog';
import { SubmitProgressDialog } from '@/components/SubmitProgressDialog';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { toast } from 'sonner';

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

  const circleId = params.id as string;

  useEffect(() => {
    if (circleId && user) {
      fetchFitCircle();
      fetchParticipants();
    }
  }, [circleId, user]);

  const fetchFitCircle = async () => {
    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', circleId)
        .single();

      if (error) {
        setError('FitCircle not found');
        return;
      }

      if (data) {
        // Type assertion to help TypeScript understand the data structure
        const challengeData = data as any;
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
          participant_count: 0, // Will be updated by participants fetch
          is_creator: challengeData.creator_id === user?.id,
          is_participant: false, // Will be determined from participants
        });
      }
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
          is_public: true, // daily_tracking visibility will be handled separately
        }));

        setParticipants(participantsList);

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
      // Fallback: Fetch participants directly without progress data
      const { data: participantsData, error: participantsError } = await supabase
        .from('challenge_participants')
        .select(`
          id,
          user_id,
          challenge_id,
          status,
          joined_at,
          profiles!challenge_participants_user_id_fkey (
            display_name,
            avatar_url
          )
        `)
        .eq('challenge_id', circleId)
        .eq('status', 'active');

      if (participantsError) {
        console.error('Fallback query also failed:', participantsError);
        setParticipants([]);
        return;
      }

      if (participantsData) {
        // Create basic participant objects without progress data
        const basicParticipants = participantsData.map((participant: any) => {
          const isCurrentUser = participant.user_id === user?.id;
          return {
            ...participant,
            display_name: participant.profiles?.display_name || participant.profiles?.[0]?.display_name || 'Unknown User',
            avatar_url: participant.profiles?.avatar_url || participant.profiles?.[0]?.avatar_url || '',
            latest_value: 0,
            latest_date: new Date().toISOString().split('T')[0],
            total_entries: 0,
            is_public: false,
            is_creator: participant.user_id === fitCircle?.creator_id,
            is_current_user: isCurrentUser,
            progress: 0,
            current_value: 0,
            target_value: 100,
            progress_percentage: 0,
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
      }
    } catch (err) {
      console.error('Error in fallback fetch:', err);
      setParticipants([]);
    }
  };

  const copyInviteCode = async () => {
    if (!inviteUrl) return;

    await navigator.clipboard.writeText(inviteUrl);
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
      router.push('/fitcircles');
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

  if (loading) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Loading FitCircle...</p>
          </div>
        </div>
      </>
    );
  }

  if (error || !fitCircle) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <Card className="bg-red-900/20 border-red-800/50 backdrop-blur-xl">
            <CardContent className="p-8 text-center">
              <div className="text-red-400 mb-4">
                <AlertCircle className="h-12 w-12 mx-auto" />
              </div>
              <h2 className="text-xl font-semibold text-red-400 mb-2">FitCircle Not Found</h2>
              <p className="text-gray-400 mb-4">{error || 'The FitCircle you\'re looking for doesn\'t exist.'}</p>
              <Button
                onClick={() => router.push('/fitcircles')}
                variant="outline"
                className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to FitCircles
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Medal className="h-5 w-5 text-orange-600" />;
      default:
        return <span className="text-lg font-bold text-gray-500">#{rank}</span>;
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'from-green-500 to-green-600';
    if (progress >= 60) return 'from-orange-500 to-orange-600';
    if (progress >= 40) return 'from-yellow-500 to-yellow-600';
    return 'from-red-500 to-red-600';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getDaysRemaining = (endDate: string) => {
    const now = new Date();
    const end = new Date(endDate);
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle background decorations */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12 overflow-x-hidden">
          {/* Header */}
          <div className="mb-6 sm:mb-8">
            <Button
              onClick={() => router.push('/fitcircles')}
              variant="ghost"
              className="mb-3 sm:mb-4 text-gray-400 hover:text-white hover:bg-slate-800/50 text-xs sm:text-sm"
            >
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Back to FitCircles
            </Button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-1.5 sm:mb-2 break-words">
                  {fitCircle.name}
                </h1>
                <p className="text-gray-400 text-xs sm:text-sm lg:text-base max-w-2xl">
                  {fitCircle.description}
                </p>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {/* Share button - available to all members */}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10 text-xs sm:text-sm"
                  onClick={() => setShowShareDialog(true)}
                >
                  <Share2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Share
                </Button>

                {/* Manage button - only for creators */}
                {fitCircle.is_creator && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10 text-xs sm:text-sm"
                    onClick={() => setShowManageModal(true)}
                  >
                    <Settings className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    Manage
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* FitCircle Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3 lg:gap-4 mb-6 sm:mb-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl h-full">
                <CardContent className="p-3 sm:p-4 lg:p-5 h-full min-h-[90px] sm:min-h-[110px] flex items-center">
                  <div className="flex items-center gap-2 sm:gap-3 w-full">
                    <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 flex-shrink-0">
                      <Users className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-0.5">Participants</p>
                      <p className="text-base sm:text-lg lg:text-xl font-bold text-white truncate">
                        {fitCircle.max_participants
                          ? `${participants.length}/${fitCircle.max_participants}`
                          : participants.length
                        }
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl h-full">
                <CardContent className="p-3 sm:p-4 lg:p-5 h-full min-h-[90px] sm:min-h-[110px] flex items-center">
                  <div className="flex items-center gap-2 sm:gap-3 w-full">
                    <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 flex-shrink-0">
                      <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-0.5">Days Left</p>
                      <p className="text-base sm:text-lg lg:text-xl font-bold text-white">
                        {getDaysRemaining(fitCircle.end_date)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl h-full">
                <CardContent className="p-3 sm:p-4 lg:p-5 h-full min-h-[90px] sm:min-h-[110px] flex items-center">
                  <div className="flex items-center gap-2 sm:gap-3 w-full">
                    <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex-shrink-0">
                      <Trophy className="h-4 w-4 sm:h-5 sm:w-5 text-green-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400 mb-0.5">Type</p>
                      <p className="text-base sm:text-lg lg:text-xl font-bold text-white capitalize truncate">
                        {fitCircle.type.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl h-full">
                <CardContent className="p-3 sm:p-4 lg:p-5 h-full min-h-[90px] sm:min-h-[110px] flex items-center">
                  <div className="flex items-center gap-2 sm:gap-3 w-full">
                    <div className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-lg sm:rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex-shrink-0">
                      <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-purple-400" />
                    </div>
                    <DateRangeDisplay
                      startDate={fitCircle.start_date}
                      endDate={fitCircle.end_date}
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Leaderboard */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 sm:gap-3 text-lg sm:text-xl">
                  <Trophy className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-500 flex-shrink-0" />
                  <span className="bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
                    Leaderboard
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                {participants.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                    <p className="text-gray-400">No participants yet</p>
                    <p className="text-sm text-gray-500 mt-2">Be the first to join this challenge!</p>
                  </div>
                ) : (
                  <div className="space-y-3 sm:space-y-4">
                    {participants.map((participant, index) => {
                      const rank = index + 1;
                      return (
                        <motion.div
                          key={participant.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.1 * index }}
                          className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-lg border transition-all ${
                            participant.user_id === user?.id || participant.is_public
                              ? 'cursor-pointer hover:bg-slate-800/70'
                              : 'cursor-not-allowed'
                          } ${
                            participant.user_id === user?.id
                              ? 'bg-indigo-500/10 border-indigo-500/30'
                              : participant.is_public
                                ? 'bg-slate-800/50 border-slate-700/50 hover:border-orange-500/30'
                                : 'bg-slate-800/30 border-slate-700/30 opacity-60'
                          }`}
                          onClick={() => handleParticipantClick(participant)}
                        >
                          {/* Mobile: Rank + User Info + Progress in one row */}
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                            <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-800/50 flex-shrink-0">
                              {getRankIcon(rank)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 sm:gap-3">
                                <div className="relative flex-shrink-0">
                                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 flex items-center justify-center text-white font-semibold text-xs sm:text-sm">
                                    {participant.display_name.charAt(0).toUpperCase()}
                                  </div>
                                  {!participant.is_public && participant.user_id !== user?.id && (
                                    <div className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-gray-500 rounded-full flex items-center justify-center">
                                      <Lock className="h-2 w-2 text-white" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-semibold text-white text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                    <span className="truncate">{participant.display_name}</span>
                                    {participant.user_id === fitCircle.creator_id && (
                                      <Crown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-500 flex-shrink-0" />
                                    )}
                                    {participant.user_id === user?.id && (
                                      <Badge variant="outline" className="text-xs border-indigo-500/50 text-indigo-400 flex-shrink-0">
                                        You
                                      </Badge>
                                    )}
                                    {!participant.is_public && participant.user_id !== user?.id && (
                                      <Badge variant="secondary" className="text-xs flex-shrink-0">
                                        Private
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs sm:text-sm text-gray-400 truncate">
                                    {participant.current_value ? `${participant.current_value.toFixed(1)} kg` : 'No data'}
                                    {participant.target_value && ` → ${participant.target_value.toFixed(1)} kg goal`}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Mobile: Show progress percentage inline */}
                            <div className="text-right sm:hidden flex-shrink-0">
                              <p className="text-base font-bold text-white">{participant.progress}%</p>
                            </div>
                          </div>

                          {/* Desktop: Progress section */}
                          <div className="hidden sm:flex items-center gap-4 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-lg font-bold text-white">{participant.progress}%</p>
                              <p className="text-sm text-gray-400">Progress</p>
                            </div>
                            <div className="w-32">
                              <Progress
                                value={participant.progress}
                                className={`h-2 bg-slate-800`}
                              />
                              {participant.starting_value && participant.current_value && participant.target_value && (
                                <div className="mt-1.5 text-xs text-center whitespace-nowrap">
                                  <span className="font-semibold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
                                    {(participant.starting_value - participant.current_value).toFixed(1)} kg
                                  </span>
                                  <span className="text-gray-500 mx-1">of</span>
                                  <span className="font-semibold text-gray-300">
                                    {(participant.starting_value - participant.target_value).toFixed(1)} kg
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Mobile: Progress bar and details */}
                          <div className="sm:hidden w-full">
                            <Progress
                              value={participant.progress}
                              className={`h-2 bg-slate-800 mb-2`}
                            />
                            {participant.starting_value && participant.current_value && participant.target_value && (
                              <div className="text-xs text-center">
                                <span className="font-semibold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
                                  {(participant.starting_value - participant.current_value).toFixed(1)} kg
                                </span>
                                <span className="text-gray-500 mx-1">of</span>
                                <span className="font-semibold text-gray-300">
                                  {(participant.starting_value - participant.target_value).toFixed(1)} kg
                                </span>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Action Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="mt-6 sm:mt-8 flex justify-center gap-3 sm:gap-4 px-3 sm:px-0"
          >
            {fitCircle.is_participant && (
              <Button
                size="lg"
                onClick={() => setShowSubmitProgressDialog(true)}
                className="flex-1 sm:flex-initial bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-sm sm:text-base"
              >
                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2" />
                Submit Progress
              </Button>
            )}

            {!fitCircle.is_participant && (
              <Button
                size="lg"
                className="flex-1 sm:flex-initial bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-sm sm:text-base"
              >
                <UserPlus className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2" />
                Join Challenge
              </Button>
            )}
          </motion.div>
        </div>

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
                  <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-slate-700/30">
                    <div className="text-xs text-gray-500 mb-1">Starting</div>
                    <div className="text-lg font-bold text-gray-300">
                      {selectedParticipant.starting_value?.toFixed(1)}
                      <span className="text-xs text-gray-500 ml-1">kg</span>
                    </div>
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
                  <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-slate-700/30">
                    <div className="text-xs text-gray-500 mb-1">Target</div>
                    <div className="text-lg font-bold text-gray-300">
                      {selectedParticipant.target_value?.toFixed(1)}
                      <span className="text-xs text-gray-500 ml-1">kg</span>
                    </div>
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
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {selectedParticipant.entries.map((entry, entryIndex) => (
                      <motion.div
                        key={`${entry.tracking_date}-${entryIndex}`}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: entryIndex * 0.05 }}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          entry.is_public
                            ? 'bg-slate-800/50 border-slate-700/50'
                            : 'bg-slate-800/30 border-slate-700/30 opacity-75'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            entry.is_public
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {entry.is_public ? '👁️' : '🔒'}
                          </div>
                          <div>
                            <p className="font-semibold text-white">{entry.value} kg</p>
                            <p className="text-sm text-gray-400">
                              {new Date(entry.tracking_date).toLocaleDateString()}
                              {entry.is_public ? ' • Public' : ' • Private'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-400">
                            {selectedParticipant.starting_value &&
                              `${(selectedParticipant.starting_value - entry.value).toFixed(1)} kg lost`
                            }
                          </p>
                        </div>
                      </motion.div>
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
              fetchParticipants();
            }}
          />
        )}
      </div>
    </>
  );
}
