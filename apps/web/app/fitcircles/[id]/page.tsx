'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Trophy,
  Users,
  Activity,
  Settings,
  Calendar,
  Clock,
  Target,
  Flame,
  ChevronRight,
  Share2,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  TrendingUp,
  Hand,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import DashboardNav from '@/components/DashboardNav';
import PrivacyLeaderboard from '@/components/PrivacyLeaderboard';
import CircleActivityFeed from '@/components/CircleActivityFeed';
import CircleProgressDashboard from '@/components/CircleProgressDashboard';
import InviteFriendsModal from '@/components/InviteFriendsModal';

interface CircleDetails {
  id: string;
  name: string;
  description: string;
  type: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  status: 'upcoming' | 'active' | 'completed';
  start_date: string;
  end_date: string;
  participant_count: number;
  max_participants?: number;
  creator_id: string;
  invite_code?: string;
  rules?: any;
}

interface CircleMember {
  id: string;
  user_id: string;
  display_name: string;
  avatar_url?: string;
  progress_percentage: number;
  streak_days: number;
  last_check_in_at?: string;
  checked_in_today: boolean;
  high_fives_received: number;
  rank?: number;
}

export default function CircleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const [circleId] = useState(params.id as string);
  const [circleDetails, setCircleDetails] = useState<CircleDetails | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userProgress, setUserProgress] = useState(0);
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    if (circleId && user) {
      fetchCircleDetails();
      fetchMembers();
      checkMembership();
    }
  }, [circleId, user]);

  const fetchCircleDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .eq('id', circleId)
        .single();

      if (error) throw error;
      setCircleDetails(data);
    } catch (error) {
      console.error('Error fetching circle details:', error);
      toast.error('Failed to load circle details');
    }
  };

  const fetchMembers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('fitcircle_members')
        .select(`
          *,
          profiles:user_id (
            display_name,
            avatar_url
          )
        `)
        .eq('circle_id', circleId)
        .eq('is_active', true)
        .order('progress_percentage', { ascending: false });

      if (error) throw error;

      const formattedMembers: CircleMember[] = (data || []).map((member: any, index: number) => {
        const lastCheckIn = member.last_check_in_at ? new Date(member.last_check_in_at) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkedInToday = lastCheckIn ? lastCheckIn >= today : false;

        return {
          id: member.id,
          user_id: member.user_id,
          display_name: member.profiles?.display_name || 'User',
          avatar_url: member.profiles?.avatar_url,
          progress_percentage: member.progress_percentage || 0,
          streak_days: member.streak_days || 0,
          last_check_in_at: member.last_check_in_at,
          checked_in_today: checkedInToday,
          high_fives_received: member.total_high_fives_received || 0,
          rank: index + 1,
        };
      });

      setMembers(formattedMembers);

      // Find current user's rank and progress
      const currentUserMember = formattedMembers.find(m => m.user_id === user?.id);
      if (currentUserMember) {
        setUserRank(currentUserMember.rank || null);
        setUserProgress(currentUserMember.progress_percentage);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const checkMembership = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('fitcircle_members')
        .select('id')
        .eq('circle_id', circleId)
        .eq('user_id', user.id)
        .single();

      setIsMember(!!data);
    } catch (error) {
      console.error('Error checking membership:', error);
      setIsMember(false);
    }
  };

  const calculateDaysRemaining = () => {
    if (!circleDetails) return 0;
    const end = new Date(circleDetails.end_date);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'upcoming':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'completed':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  if (isLoading) {
    return (
      <div>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400 mx-auto mb-4" />
            <p className="text-gray-400">Loading circle details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!circleDetails) {
    return (
      <div>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <Card className="bg-slate-900/50 border-slate-800">
            <CardContent className="p-8 text-center">
              <p className="text-gray-400">Circle not found</p>
              <Button
                onClick={() => router.push('/fitcircles')}
                className="mt-4"
              >
                Back to FitCircles
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          {/* Back Button */}
          <Button
            variant="ghost"
            onClick={() => router.push('/fitcircles')}
            className="mb-6 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to FitCircles
          </Button>

          {/* Header Section */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
              <CardHeader>
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-2xl lg:text-3xl font-bold text-white">
                        {circleDetails.name}
                      </CardTitle>
                      <Badge className={getStatusColor(circleDetails.status)}>
                        {circleDetails.status}
                      </Badge>
                    </div>
                    {circleDetails.description && (
                      <CardDescription className="text-base text-gray-400 mb-4">
                        {circleDetails.description}
                      </CardDescription>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-orange-400 mb-1">
                          <Trophy className="h-4 w-4" />
                          <span className="text-xs">Your Rank</span>
                        </div>
                        <p className="text-2xl font-bold text-white">
                          {userRank ? `#${userRank}` : '-'}
                        </p>
                      </div>

                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-purple-400 mb-1">
                          <TrendingUp className="h-4 w-4" />
                          <span className="text-xs">Your Progress</span>
                        </div>
                        <p className="text-2xl font-bold text-white">
                          {userProgress.toFixed(0)}%
                        </p>
                      </div>

                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-indigo-400 mb-1">
                          <Clock className="h-4 w-4" />
                          <span className="text-xs">Days Left</span>
                        </div>
                        <p className="text-2xl font-bold text-white">
                          {calculateDaysRemaining()}
                        </p>
                      </div>

                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-green-400 mb-1">
                          <Users className="h-4 w-4" />
                          <span className="text-xs">Members</span>
                        </div>
                        <p className="text-2xl font-bold text-white">
                          {circleDetails.participant_count || members.length}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 lg:ml-6">
                    {isMember && (
                      <Button
                        onClick={() => setShowInviteModal(true)}
                        className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
                      >
                        <Share2 className="h-4 w-4 mr-2" />
                        Invite Friends
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="border-slate-700 hover:bg-slate-800"
                      onClick={() => {
                        // Navigate to check-in
                        router.push('/dashboard');
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Daily Check-in
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </motion.div>

          {/* Navigation Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 bg-slate-900/50 border border-slate-800">
              <TabsTrigger
                value="leaderboard"
                className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400"
              >
                <Trophy className="h-4 w-4 mr-2" />
                Leaderboard
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400"
              >
                <Activity className="h-4 w-4 mr-2" />
                Activity
              </TabsTrigger>
              <TabsTrigger
                value="members"
                className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400"
              >
                <Users className="h-4 w-4 mr-2" />
                Members
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400"
              >
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </TabsTrigger>
            </TabsList>

            {/* Leaderboard Tab */}
            <TabsContent value="leaderboard">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <PrivacyLeaderboard
                    members={members}
                    currentUserId={user?.id || ''}
                    circleId={circleId}
                    onHighFive={(memberId) => {
                      // Handle high-five
                      toast.success('High-five sent!');
                    }}
                  />
                </div>
                <div className="lg:col-span-1">
                  <CircleProgressDashboard
                    circleId={circleId}
                    userId={user?.id || ''}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity">
              <CircleActivityFeed circleId={circleId} />
            </TabsContent>

            {/* Members Tab */}
            <TabsContent value="members">
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-white">Circle Members</CardTitle>
                  <CardDescription className="text-gray-400">
                    {members.length} members competing together
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {members.map((member) => (
                      <motion.div
                        key={member.id}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-slate-800/30 rounded-lg p-4 hover:bg-slate-800/50 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-12 w-12">
                            {member.avatar_url ? (
                              <AvatarImage src={member.avatar_url} alt={member.display_name} />
                            ) : (
                              <AvatarFallback className="bg-gradient-to-br from-orange-500 to-purple-600 text-white">
                                {member.display_name[0].toUpperCase()}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div className="flex-1">
                            <p className="text-white font-medium">
                              {member.display_name}
                              {member.user_id === user?.id && (
                                <span className="ml-2 text-xs text-orange-400">(You)</span>
                              )}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                              {member.checked_in_today && (
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3 text-green-400" />
                                  Checked in
                                </span>
                              )}
                              {member.streak_days > 0 && (
                                <span className="flex items-center gap-1">
                                  <Flame className="h-3 w-3 text-orange-400" />
                                  {member.streak_days} days
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings">
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-white">Circle Settings</CardTitle>
                  <CardDescription className="text-gray-400">
                    Manage your circle preferences
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-slate-800/30 rounded-lg p-4">
                    <h3 className="text-white font-medium mb-2">Invite Code</h3>
                    <div className="flex items-center gap-2">
                      <code className="bg-slate-900 px-3 py-1 rounded text-orange-400 font-mono">
                        {circleDetails.invite_code || 'N/A'}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-slate-700"
                        onClick={() => setShowInviteModal(true)}
                      >
                        Share
                      </Button>
                    </div>
                  </div>

                  {user?.id === circleDetails.creator_id && (
                    <div className="bg-slate-800/30 rounded-lg p-4">
                      <h3 className="text-white font-medium mb-2">Admin Actions</h3>
                      <p className="text-sm text-gray-400 mb-3">
                        As the circle creator, you can manage settings
                      </p>
                      <Button variant="outline" className="border-slate-700">
                        Edit Circle Settings
                      </Button>
                    </div>
                  )}

                  <div className="bg-slate-800/30 rounded-lg p-4">
                    <h3 className="text-white font-medium mb-2">Leave Circle</h3>
                    <p className="text-sm text-gray-400 mb-3">
                      You can leave this circle at any time
                    </p>
                    <Button variant="destructive">
                      Leave Circle
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Invite Modal */}
        {showInviteModal && circleDetails.invite_code && (
          <InviteFriendsModal
            isOpen={showInviteModal}
            onClose={() => setShowInviteModal(false)}
            circleId={circleId}
            circleName={circleDetails.name}
            inviteCode={circleDetails.invite_code}
          />
        )}
      </div>
    </div>
  );
}