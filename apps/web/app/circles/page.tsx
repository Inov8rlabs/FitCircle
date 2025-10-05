'use client';

import { useState, useEffect } from 'react';
import DashboardNav from '@/components/DashboardNav';
import CircleCreationWizard from '@/components/CircleCreationWizard';
import JoinCircleModal from '@/components/JoinCircleModal';
import { Card, CardContent } from '@/components/ui/card';
import { Users, Plus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

export default function CirclesPage() {
  const { user } = useAuthStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  const [myCircles, setMyCircles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchMyCircles();
    }
  }, [user]);

  const fetchMyCircles = async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('challenge_participants')
        .select(`
          *,
          challenges:challenge_id (
            id,
            name,
            description,
            type,
            status,
            start_date,
            end_date,
            participant_count
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (error) {
        console.error('Supabase error fetching circles:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        throw error;
      }

      console.log('Fetched circles data:', data);
      setMyCircles(data?.map((d: any) => d.challenges).filter(Boolean) || []);
    } catch (error: any) {
      console.error('Error fetching circles:', error);
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

          {/* Empty State */}
          {!isLoading && !hasActiveCircles && (
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
                    className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-white px-8 py-6 text-lg"
                  >
                    <UserPlus className="w-5 h-5 mr-2" />
                    Join with Code
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TODO: Active Circles View */}
          {!isLoading && hasActiveCircles && (
            <div className="text-center text-gray-400 py-12">
              Active circles view coming soon...
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

      {/* Join Circle Modal */}
      <JoinCircleModal
        isOpen={isJoinDialogOpen}
        onClose={() => setIsJoinDialogOpen(false)}
        onSuccess={handleCircleJoined}
      />
    </>
  );
}
