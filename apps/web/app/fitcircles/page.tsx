'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Users,
  Trophy,
  Calendar,
  Target,
  TrendingUp,
  Medal,
  Crown,
  Star,
  Loader2,
  Plus,
  Flame,
  Activity,
  Award,
  ChevronRight,
  UserPlus,
  Clock,
  ArrowRight,
  Share2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import CircleCreationWizard from '@/components/CircleCreationWizard';
import InviteFriendsModal from '@/components/InviteFriendsModal';

interface FitCircle {
  id: string;
  name: string;
  description: string;
  type: 'weight_loss' | 'step_count' | 'workout_minutes' | 'custom';
  status: 'draft' | 'upcoming' | 'active' | 'completed';
  visibility: 'public' | 'private' | 'invite_only';
  start_date: string;
  end_date: string;
  creator_id: string;
  participant_count: number;
  max_participants?: number;
  entry_fee: number;
  prize_pool: number;
  created_at: string;
  invite_code?: string;
}

interface LeaderboardEntry {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  rank: number;
  total_points: number;
  progress_percentage: number;
  last_check_in_at?: string;
  streak_days: number;
  starting_value?: number;
  current_value?: number;
  goal_value?: number;
}

export default function FitCirclesPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [myCircles, setMyCircles] = useState<FitCircle[]>([]);
  const [publicCircles, setPublicCircles] = useState<FitCircle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<FitCircle | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedCircleForInvite, setSelectedCircleForInvite] = useState<FitCircle | null>(null);

  useEffect(() => {
    if (user) {
      fetchMyCircles();
      fetchPublicCircles();
    }
  }, [user]);

  useEffect(() => {
    if (selectedCircle) {
      fetchLeaderboard(selectedCircle.id);
    }
  }, [selectedCircle]);

  const fetchMyCircles = async () => {
    if (!user) return;

    try {
      // Get circles the user is participating in
      const { data: participantData, error: participantError } = await supabase
        .from('challenge_participants')
        .select('challenge_id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (participantError) throw participantError;

      const challengeIds = participantData?.map(p => p.challenge_id) || [];

      if (challengeIds.length === 0) {
        setMyCircles([]);
        return;
      }

      // Fetch full challenge details
      const { data: challenges, error: challengesError } = await supabase
        .from('challenges')
        .select('*')
        .in('id', challengeIds)
        .in('status', ['upcoming', 'active'])
        .order('start_date', { ascending: true });

      if (challengesError) throw challengesError;

      setMyCircles(challenges || []);

      // Auto-select first circle if none selected
      if (challenges && challenges.length > 0 && !selectedCircle) {
        setSelectedCircle(challenges[0]);
      }
    } catch (error) {
      console.error('Error fetching my circles:', error);
      toast.error('Failed to load your FitCircles');
    }
  };

  const fetchPublicCircles = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('visibility', 'public')
        .in('status', ['upcoming', 'active'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setPublicCircles(data || []);
    } catch (error) {
      console.error('Error fetching public circles:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLeaderboard = async (challengeId: string) => {
    setIsLoadingLeaderboard(true);
    try {
      const { data, error } = await supabase
        .from('challenge_participants')
        .select(`
          id,
          user_id,
          rank,
          total_points,
          progress_percentage,
          last_check_in_at,
          streak_days,
          starting_value,
          current_value,
          goal_value,
          profiles:user_id (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('challenge_id', challengeId)
        .eq('status', 'active')
        .order('total_points', { ascending: false })
        .limit(50);

      if (error) throw error;

      const formattedLeaderboard: LeaderboardEntry[] = (data || []).map((p: any, index: number) => ({
        id: p.id,
        user_id: p.user_id,
        username: p.profiles?.username || 'Unknown',
        display_name: p.profiles?.display_name || 'User',
        avatar_url: p.profiles?.avatar_url,
        rank: p.rank || index + 1,
        total_points: p.total_points || 0,
        progress_percentage: p.progress_percentage || 0,
        last_check_in_at: p.last_check_in_at,
        streak_days: p.streak_days || 0,
        starting_value: p.starting_value,
        current_value: p.current_value,
        goal_value: p.goal_value,
      }));

      setLeaderboard(formattedLeaderboard);
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  const joinCircle = async (circleId: string) => {
    if (!user) {
      toast.error('Please log in to join a FitCircle');
      return;
    }

    try {
      const { error } = await supabase
        .from('challenge_participants')
        .insert({
          challenge_id: circleId,
          user_id: user.id,
          status: 'active',
        });

      if (error) throw error;

      toast.success('Successfully joined FitCircle!');
      fetchMyCircles();
      fetchPublicCircles();
    } catch (error: any) {
      console.error('Error joining circle:', error);
      toast.error(error.message || 'Failed to join FitCircle');
    }
  };

  const getDaysRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="h-6 w-6 text-yellow-500" />;
      case 2:
        return <Medal className="h-6 w-6 text-gray-400" />;
      case 3:
        return <Medal className="h-6 w-6 text-amber-600" />;
      default:
        return <span className="font-bold text-lg text-gray-400">#{rank}</span>;
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 sm:mb-12"
          >
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-orange-300 via-purple-400 to-indigo-400 bg-clip-text text-transparent mb-2">
              FitCircles
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Compete with friends, track progress, and achieve your goals together 🏆
            </p>
          </motion.div>

          <Tabs defaultValue="my-circles" className="space-y-6">
            <TabsList className="w-full sm:w-auto grid grid-cols-3 gap-2 bg-slate-900/50 border border-slate-800">
              <TabsTrigger value="my-circles" className="text-sm data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">
                <Trophy className="h-4 w-4 mr-2" />
                My Circles
              </TabsTrigger>
              <TabsTrigger value="browse" className="text-sm data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
                <Users className="h-4 w-4 mr-2" />
                Browse
              </TabsTrigger>
              <TabsTrigger value="create" className="text-sm data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400">
                <Plus className="h-4 w-4 mr-2" />
                Create
              </TabsTrigger>
            </TabsList>

            {/* My Circles Tab */}
            <TabsContent value="my-circles" className="space-y-6">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                </div>
              ) : myCircles.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-800 backdrop-blur-xl overflow-hidden">
                    <CardContent className="flex flex-col items-center justify-center py-16 px-6">
                      {/* Animated Icon */}
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2, duration: 0.5, type: 'spring' }}
                        className="relative mb-6"
                      >
                        <div className="absolute inset-0 bg-orange-500/20 rounded-full blur-2xl animate-pulse" />
                        <div className="relative bg-gradient-to-br from-orange-500/20 to-purple-500/20 p-6 rounded-full">
                          <Users className="h-16 w-16 text-orange-400" />
                        </div>
                      </motion.div>

                      {/* Text Content */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 }}
                        className="text-center mb-8"
                      >
                        <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-300 to-purple-400 bg-clip-text text-transparent mb-3">
                          No Active FitCircles
                        </h3>
                        <p className="text-gray-400 max-w-md mx-auto text-base">
                          Create your first FitCircle to start competing with friends, track progress together, and achieve your fitness goals
                        </p>
                      </motion.div>

                      {/* Action Buttons */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                        className="flex flex-col sm:flex-row gap-3"
                      >
                        <Button
                          size="lg"
                          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 shadow-lg hover:shadow-orange-500/50 transition-all"
                          onClick={() => {
                            // Switch to create tab
                            const createTab = document.querySelector('[value="create"]') as HTMLElement;
                            createTab?.click();
                          }}
                        >
                          <Plus className="h-5 w-5 mr-2" />
                          Create Your First Circle
                        </Button>
                        <Button
                          size="lg"
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800"
                          onClick={() => {
                            // Switch to browse tab
                            const browseTab = document.querySelector('[value="browse"]') as HTMLElement;
                            browseTab?.click();
                          }}
                        >
                          <Users className="h-5 w-5 mr-2" />
                          Browse Public Circles
                        </Button>
                      </motion.div>

                      {/* Decorative Elements */}
                      <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl -z-10" />
                      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl -z-10" />
                    </CardContent>
                  </Card>
                </motion.div>
              ) : myCircles.length === 1 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="flex items-center gap-2 text-white text-2xl mb-2">
                            <Trophy className="h-6 w-6 text-orange-400" />
                            {myCircles[0].name}
                          </CardTitle>
                          <CardDescription className="text-gray-400 text-base">
                            {myCircles[0].description}
                          </CardDescription>
                        </div>
                        <Badge
                          variant={myCircles[0].status === 'active' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {myCircles[0].status}
                        </Badge>
                      </div>

                      {/* Circle Stats */}
                      <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
                        <div className="text-center">
                          <p className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
                            {myCircles[0].participant_count}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">Participants</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
                            {getDaysRemaining(myCircles[0].end_date)}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">Days Left</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-orange-400 bg-clip-text text-transparent">
                            {myCircles[0].type.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">Challenge Type</p>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent>
                      {isLoadingLeaderboard ? (
                        <div className="flex justify-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                        </div>
                      ) : leaderboard.length === 0 ? (
                        <div className="text-center py-12">
                          <Activity className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                          <p className="text-gray-400">No participants yet</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {leaderboard.map((entry, index) => (
                            <motion.div
                              key={entry.id}
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                                entry.user_id === user?.id
                                  ? 'bg-orange-900/30 border border-orange-500/30 shadow-lg'
                                  : 'bg-slate-800/30 hover:bg-slate-800/50'
                              }`}
                            >
                              <div className="flex items-center gap-4">
                                {/* Rank */}
                                <div className="flex items-center justify-center w-10">
                                  {getRankIcon(entry.rank)}
                                </div>

                                {/* Avatar & Name */}
                                <Avatar className="h-12 w-12">
                                  {entry.avatar_url ? (
                                    <AvatarImage src={entry.avatar_url} alt={entry.display_name} />
                                  ) : (
                                    <AvatarFallback className="bg-gradient-to-br from-orange-500 to-purple-600 text-white font-semibold">
                                      {getInitials(entry.display_name)}
                                    </AvatarFallback>
                                  )}
                                </Avatar>

                                <div>
                                  <p className="font-semibold text-white">
                                    {entry.display_name}
                                    {entry.user_id === user?.id && (
                                      <span className="ml-2 text-xs text-orange-400">(You)</span>
                                    )}
                                  </p>
                                  <div className="flex items-center gap-3 text-xs text-gray-400">
                                    <span className="flex items-center gap-1">
                                      <Star className="h-3 w-3 text-yellow-500" />
                                      {entry.total_points.toLocaleString()} pts
                                    </span>
                                    {entry.streak_days > 0 && (
                                      <span className="flex items-center gap-1">
                                        <Flame className="h-3 w-3 text-orange-500" />
                                        {entry.streak_days} day streak
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Progress */}
                              <div className="text-right">
                                <p className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
                                  {entry.progress_percentage.toFixed(0)}%
                                </p>
                                <p className="text-xs text-gray-400">Progress</p>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Circle Selection Sidebar */}
                  <div className="lg:col-span-1 space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                        Your Circles ({myCircles.length})
                      </h3>
                    </div>
                    {myCircles.map((circle) => (
                      <motion.div
                        key={circle.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Card
                          className={`cursor-pointer transition-all ${
                            selectedCircle?.id === circle.id
                              ? 'bg-gradient-to-br from-orange-900/40 to-purple-900/20 border-orange-500/50 shadow-lg shadow-orange-500/10'
                              : 'bg-slate-900/50 border-slate-800 hover:bg-slate-900/70 hover:border-slate-700'
                          }`}
                          onClick={() => setSelectedCircle(circle)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-white mb-1 truncate">{circle.name}</h3>
                                <p className="text-xs text-gray-400 line-clamp-2">{circle.description}</p>
                              </div>
                              <Badge
                                variant={circle.status === 'active' ? 'default' : 'secondary'}
                                className="ml-2 flex-shrink-0"
                              >
                                {circle.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-400">
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {circle.participant_count}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {getDaysRemaining(circle.end_date)}d
                              </span>
                            </div>
                            {selectedCircle?.id === circle.id && (
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: '100%' }}
                                className="h-0.5 bg-gradient-to-r from-orange-500 to-purple-500 mt-3 rounded-full"
                              />
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>

                  {/* Leaderboard */}
                  <div className="lg:col-span-2">
                    {selectedCircle ? (
                      <motion.div
                        key={selectedCircle.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                          <CardHeader className="pb-4">
                            <CardTitle className="flex items-center gap-2 text-white text-xl">
                              <Trophy className="h-5 w-5 text-orange-400" />
                              {selectedCircle.name}
                            </CardTitle>
                            <CardDescription className="text-gray-400 mt-1">
                              Leaderboard • {selectedCircle.participant_count} participants
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {isLoadingLeaderboard ? (
                              <div className="flex justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                              </div>
                            ) : leaderboard.length === 0 ? (
                              <div className="text-center py-12">
                                <Activity className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                                <p className="text-gray-400">No participants yet</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {leaderboard.map((entry, index) => (
                                  <motion.div
                                    key={entry.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={`flex items-center justify-between p-4 rounded-lg transition-all ${
                                      entry.user_id === user?.id
                                        ? 'bg-orange-900/30 border border-orange-500/30'
                                        : 'bg-slate-800/30 hover:bg-slate-800/50'
                                    }`}
                                  >
                                    <div className="flex items-center gap-4">
                                      {/* Rank */}
                                      <div className="flex items-center justify-center w-10">
                                        {getRankIcon(entry.rank)}
                                      </div>

                                      {/* Avatar & Name */}
                                      <Avatar className="h-12 w-12">
                                        {entry.avatar_url ? (
                                          <AvatarImage src={entry.avatar_url} alt={entry.display_name} />
                                        ) : (
                                          <AvatarFallback className="bg-gradient-to-br from-orange-500 to-purple-600 text-white font-semibold">
                                            {getInitials(entry.display_name)}
                                          </AvatarFallback>
                                        )}
                                      </Avatar>

                                      <div>
                                        <p className="font-semibold text-white">
                                          {entry.display_name}
                                          {entry.user_id === user?.id && (
                                            <span className="ml-2 text-xs text-orange-400">(You)</span>
                                          )}
                                        </p>
                                        <div className="flex items-center gap-3 text-xs text-gray-400">
                                          <span className="flex items-center gap-1">
                                            <Star className="h-3 w-3 text-yellow-500" />
                                            {entry.total_points.toLocaleString()} pts
                                          </span>
                                          {entry.streak_days > 0 && (
                                            <span className="flex items-center gap-1">
                                              <Flame className="h-3 w-3 text-orange-500" />
                                              {entry.streak_days} day streak
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Progress */}
                                    <div className="text-right">
                                      <p className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
                                        {entry.progress_percentage.toFixed(0)}%
                                      </p>
                                      <p className="text-xs text-gray-400">Progress</p>
                                    </div>
                                  </motion.div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    ) : (
                      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                        <CardContent className="flex flex-col items-center justify-center py-16">
                          <Target className="h-16 w-16 text-gray-600 mb-4" />
                          <p className="text-gray-400">Select a FitCircle to view leaderboard</p>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Browse Tab */}
            <TabsContent value="browse" className="space-y-6">
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Users className="h-5 w-5 text-purple-400" />
                    Public FitCircles
                  </CardTitle>
                  <CardDescription className="text-gray-400">
                    Join a public challenge and compete with the community
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                    </div>
                  ) : publicCircles.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">No public circles available</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {publicCircles.map((circle) => (
                        <Card key={circle.id} className="bg-slate-800/30 border-slate-700 hover:bg-slate-800/50 transition-all">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="font-semibold text-white mb-1">{circle.name}</h3>
                                <p className="text-sm text-gray-400 line-clamp-2">{circle.description}</p>
                              </div>
                              <Badge variant={circle.status === 'active' ? 'default' : 'secondary'}>
                                {circle.status}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="text-center">
                                <p className="text-lg font-bold text-white">{circle.participant_count}</p>
                                <p className="text-xs text-gray-400">Members</p>
                              </div>
                              <div className="text-center">
                                <p className="text-lg font-bold text-white">{getDaysRemaining(circle.end_date)}</p>
                                <p className="text-xs text-gray-400">Days Left</p>
                              </div>
                            </div>

                            <Button
                              className="w-full bg-purple-600 hover:bg-purple-700"
                              onClick={() => joinCircle(circle.id)}
                            >
                              Join Circle
                              <ChevronRight className="h-4 w-4 ml-2" />
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Create Tab */}
            <TabsContent value="create">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <Card className="bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-800 backdrop-blur-xl">
                  <CardContent className="flex flex-col items-center justify-center py-16 px-6">
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.5, type: 'spring' }}
                      className="relative mb-6"
                    >
                      <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-2xl animate-pulse" />
                      <div className="relative bg-gradient-to-br from-indigo-500/20 to-purple-500/20 p-6 rounded-full">
                        <Plus className="h-16 w-16 text-indigo-400" />
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="text-center mb-8"
                    >
                      <h3 className="text-2xl font-bold bg-gradient-to-r from-indigo-300 to-purple-400 bg-clip-text text-transparent mb-3">
                        Create Your FitCircle
                      </h3>
                      <p className="text-gray-400 max-w-md mx-auto text-base">
                        Start a private fitness challenge with friends. Set goals, track progress, and stay motivated together.
                      </p>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 }}
                    >
                      <Button
                        size="lg"
                        className="bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-700 hover:to-purple-800 shadow-lg hover:shadow-indigo-500/50 transition-all"
                        onClick={() => setShowCreateWizard(true)}
                      >
                        <Plus className="h-5 w-5 mr-2" />
                        Start Creating
                      </Button>
                    </motion.div>
                  </CardContent>
                </Card>
              </motion.div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Creation Wizard Modal */}
      {showCreateWizard && (
        <CircleCreationWizard
          isOpen={showCreateWizard}
          onClose={() => setShowCreateWizard(false)}
          onSuccess={(circle) => {
            setShowCreateWizard(false);
            fetchMyCircles();
            // Optionally navigate to the circle detail page
            router.push(`/fitcircles/${circle.id}`);
          }}
        />
      )}

      {/* Invite Friends Modal */}
      {showInviteModal && selectedCircleForInvite && (
        <InviteFriendsModal
          isOpen={showInviteModal}
          onClose={() => {
            setShowInviteModal(false);
            setSelectedCircleForInvite(null);
          }}
          circleId={selectedCircleForInvite.id}
          circleName={selectedCircleForInvite.name}
          inviteCode={selectedCircleForInvite.invite_code || ''}
        />
      )}
    </div>
  );
}
