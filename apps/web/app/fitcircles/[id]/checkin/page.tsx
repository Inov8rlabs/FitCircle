'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import DashboardNav from '@/components/DashboardNav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Scale,
  Footprints,
  Dumbbell,
  Target,
  Lock,
  Eye,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

export default function CheckInPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const [fitCircle, setFitCircle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [value, setValue] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);

  const circleId = params.id as string;

  useEffect(() => {
    if (circleId && user) {
      fetchFitCircle();
      fetchRecentEntries();
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
        console.error('Error fetching FitCircle:', error);
        return;
      }

      setFitCircle(data);
    } catch (err) {
      console.error('Error fetching FitCircle:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentEntries = async () => {
    try {
      console.log('Fetching recent entries for user:', user?.id, 'in challenge:', circleId);

      // Use our API endpoint instead of RPC functions
      const response = await fetch(`/api/fitcircles/${circleId}/progress`);

      if (response.ok) {
        const data = await response.json();
        console.log('Recent entries received:', data.entries?.length || 0);
        setRecentEntries(data.entries || []);
        return;
      }

      console.error('Progress API failed:', response.status, response.statusText);
      const errorData = await response.json().catch(() => ({}));
      console.error('Error response:', errorData);

      // Fallback: Try direct query
      console.log('Trying fallback direct query for entries...');
      await fetchRecentEntriesFallback();

    } catch (err) {
      console.error('Error fetching recent entries:', err);
      setRecentEntries([]);
    }
  };

  const fetchRecentEntriesFallback = async () => {
    try {
      // Fallback: Fetch entries directly from progress_entries table
      if (!user?.id) return;

      const { data: entriesData, error: entriesError } = await supabase
        .from('progress_entries')
        .select('*')
        .eq('challenge_id', circleId)
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (entriesError) {
        console.error('Fallback query also failed:', entriesError);
        setRecentEntries([]);
        return;
      }

      console.log('Fallback entries received:', entriesData?.length || 0, 'entries');
      setRecentEntries(entriesData || []);
    } catch (err) {
      console.error('Error in fallback fetch:', err);
      setRecentEntries([]);
    }
  };

  const handleSubmit = async () => {
    if (!value || !fitCircle || !user) return;

    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || numericValue < 0) {
      toast.error('Please enter a valid number');
      return;
    }

    setSubmitting(true);

    try {
      // Use our API endpoint for submitting entries
      const response = await fetch(`/api/fitcircles/${circleId}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          value: numericValue,
          is_public: isPublic,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast.success('Progress entry submitted successfully!');

        // Reset form
        setValue('');
        fetchRecentEntries();

        // Redirect back to FitCircle page
        router.push(`/fitcircles/${circleId}`);
      } else {
        const errorData = await response.json();

        if (response.status === 409) {
          toast.error('You\'ve already submitted an entry for today');
        } else {
          toast.error(errorData.error || 'Failed to submit entry');
        }
      }
    } catch (error) {
      console.error('Error submitting entry:', error);
      toast.error('Failed to submit entry');
    } finally {
      setSubmitting(false);
    }
  };

  const getChallengeIcon = (type: string) => {
    switch (type) {
      case 'weight_loss':
        return <Scale className="h-6 w-6 text-blue-400" />;
      case 'step_count':
        return <Footprints className="h-6 w-6 text-green-400" />;
      case 'workout_frequency':
        return <Dumbbell className="h-6 w-6 text-purple-400" />;
      default:
        return <Target className="h-6 w-6 text-orange-400" />;
    }
  };

  const getChallengeUnit = (type: string) => {
    switch (type) {
      case 'weight_loss':
        return 'lbs';
      case 'step_count':
        return 'steps';
      case 'workout_frequency':
        return 'workouts';
      default:
        return 'units';
    }
  };

  if (loading) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Loading...</p>
          </div>
        </div>
      </>
    );
  }

  if (!fitCircle) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
          <Card className="bg-red-900/20 border-red-800/50 backdrop-blur-xl">
            <CardContent className="p-8 text-center">
              <h2 className="text-xl font-semibold text-red-400 mb-2">FitCircle Not Found</h2>
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

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
          {/* Header */}
          <div className="mb-8">
            <Button
              onClick={() => router.push(`/fitcircles/${circleId}`)}
              variant="ghost"
              className="mb-4 text-gray-400 hover:text-white hover:bg-slate-800/50"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to {fitCircle.name}
            </Button>

            <div className="flex items-center space-x-4">
              <div className="p-4 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-lg">
                {getChallengeIcon(fitCircle.type)}
              </div>
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
                  Submit Progress
                </h1>
                <p className="text-gray-400">
                  Track your progress for {fitCircle.name}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Progress Entry Form */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <TrendingUp className="h-5 w-5 text-orange-400" />
                    <span>Add New Entry</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label htmlFor="value" className="text-gray-300">
                      Current Value ({getChallengeUnit(fitCircle.type)})
                    </Label>
                    <Input
                      id="value"
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={`Enter your ${fitCircle.type.replace('_', ' ')} value`}
                      className="bg-slate-800/50 border-slate-700 text-white"
                    />
                  </div>

                  <div className="flex items-center space-x-4">
                    <Button
                      variant={isPublic ? "default" : "outline"}
                      size="sm"
                      onClick={() => setIsPublic(true)}
                      className={isPublic ? "bg-green-600 hover:bg-green-700" : ""}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Public
                    </Button>
                    <Button
                      variant={!isPublic ? "default" : "outline"}
                      size="sm"
                      onClick={() => setIsPublic(false)}
                      className={!isPublic ? "bg-gray-600 hover:bg-gray-700" : ""}
                    >
                      <Lock className="h-4 w-4 mr-2" />
                      Private
                    </Button>
                  </div>

                  <div className="text-sm text-gray-400">
                    {isPublic
                      ? 'Other FitCircle members can see this entry in the leaderboard.'
                      : 'This entry will only be visible to you.'
                    }
                  </div>

                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || !value}
                    className="w-full bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800"
                  >
                    {submitting ? 'Submitting...' : 'Submit Entry'}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Entries */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="bg-slate-900/50 border-slate-800/50 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Calendar className="h-5 w-5 text-blue-400" />
                    <span>Recent Entries</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {recentEntries.length > 0 ? (
                    <div className="space-y-3">
                      {recentEntries.map((entry) => (
                        <div
                          key={entry.id}
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
                              <p className="font-semibold text-white">{entry.value}</p>
                              <p className="text-sm text-gray-400">
                                {new Date(entry.date).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <Badge variant={entry.is_public ? "default" : "secondary"}>
                            {entry.is_public ? 'Public' : 'Private'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Calendar className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                      <p className="text-gray-400">No entries yet</p>
                      <p className="text-sm text-gray-500 mt-2">Submit your first progress entry above!</p>

                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </>
  );
}
