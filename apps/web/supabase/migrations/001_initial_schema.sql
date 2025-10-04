-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  username TEXT UNIQUE,
  bio TEXT,
  avatar_url TEXT,
  date_of_birth DATE,
  height NUMERIC,
  target_weight NUMERIC,
  activity_level TEXT CHECK (activity_level IN ('sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active')),
  goals TEXT[],
  preferences JSONB DEFAULT '{"units": "metric", "notifications": true, "privacy": "public"}',
  total_xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create check-ins table
CREATE TABLE IF NOT EXISTS public.checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight NUMERIC,
  photos JSONB,
  measurements JSONB,
  mood TEXT CHECK (mood IN ('amazing', 'good', 'okay', 'tired', 'stressed')),
  energy INTEGER CHECK (energy >= 1 AND energy <= 10),
  sleep NUMERIC CHECK (sleep >= 0 AND sleep <= 24),
  water INTEGER CHECK (water >= 0),
  notes TEXT,
  workouts JSONB,
  nutrition JSONB,
  challenge_id UUID,
  xp_earned INTEGER DEFAULT 0,
  streak_day INTEGER DEFAULT 0,
  synced BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(user_id, date)
);

-- Create challenges table
CREATE TABLE IF NOT EXISTS public.challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK (type IN ('weight_loss', 'muscle_gain', 'endurance', 'flexibility', 'nutrition', 'custom')),
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'expert')),
  duration_weeks INTEGER NOT NULL,
  requirements JSONB,
  rewards JSONB,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_public BOOLEAN DEFAULT true,
  participant_count INTEGER DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create challenge participants table
CREATE TABLE IF NOT EXISTS public.challenge_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  progress JSONB DEFAULT '{}',
  completed BOOLEAN DEFAULT false,
  completion_date DATE,
  rank INTEGER,
  UNIQUE(challenge_id, user_id)
);

-- Create teams table
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_public BOOLEAN DEFAULT true,
  member_count INTEGER DEFAULT 0,
  total_xp INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create team members table
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('owner', 'admin', 'member')) DEFAULT 'member',
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  contribution_xp INTEGER DEFAULT 0,
  UNIQUE(team_id, user_id)
);

-- Create uploads table
CREATE TABLE IF NOT EXISTS public.uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Create indexes
CREATE INDEX idx_checkins_user_id ON public.checkins(user_id);
CREATE INDEX idx_checkins_date ON public.checkins(date);
CREATE INDEX idx_checkins_user_date ON public.checkins(user_id, date);
CREATE INDEX idx_challenge_participants_user ON public.challenge_participants(user_id);
CREATE INDEX idx_challenge_participants_challenge ON public.challenge_participants(challenge_id);
CREATE INDEX idx_team_members_user ON public.team_members(user_id);
CREATE INDEX idx_team_members_team ON public.team_members(team_id);
CREATE INDEX idx_uploads_user ON public.uploads(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_checkins_updated_at BEFORE UPDATE ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_challenges_updated_at BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Check-ins policies
CREATE POLICY "Users can view their own check-ins" ON public.checkins
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own check-ins" ON public.checkins
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own check-ins" ON public.checkins
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own check-ins" ON public.checkins
  FOR DELETE USING (auth.uid() = user_id);

-- Challenges policies
CREATE POLICY "Public challenges are viewable by everyone" ON public.challenges
  FOR SELECT USING (is_public = true OR created_by = auth.uid());

CREATE POLICY "Authenticated users can create challenges" ON public.challenges
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update their own challenges" ON public.challenges
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Users can delete their own challenges" ON public.challenges
  FOR DELETE USING (auth.uid() = created_by);

-- Challenge participants policies
CREATE POLICY "Participants can view challenge participation" ON public.challenge_participants
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.challenges
      WHERE challenges.id = challenge_participants.challenge_id
      AND (challenges.is_public = true OR challenges.created_by = auth.uid())
    )
  );

CREATE POLICY "Users can join challenges" ON public.challenge_participants
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own participation" ON public.challenge_participants
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can leave challenges" ON public.challenge_participants
  FOR DELETE USING (auth.uid() = user_id);

-- Teams policies
CREATE POLICY "Public teams are viewable by everyone" ON public.teams
  FOR SELECT USING (is_public = true OR created_by = auth.uid());

CREATE POLICY "Authenticated users can create teams" ON public.teams
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Team owners can update their teams" ON public.teams
  FOR UPDATE USING (auth.uid() = created_by);

CREATE POLICY "Team owners can delete their teams" ON public.teams
  FOR DELETE USING (auth.uid() = created_by);

-- Team members policies
CREATE POLICY "Team members are viewable by team members" ON public.team_members
  FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (
      SELECT 1 FROM public.teams
      WHERE teams.id = team_members.team_id
      AND teams.is_public = true
    )
  );

CREATE POLICY "Users can join teams" ON public.team_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own membership" ON public.team_members
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can leave teams" ON public.team_members
  FOR DELETE USING (auth.uid() = user_id);

-- Uploads policies
CREATE POLICY "Users can view their own uploads" ON public.uploads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own uploads" ON public.uploads
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own uploads" ON public.uploads
  FOR DELETE USING (auth.uid() = user_id);

-- Create storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('fitcircle-media', 'fitcircle-media', true)
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload their own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'fitcircle-media' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update their own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'fitcircle-media' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'fitcircle-media' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Public files are viewable by everyone" ON storage.objects
  FOR SELECT USING (bucket_id = 'fitcircle-media');