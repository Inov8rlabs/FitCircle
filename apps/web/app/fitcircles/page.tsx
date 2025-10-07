'use client';

import { useState, useEffect } from 'react';
import DashboardNav from '@/components/DashboardNav';
import CircleCreationWizard from '@/components/CircleCreationWizard';
import QuickJoinCircle from '@/components/QuickJoinCircle';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Plus, UserPlus, Hash, Trophy, Calendar, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
// import { fitCircleService } from '@/lib/services/fitcircle-service'; // Temporarily disabled due to RLS issues

export default function CirclesPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [myCircles, setMyCircles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (user) {
      fetchMyCircles();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const fetchMyCircles = async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setHasError(false);
    
    try {
      console.log('Starting to fetch circles for user:', user.id);

      // Fetch circles from our API endpoint
      const response = await fetch('/api/fitcircles', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Successfully fetched circles:', data.circles?.length || 0);
        setMyCircles(data.circles || []);
        setIsLoading(false);
        return;
      }

      console.error('API call failed:', response.status, response.statusText);
      const errorData = await response.json().catch(() => ({}));
      console.error('Error response:', errorData);

      // Fallback: Direct query approach
      let userCircles: any[] = [];

      const { data: allChallenges, error: allError } = await supabase
        .from('challenges')
        .select('*')
        .order('created_at', { ascending: false });

      if (!allError && allChallenges) {
        console.log('Successfully fetched all challenges:', allChallenges.length);

        // Type assertion to help TypeScript understand the data structure
        const challenges = allChallenges as any[];

        // Filter for user's challenges (created or participated)
        const createdByUser = challenges.filter(c => c.creator_id === user.id);
        userCircles = [...createdByUser];

        // Try to get participations
        const { data: participations } = await supabase
          .from('challenge_participants')
          .select('challenge_id')
          .eq('user_id', user.id);

        if (participations) {
          // Type assertion to help TypeScript understand the data structure
          const participationData = participations as any[];
          const participantChallengeIds = participationData.map(p => p.challenge_id);
          const participatedChallenges = challenges.filter(
            c => participantChallengeIds.includes(c.id) && c.creator_id !== user.id
          );
          userCircles = [...userCircles, ...participatedChallenges];
        }

        console.log('User has', userCircles.length, 'circles total');
        setMyCircles(userCircles);
      } else {
        // Fallback: Just get user's created challenges
        console.warn('Could not fetch all challenges, trying created only:', allError?.message);

        const { data: createdChallenges, error: createdError } = await supabase
          .from('challenges')
          .select('*')
          .eq('creator_id', user.id);

        if (!createdError && createdChallenges) {
          console.log('Found', createdChallenges.length, 'created challenges');
          setMyCircles(createdChallenges);
        } else {
          console.error('Failed to fetch even created challenges:', createdError?.message);
          console.log('Full error object:', JSON.stringify(createdError));
          setMyCircles([]);
        }
      }
    } catch (error: any) {
      console.error('Exception in fetchMyCircles:', error);
      setMyCircles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCircleCreated = () => {
    setIsCreateDialogOpen(false);
    fetchMyCircles();
  };

  const handleCircleJoined = () => {
    setIsJoinDialogOpen(false);
    fetchMyCircles();
  };

  const hasActiveCircles = myCircles.length > 0;

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          <div className="mb-8">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-2">
              FitCircles
            </h1>
            <p className="text-gray-400 text-sm sm:text-base">
              Join groups and compete with friends
            </p>
          </div>

          {/* Error State */}
          {hasError && (
            <Card className="bg-red-900/20 border-red-800/50 backdrop-blur-xl mb-6">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-red-400 font-semibold mb-1">Unable to load FitCircles</h3>
                    <p className="text-gray-400 text-sm mb-3">
                      There was an issue loading your FitCircles. This might be due to database configuration.
                    </p>
                    <div className="flex gap-3 flex-wrap">
                      <Button
                        onClick={() => {
                          setHasError(false);
                          fetchMyCircles();
                        }}
                        variant="outline"
                        className="border-red-800 hover:bg-red-900/20 text-sm"
                      >
                        Try Again
                      </Button>
                      <Button
                        onClick={() => setIsCreateDialogOpen(true)}
                        className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 text-sm"
                      >
                        Create New Circle
                      </Button>
                      {process.env.NODE_ENV === 'development' && (
                        <Button
                          onClick={async () => {
                            const res = await fetch('/api/debug/test-circles');
                            const data = await res.json();
                            console.log('Debug test results:', data);
                            alert('Check console for debug results');
                          }}
                          variant="outline"
                          className="border-yellow-600 hover:bg-yellow-900/20 text-sm"
                        >
                          Debug Test
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!isLoading && !hasActiveCircles && !hasError && (
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
              <CardContent className="p-12 text-center">
                {/* Icon in circle with gradient background */}
                <div className="mb-6 inline-flex">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-full blur-xl" />
                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-orange-900/40 to-purple-900/40 flex items-center justify-center border border-orange-500/30">
                      <Users className="w-12 h-12 text-orange-400" />
                    </div>
                  </div>
                </div>

                <h3 className="text-2xl font-semibold text-orange-200 mb-2">No Active FitCircles</h3>
                <p className="text-gray-400 mb-8 max-w-lg mx-auto">
                  Create your first FitCircle to start competing with friends, track progress together, and achieve your fitness goals
                </p>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 shadow-lg hover:shadow-orange-500/50 text-white border-0 px-8 py-6 text-lg"
                  >
                    <Plus className="w-5 h-5 mr-2" />
                    Create Your First Circle
                  </Button>

                  <Button
                    onClick={() => setIsJoinDialogOpen(true)}
                    variant="outline"
                    className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-white px-8 py-6 text-lg group"
                  >
                    <Hash className="w-5 h-5 mr-2 group-hover:text-orange-400 transition-colors" />
                    Join with Code
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Active Circles View */}
          {!isLoading && hasActiveCircles && !hasError && (
            <div className="space-y-6">
              {/* Action buttons */}
              <div className="flex gap-4 justify-end mb-6">
                <Button
                  onClick={() => setIsJoinDialogOpen(true)}
                  variant="outline"
                  className="border-slate-700 hover:bg-slate-800"
                >
                  <Hash className="h-4 w-4 mr-2" />
                  Join with Code
                </Button>
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Circle
                </Button>
              </div>

              {/* Loading state */}
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {myCircles.map((circle) => (
                    <motion.div
                      key={circle.challenge_id || circle.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Card
                        className="bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:border-orange-500/50 transition-all cursor-pointer"
                        onClick={() => router.push(`/fitcircles/${circle.challenge_id || circle.id}`)}
                      >
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between mb-4">
                            <div className="p-3 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-lg">
                              <Trophy className="h-6 w-6 text-orange-400" />
                            </div>
                            <Badge
                              variant={circle.status === 'active' ? 'default' : 'secondary'}
                              className="text-xs"
                            >
                              {circle.status}
                            </Badge>
                          </div>
                          
                          <h3 className="text-lg font-semibold text-white mb-2">
                            {circle.name}
                          </h3>
                          
                          {circle.description && (
                            <p className="text-sm text-gray-400 mb-4 line-clamp-2">
                              {circle.description}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              <span>{circle.participant_count || 0} participants</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {new Date(circle.end_date) > new Date()
                                  ? `${Math.ceil((new Date(circle.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))}d left`
                                  : 'Ended'
                                }
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Circle Creation Wizard */}
      <CircleCreationWizard
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSuccess={handleCircleCreated}
      />

      {/* Quick Join Circle Modal */}
      <QuickJoinCircle
        isOpen={isJoinDialogOpen}
        onClose={() => {
          setIsJoinDialogOpen(false);
          if (user) {
            fetchMyCircles(); // Refresh after joining
          }
        }}
      />
    </>
  );
}
