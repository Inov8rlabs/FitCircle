import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Challenge as DBChallenge,
  Team as DBTeam,
  ChallengeParticipant,
  TeamMember,
  Profile
} from '@fitcircle/database/types';

// Frontend-friendly interfaces that match our UI needs
export interface Challenge extends Omit<DBChallenge, 'creator_id'> {
  creator?: Profile;
  participants?: (ChallengeParticipant & { user?: Profile })[];
  teams?: DBTeam[];
  isJoined?: boolean;
  userStatus?: string;
  userParticipation?: ChallengeParticipant;
  userTeam?: Team;
}

export interface Participant extends ChallengeParticipant {
  user?: Profile;
}

export interface Team extends DBTeam {
  captain?: Profile;
  members?: (TeamMember & { user?: Profile })[];
  challenge?: DBChallenge;
  isJoined?: boolean;
  userRole?: 'captain' | 'member';
}

interface ChallengeState {
  challenges: Challenge[];
  userChallenges: Challenge[];
  teams: Team[];
  userTeams: Team[];
  currentChallenge: Challenge | null;
  currentTeam: Team | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchChallenges: () => Promise<void>;
  fetchUserChallenges: (userId: string) => Promise<void>;
  joinChallenge: (challengeId: string, userId: string) => Promise<void>;
  leaveChallenge: (challengeId: string, userId: string) => Promise<void>;
  createChallenge: (challenge: Omit<Challenge, 'id' | 'participants' | 'stats'>) => Promise<void>;
  updateChallenge: (id: string, updates: Partial<Challenge>) => Promise<void>;
  deleteChallenge: (id: string) => Promise<void>;

  fetchTeams: () => Promise<void>;
  fetchUserTeams: (userId: string) => Promise<void>;
  joinTeam: (teamId: string, userId: string) => Promise<void>;
  leaveTeam: (teamId: string, userId: string) => Promise<void>;
  createTeam: (team: Omit<Team, 'id' | 'members' | 'stats' | 'createdAt'>) => Promise<void>;
  updateTeam: (id: string, updates: Partial<Team>) => Promise<void>;
  deleteTeam: (id: string) => Promise<void>;

  setCurrentChallenge: (challenge: Challenge | null) => void;
  setCurrentTeam: (team: Team | null) => void;
}

export const useChallengeStore = create<ChallengeState>()(
  persist(
    (set, get) => ({
      challenges: [],
      userChallenges: [],
      teams: [],
      userTeams: [],
      currentChallenge: null,
      currentTeam: null,
      isLoading: false,
      error: null,

      fetchChallenges: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch('/api/challenges?status=active&visibility=public');

          if (!response.ok) {
            throw new Error('Failed to fetch challenges');
          }

          const data = await response.json();
          set({ challenges: data.challenges, isLoading: false });
        } catch (error) {
          console.error('Fetch challenges error:', error);
          set({ error: 'Failed to fetch challenges', isLoading: false });
        }
      },

      fetchUserChallenges: async (userId: string) => {
        set({ isLoading: true, error: null });
        try {
          // Get challenges where user is a participant
          const response = await fetch(`/api/challenges?participant_id=${userId}`);

          if (!response.ok) {
            throw new Error('Failed to fetch user challenges');
          }

          const data = await response.json();
          set({ userChallenges: data.challenges, isLoading: false });
        } catch (error) {
          console.error('Fetch user challenges error:', error);
          set({ error: 'Failed to fetch user challenges', isLoading: false });
        }
      },

      joinChallenge: async (challengeId: string, userId: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`/api/challenges/${challengeId}/join`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to join challenge');
          }

          const data = await response.json();

          // Refresh challenges list
          await get().fetchChallenges();

          set({ isLoading: false });
          return data.participation;
        } catch (error: any) {
          console.error('Join challenge error:', error);
          set({ error: error.message || 'Failed to join challenge', isLoading: false });
          throw error;
        }
      },

      leaveChallenge: async (challengeId: string, userId: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`/api/challenges/${challengeId}/join`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to leave challenge');
          }

          // Refresh challenges list
          await get().fetchChallenges();

          set({ isLoading: false });
        } catch (error: any) {
          console.error('Leave challenge error:', error);
          set({ error: error.message || 'Failed to leave challenge', isLoading: false });
          throw error;
        }
      },

      createChallenge: async (challenge) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch('/api/challenges', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(challenge),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create challenge');
          }

          const data = await response.json();

          // Add new challenge to the list
          set({
            challenges: [...get().challenges, data.challenge],
            isLoading: false,
          });

          return data.challenge;
        } catch (error: any) {
          console.error('Create challenge error:', error);
          set({ error: error.message || 'Failed to create challenge', isLoading: false });
          throw error;
        }
      },

      updateChallenge: async (id: string, updates: Partial<Challenge>) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const challenges = get().challenges.map(c =>
            c.id === id ? { ...c, ...updates } : c
          );

          set({ challenges, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to update challenge', isLoading: false });
        }
      },

      deleteChallenge: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const challenges = get().challenges.filter(c => c.id !== id);
          set({ challenges, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to delete challenge', isLoading: false });
        }
      },

      fetchTeams: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch('/api/teams?is_public=true');

          if (!response.ok) {
            throw new Error('Failed to fetch teams');
          }

          const data = await response.json();
          set({ teams: data.teams, isLoading: false });
        } catch (error) {
          console.error('Fetch teams error:', error);
          set({ error: 'Failed to fetch teams', isLoading: false });
        }
      },

      fetchUserTeams: async (userId: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await fetch(`/api/teams?member_id=${userId}`);

          if (!response.ok) {
            throw new Error('Failed to fetch user teams');
          }

          const data = await response.json();
          set({ userTeams: data.teams, isLoading: false });
        } catch (error) {
          console.error('Fetch user teams error:', error);
          set({ error: 'Failed to fetch user teams', isLoading: false });
        }
      },

      joinTeam: async (teamId: string, userId: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const teams = get().teams.map(t => {
            if (t.id === teamId) {
              const newMember: TeamMember = {
                id: Date.now().toString(),
                userId,
                name: 'New Member',
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
                role: 'member',
                xpContribution: 0,
                joinedAt: new Date().toISOString(),
                isActive: true,
              };
              return {
                ...t,
                members: [...t.members, newMember],
              };
            }
            return t;
          });

          set({ teams, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to join team', isLoading: false });
        }
      },

      leaveTeam: async (teamId: string, userId: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const teams = get().teams.map(t => {
            if (t.id === teamId) {
              return {
                ...t,
                members: t.members.filter(m => m.userId !== userId),
              };
            }
            return t;
          });

          set({ teams, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to leave team', isLoading: false });
        }
      },

      createTeam: async (team) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 1000));

          const newTeam: Team = {
            ...team,
            id: Date.now().toString(),
            members: [],
            stats: {
              totalXP: 0,
              averageLevel: 0,
              collectiveStreak: 0,
              challengesWon: 0,
            },
            createdAt: new Date().toISOString(),
          };

          set({
            teams: [...get().teams, newTeam],
            isLoading: false,
          });
        } catch (error) {
          set({ error: 'Failed to create team', isLoading: false });
        }
      },

      updateTeam: async (id: string, updates: Partial<Team>) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const teams = get().teams.map(t =>
            t.id === id ? { ...t, ...updates } : t
          );

          set({ teams, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to update team', isLoading: false });
        }
      },

      deleteTeam: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const teams = get().teams.filter(t => t.id !== id);
          set({ teams, isLoading: false });
        } catch (error) {
          set({ error: 'Failed to delete team', isLoading: false });
        }
      },

      setCurrentChallenge: (challenge: Challenge | null) => {
        set({ currentChallenge: challenge });
      },

      setCurrentTeam: (team: Team | null) => {
        set({ currentTeam: team });
      },
    }),
    {
      name: 'challenge-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        userChallenges: state.userChallenges,
        userTeams: state.userTeams,
      }),
    }
  )
);