import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Invite friends',
  description: 'Bring friends to FitCircle. Every friend who joins gets you both a free week of Pro.',
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
