'use client';

import { motion } from 'framer-motion';
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
import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import DashboardNav from '@/components/DashboardNav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';


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
      void fetchFitCircle();
      void fetchRecentEntries();
    }
  }, [circleId, user]);

  const fetchFitCircle = async () => {
    try {
      // Private circle rows are no longer readable by the browser anon-key
      // client (migration 069). The service-role /api/fitcircles/[id] route
      // returns the single circle (authorized: public, or creator/member for
      // private).
      const response = await fetch(`/api/fitcircles/${circleId}`);

      if (!response.ok) {
        console.error('Error fetching FitCircle:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      setFitCircle(data.circle || null);
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
      // Fallback: Fetch entries directly from daily_tracking table
      if (!user?.id || !fitCircle) return;

      // Map challenge type to daily_tracking column
      const columnMap: Record<string, string> = {
        weight_loss: 'weight_kg',
        step_count: 'steps',
        workout_frequency: 'workout_minutes',
        custom: 'weight_kg',
      };

      const column = columnMap[fitCircle.type] || 'weight_kg';

      const { data: entriesData, error: entriesError } = await supabase
        .from('daily_tracking')
        .select(`tracking_date, ${column}`)
        .eq('user_id', user.id)
        .gte('tracking_date', fitCircle.start_date)
        .lte('tracking_date', fitCircle.end_date)
        .not(column, 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(10);

      if (entriesError) {
        console.error('Fallback query also failed:', entriesError);
        setRecentEntries([]);
        return;
      }

      // Transform to match expected format. Supabase's dynamic-column select
      // can't be inferred statically — cast to a permissive shape.
      const rows = (entriesData ?? []) as Array<Record<string, unknown>>;
      const transformedEntries = rows.map((entry) => ({
        date: entry.tracking_date as string,
        value: entry[column] as number,
        is_public: true,
      }));

      console.log('Fallback entries received:', transformedEntries.length, 'entries');
      setRecentEntries(transformedEntries);
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
        analytics.track(
          AnalyticsEvents.checkInCompleted({ is_backfill: false, has_weight: fitCircle.type === 'weight_loss' })
        );
        toast.success('Progress entry submitted successfully!');

        // Reset form
        setValue('');
        void fetchRecentEntries();

        // Redirect back to FitCircle page
        void router.push(`/fitcircles/${circleId}`);
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
        <div className="min-h-screen bg-canvas">
          <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8" aria-busy="true">
            <Skeleton className="mb-4 h-10 w-10 rounded-full" />
            <Skeleton className="h-9 w-64" />
            <Skeleton className="mt-2 h-4 w-48" />
            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Skeleton className="h-80 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!fitCircle) {
    return (
      <>
        <DashboardNav />
        <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-8 text-center">
              <h2 className="mb-4 text-title3 text-white">Circle not found</h2>
              <Button onClick={() => { void router.push('/fitcircles'); }} variant="outline">
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
      <div className="min-h-screen bg-canvas">
        <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
          {/* Header */}
          <div className="mb-8">
            <button
              type="button"
              onClick={() => { void router.push(`/fitcircles/${circleId}`); }}
              aria-label={`Back to ${fitCircle.name}`}
              className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-glass bg-surface-raised/60 text-white transition hover:bg-surface-raised"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-orange/20">
                {getChallengeIcon(fitCircle.type)}
              </div>
              <div className="min-w-0">
                <h1 className="w-fit max-w-full bg-gradient-sunset bg-clip-text text-[30px] font-bold leading-tight text-transparent sm:text-large-title">
                  Submit Progress
                </h1>
                <p className="text-callout text-fg-secondary">
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
              <Card className="bg-surface-raised/50 border-hairline backdrop-blur-xl">
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
                      className="bg-white/5 border-glass text-white"
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
                    className="w-full bg-gradient-orange hover:brightness-110"
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
              <Card className="bg-surface-raised/50 border-hairline backdrop-blur-xl">
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
                              ? 'bg-white/5 border-glass'
                              : 'bg-white/5 border-glass opacity-75'
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
