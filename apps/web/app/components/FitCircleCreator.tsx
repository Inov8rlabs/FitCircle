'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Users,
  Trophy,
  Calendar,
  Target,
  Lock,
  Globe,
  UserPlus,
  TrendingUp,
  Medal,
  Crown,
  Star,
  Loader2,
  Plus,
  Copy,
  Share2,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

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
}

interface Participant {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  rank: number;
  total_points: number;
  progress_percentage: number;
  last_check_in_at?: string;
}

export default function FitCircleCreator() {
  const { user } = useAuthStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [fitCircles, setFitCircles] = useState<FitCircle[]>([]);
  const [selectedCircle, setSelectedCircle] = useState<FitCircle | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [inviteCode, setInviteCode] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'weight_loss' as const,
    visibility: 'public' as const,
    startDate: '',
    endDate: '',
    maxParticipants: '',
  });

  const challengeTypes = [
    { value: 'weight_loss', label: 'Weight Loss', icon: TrendingUp },
    { value: 'step_count', label: 'Step Count', icon: Target },
    { value: 'workout_minutes', label: 'Workout Minutes', icon: Clock },
    { value: 'custom', label: 'Custom Goal', icon: Star },
  ];

  const handleCreateFitCircle = async () => {
    if (!user) {
      toast.error('Please log in to create a FitCircle');
      return;
    }

    setIsCreating(true);
    try {
      // Calculate registration deadline (1 day before start)
      const startDate = new Date(formData.startDate);
      const registrationDeadline = new Date(startDate);
      registrationDeadline.setDate(registrationDeadline.getDate() - 1);

      const { data, error } = (await supabase
        .from('challenges')
        .insert({
          creator_id: user.id,
          name: formData.name,
          description: formData.description,
          type: formData.type,
          status: 'upcoming',
          visibility: formData.visibility,
          start_date: formData.startDate,
          end_date: formData.endDate,
          registration_deadline: registrationDeadline.toISOString(),
          max_participants: formData.maxParticipants ? parseInt(formData.maxParticipants) : null,
          entry_fee: 0,
          prize_pool: 0,
          rules: {
            daily_checkin_required: true,
            min_checkins_per_week: 5,
            photo_proof_required: false,
          },
          scoring_system: {
            checkin_points: 10,
            goal_achievement_points: 100,
            streak_bonus_points: 5,
          },
        } as any)
        .select()
        .single()) as { data: any; error: any };

      if (error) throw error;

      toast.success('FitCircle created successfully!');
      setIsCreateDialogOpen(false);

      // Reset form
      setFormData({
        name: '',
        description: '',
        type: 'weight_loss',
        visibility: 'public',
        startDate: '',
        endDate: '',
        maxParticipants: '',
      });

      // Refresh FitCircles list
      fetchFitCircles();
    } catch (error: any) {
      console.error('Error creating FitCircle:', error);
      toast.error(error.message || 'Failed to create FitCircle');
    } finally {
      setIsCreating(false);
    }
  };

  const fetchFitCircles = async () => {
    try {
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .in('status', ['upcoming', 'active'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setFitCircles(data || []);
    } catch (error) {
      console.error('Error fetching FitCircles:', error);
    }
  };

  const fetchParticipants = async (challengeId: string) => {
    try {
      const { data, error } = await supabase
        .from('challenge_participants')
        .select(`
          *,
          profiles:user_id (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('challenge_id', challengeId)
        .eq('status', 'active')
        .order('total_points', { ascending: false })
        .limit(10);

      if (error) throw error;

      const formattedParticipants = data?.map((p: any) => ({
        id: p.id,
        user_id: p.user_id,
        username: p.profiles?.username || 'Unknown',
        display_name: p.profiles?.display_name || 'User',
        avatar_url: p.profiles?.avatar_url,
        rank: p.rank || 0,
        total_points: p.total_points || 0,
        progress_percentage: p.progress_percentage || 0,
        last_check_in_at: p.last_check_in_at,
      })) || [];

      setParticipants(formattedParticipants);
    } catch (error) {
      console.error('Error fetching participants:', error);
    }
  };

  const joinFitCircle = async (challengeId: string) => {
    if (!user) {
      toast.error('Please log in to join a FitCircle');
      return;
    }

    try {
      const { error } = await supabase
        .from('challenge_participants')
        .insert({
          challenge_id: challengeId,
          user_id: user.id,
          status: 'active',
        } as any);

      if (error) throw error;

      toast.success('Successfully joined FitCircle!');
      fetchFitCircles();
      if (selectedCircle?.id === challengeId) {
        fetchParticipants(challengeId);
      }
    } catch (error: any) {
      console.error('Error joining FitCircle:', error);
      toast.error(error.message || 'Failed to join FitCircle');
    }
  };

  const copyInviteLink = () => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const link = `${baseUrl}/join/${inviteCode}`;
    navigator.clipboard.writeText(link);
    toast.success('Invite link copied to clipboard!');
  };

  // Mock leaderboard data for demonstration
  const mockLeaderboard = [
    { rank: 1, name: 'Sarah Chen', points: 2450, progress: 85, avatar: '👑' },
    { rank: 2, name: 'Mike Johnson', points: 2200, progress: 78, avatar: '🥈' },
    { rank: 3, name: 'Emma Davis', points: 2100, progress: 75, avatar: '🥉' },
    { rank: 4, name: 'Alex Kim', points: 1950, progress: 70, avatar: '⭐' },
    { rank: 5, name: 'Lisa Wang', points: 1800, progress: 65, avatar: '💪' },
  ];

  return (
    <div className="space-y-6">
      {/* Create FitCircle Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">FitCircles</h2>
          <p className="text-muted-foreground">Join or create fitness challenges with friends</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="lg" className="gap-2">
              <Plus className="h-5 w-5" />
              Create FitCircle
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create a New FitCircle</DialogTitle>
              <DialogDescription>
                Set up a fitness challenge for you and your friends
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Circle Name</Label>
                <Input
                  id="name"
                  placeholder="Summer Shred Challenge"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Let's get fit together this summer! Daily check-ins and weekly progress photos required."
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Challenge Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {challengeTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Visibility</Label>
                  <Select
                    value={formData.visibility}
                    onValueChange={(value: any) => setFormData({ ...formData, visibility: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          Public
                        </div>
                      </SelectItem>
                      <SelectItem value="invite_only">
                        <div className="flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          Invite Only
                        </div>
                      </SelectItem>
                      <SelectItem value="private">
                        <div className="flex items-center gap-2">
                          <Lock className="h-4 w-4" />
                          Private
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxParticipants">Max Participants (Optional)</Label>
                <Input
                  id="maxParticipants"
                  type="number"
                  placeholder="No limit"
                  value={formData.maxParticipants}
                  onChange={(e) => setFormData({ ...formData, maxParticipants: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateFitCircle} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Create FitCircle
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Active FitCircles */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Your Active FitCircle */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-primary" />
                  Summer Transformation
                </CardTitle>
                <CardDescription>Your active FitCircle</CardDescription>
              </div>
              <Badge variant="default">Active</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">12</p>
                <p className="text-xs text-muted-foreground">Participants</p>
              </div>
              <div>
                <p className="text-2xl font-bold">21</p>
                <p className="text-xs text-muted-foreground">Days Left</p>
              </div>
              <div>
                <p className="text-2xl font-bold">#3</p>
                <p className="text-xs text-muted-foreground">Your Rank</p>
              </div>
            </div>

            {/* Mini Leaderboard */}
            <div className="space-y-2">
              <p className="text-sm font-semibold">Top Performers</p>
              {mockLeaderboard.slice(0, 3).map((member) => (
                <div key={member.rank} className="flex items-center justify-between p-2 bg-secondary/50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{member.avatar}</span>
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.points} pts</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={member.rank === 1 ? 'default' : 'secondary'}>
                      #{member.rank}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" variant="outline">
                View Details
              </Button>
              <Button className="flex-1">
                Check In
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Join New FitCircle */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Join a FitCircle
            </CardTitle>
            <CardDescription>Find your motivation squad</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inviteCode">Have an invite code?</Label>
              <div className="flex gap-2">
                <Input
                  id="inviteCode"
                  placeholder="Enter invite code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
                <Button>Join</Button>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or browse public circles</span>
              </div>
            </div>

            {/* Public FitCircles List */}
            <div className="space-y-2">
              <div className="p-3 border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium">New Year Resolution</p>
                  <Badge variant="outline">8/20</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">30-day weight loss challenge</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Starts Jan 1
                  </span>
                </div>
              </div>

              <div className="p-3 border rounded-lg hover:bg-secondary/50 cursor-pointer transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium">10K Steps Daily</p>
                  <Badge variant="outline">15/25</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">Walk your way to fitness</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Ongoing
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Public
                  </span>
                </div>
              </div>
            </div>

            <Button className="w-full" variant="outline">
              Browse All Public Circles
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Full Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Medal className="h-5 w-5" />
            FitCircle Leaderboard
          </CardTitle>
          <CardDescription>Top performers across all active circles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {mockLeaderboard.map((member, index) => (
              <motion.div
                key={member.rank}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8">
                    {member.rank === 1 && <Crown className="h-6 w-6 text-yellow-500" />}
                    {member.rank === 2 && <Medal className="h-6 w-6 text-gray-400" />}
                    {member.rank === 3 && <Medal className="h-6 w-6 text-amber-600" />}
                    {member.rank > 3 && <span className="font-bold text-lg">#{member.rank}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{member.avatar}</span>
                    <div>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-sm text-muted-foreground">{member.points} points</p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{member.progress}%</p>
                  <p className="text-xs text-muted-foreground">Goal Progress</p>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}