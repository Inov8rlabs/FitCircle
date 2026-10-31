'use client';

import { Battery, Bell, ChevronLeft, Flame, Home, Lock, Search, Signal, Star, User, Users, Utensils, Wifi } from 'lucide-react';

import { ContentCardView, EngageImage, InAppMessageView } from '@/components/engage/layouts';
import { SAMPLE_VALUES, applyPlatformOverride, personalise, pickVariantUrl, renderContent } from '@/lib/engage/preview/content';
import type {
  AssetRef,
  CardLayout,
  EmailContent,
  EngagePlatform,
  InAppLayout,
  MessageContent,
  MessageInput,
  MessageVariant,
  Placement,
  PushContent,
  RenderedContent,
} from '@/lib/engage/types';
import { cn } from '@/lib/utils';

export interface PreviewProps {
  message: Pick<MessageInput, 'channel' | 'placement' | 'layout'>;
  variant: MessageVariant;
  platform: EngagePlatform;
  textScale: number;
  assets: Record<string, AssetRef | undefined>;
  /** Object URL of an image still uploading (instant preview). */
  localImage?: string | null;
}

const PHONE_W = 320;
const PHONE_SCALE = PHONE_W / 390;

function withLocalImage(c: RenderedContent, localImage: string | null | undefined): RenderedContent {
  if (!localImage) return c;
  return { ...c, image: { id: 'local', url: localImage, variants: [], width: 1600, height: 900, dominantColor: '#1e293b', alt: null } };
}

export function PreviewPane({ message, variant, platform, textScale, assets, localImage }: PreviewProps) {
  const ch = message.channel;
  if (ch === 'push') return <PushPreview content={applyPlatformOverride(variant.content as PushContent, variant.platformOverrides as never, platform)} platform={platform} assets={assets} />;
  if (ch === 'email') return <EmailPreview content={applyPlatformOverride(variant.content as EmailContent, variant.platformOverrides as never, platform)} assets={assets} localImage={localImage} />;

  const content = withLocalImage(renderContent(variant as MessageVariant<MessageContent>, platform, assets), localImage);
  const scale = platform === 'web' ? textScale : textScale * PHONE_SCALE;

  if (ch === 'in_app') {
    const layout = (message.layout as InAppLayout) ?? 'modal';
    const iam = <InAppMessageView layout={layout} content={content} platform={platform} textScale={scale} contained />;
    if (platform === 'web') return <WebFrame overlay={iam}><WebDashboard /></WebFrame>;
    return (
      <PhoneFrame platform={platform} overlay={iam}>
        <HomeScreen platform={platform} />
      </PhoneFrame>
    );
  }

  const placement = message.placement ?? 'home_feed';
  const layout = (message.layout as CardLayout) ?? 'card';
  const card = <ContentCardView layout={layout} content={content} platform={platform} textScale={scale} />;
  if (platform === 'web') {
    return (
      <WebFrame>
        <WebDashboard placement={placement} card={card} />
      </WebFrame>
    );
  }
  return (
    <PhoneFrame platform={platform}>
      {placement === 'circles_top' ? (
        <CirclesScreen platform={platform} card={card} />
      ) : placement === 'profile_top' ? (
        <ProfileScreen platform={platform} card={card} />
      ) : placement === 'post_checkin' ? (
        <CheckinScreen platform={platform} card={card} />
      ) : (
        <HomeScreen platform={platform} placement={placement} card={card} />
      )}
    </PhoneFrame>
  );
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

const FONT: Record<EngagePlatform, string> = {
  ios: '-apple-system, "SF Pro Text", system-ui, sans-serif',
  android: 'Roboto, "Google Sans", system-ui, sans-serif',
  web: 'var(--font-inter), Inter, system-ui, sans-serif',
};

export function PhoneFrame({ platform, children, overlay, height = 660, wallpaper }: { platform: EngagePlatform; children: React.ReactNode; overlay?: React.ReactNode; height?: number; wallpaper?: string }) {
  const ios = platform === 'ios';
  return (
    <div className={cn('mx-auto bg-[#0a0a0a] p-[9px] shadow-2xl shadow-black/60 ring-1 ring-white/10', ios ? 'rounded-[48px]' : 'rounded-[34px]')} style={{ width: PHONE_W + 18 }}>
      <div className={cn('relative overflow-hidden', ios ? 'rounded-[40px]' : 'rounded-[26px]')} style={{ height, fontFamily: FONT[platform], background: wallpaper ?? '#070a17' }}>
        <StatusBar platform={platform} />
        <div className="absolute inset-0 overflow-y-auto overscroll-contain pt-[38px] [scrollbar-width:none]">{children}</div>
        {overlay}
        {ios ? (
          <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-[80] h-1 w-28 -translate-x-1/2 rounded-full bg-white/70" />
        ) : (
          <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-[80] h-1 w-20 -translate-x-1/2 rounded-full bg-white/50" />
        )}
      </div>
    </div>
  );
}

function StatusBar({ platform, light }: { platform: EngagePlatform; light?: boolean }) {
  const ios = platform === 'ios';
  return (
    <div className={cn('absolute inset-x-0 top-0 z-[75] flex h-[38px] items-center justify-between text-[12px] font-semibold', ios ? 'px-7' : 'px-5', light ? 'text-black' : 'text-white')}>
      <span>{ios ? '9:41' : '9:41'}</span>
      {ios ? <span className="absolute left-1/2 top-[9px] h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-black" /> : <span className="absolute left-1/2 top-[11px] h-[12px] w-[12px] -translate-x-1/2 rounded-full bg-black ring-2 ring-neutral-800" />}
      <span className="flex items-center gap-1">
        <Signal className="h-3 w-3" />
        <Wifi className="h-3 w-3" />
        <Battery className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

export function WebFrame({ children, overlay }: { children: React.ReactNode; overlay?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-xl bg-[#0b0f1f] shadow-2xl shadow-black/60 ring-1 ring-white/10">
      <div className="flex h-8 items-center gap-2 border-b border-white/5 bg-[#151a2e] px-3">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto flex h-5 w-64 items-center justify-center gap-1 rounded-md bg-black/30 text-[10px] text-slate-400">
          <Lock className="h-2.5 w-2.5" /> fitcircle.ai/dashboard
        </span>
      </div>
      <div className="relative h-[520px] overflow-hidden" style={{ fontFamily: FONT.web }}>
        <div className="absolute inset-0 overflow-y-auto [scrollbar-width:none]">{children}</div>
        {overlay}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App screens (placement contexts)
// ---------------------------------------------------------------------------

function Ghost({ className }: { className?: string }) {
  return <div className={cn('rounded-[18px] bg-white/[0.05] ring-1 ring-white/[0.04]', className)} />;
}

function TabBar({ platform, active }: { platform: EngagePlatform; active: 'home' | 'circles' | 'log' | 'profile' }) {
  const tabs = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'circles', icon: Users, label: 'Circles' },
    { id: 'log', icon: Utensils, label: 'Log' },
    { id: 'profile', icon: User, label: 'Profile' },
  ] as const;
  const android = platform === 'android';
  return (
    <div className={cn('sticky bottom-0 z-10 mt-4 flex justify-around border-t border-white/5 pb-5 pt-2 backdrop-blur-xl', android ? 'bg-[#141831]' : 'bg-[#070a17]/90')}>
      {tabs.map((t) => (
        <div key={t.id} className={cn('flex flex-col items-center gap-0.5 text-[9px]', t.id === active ? 'text-purple-300' : 'text-white/40')}>
          <span className={cn('flex items-center justify-center', android && t.id === active && 'rounded-full bg-purple-500/25 px-4 py-0.5')}>
            <t.icon className="h-[18px] w-[18px]" />
          </span>
          {t.label}
        </div>
      ))}
    </div>
  );
}

function ScreenTitle({ platform, title, sub }: { platform: EngagePlatform; title: string; sub?: string }) {
  return platform === 'android' ? (
    <div className="flex items-center justify-between px-4 pb-2 pt-2">
      <p className="text-[20px] font-medium text-white">{title}</p>
      <span className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
    </div>
  ) : (
    <div className="flex items-end justify-between px-4 pb-2 pt-2">
      <div>
        {sub && <p className="text-[11px] font-semibold uppercase text-white/40">{sub}</p>}
        <p className="text-[28px] font-bold leading-tight tracking-tight text-white">{title}</p>
      </div>
      <span className="mb-1 h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
    </div>
  );
}

function Slot({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return <div className={cn('relative', highlight && 'rounded-[22px] outline outline-2 outline-offset-4 outline-purple-400/50')}>{children}</div>;
}

function StreakCard() {
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-gradient-to-br from-orange-500/25 to-rose-500/10 p-3 ring-1 ring-orange-400/20">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/30">
        <Flame className="h-5 w-5 text-orange-300" />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-white">12-day streak</p>
        <p className="text-[11px] text-white/50">Log a meal to keep it going</p>
      </div>
    </div>
  );
}

function HomeScreen({ platform, placement, card }: { platform: EngagePlatform; placement?: Placement; card?: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenTitle platform={platform} title="Today" sub="Friday, Oct 16" />
      <div className="flex-1 space-y-3 px-3">
        {placement === 'home_hero' && card ? <Slot highlight>{card}</Slot> : <Ghost className="h-32" />}
        <StreakCard />
        {placement === 'home_feed' && card && <Slot highlight>{card}</Slot>}
        <div className="grid grid-cols-3 gap-2">
          <Ghost className="h-16" />
          <Ghost className="h-16" />
          <Ghost className="h-16" />
        </div>
        <Ghost className="h-28" />
      </div>
      <TabBar platform={platform} active="home" />
    </div>
  );
}

function CirclesScreen({ platform, card }: { platform: EngagePlatform; card: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenTitle platform={platform} title="Circles" />
      <div className="flex-1 space-y-3 px-3">
        <Slot highlight>{card}</Slot>
        {['Morning Crew', 'Office Steps', 'Hold the Line'].map((n, i) => (
          <div key={n} className="flex items-center gap-3 rounded-[18px] bg-white/[0.05] p-3">
            <span className={cn('h-10 w-10 rounded-full', ['bg-sky-500/40', 'bg-fuchsia-500/40', 'bg-emerald-500/40'][i])} />
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-white">{n}</p>
              <p className="text-[11px] text-white/50">{5 - i} members · day {9 + i}</p>
            </div>
          </div>
        ))}
      </div>
      <TabBar platform={platform} active="circles" />
    </div>
  );
}

function ProfileScreen({ platform, card }: { platform: EngagePlatform; card: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <ScreenTitle platform={platform} title="Profile" />
      <div className="flex-1 space-y-3 px-3">
        <Slot highlight>{card}</Slot>
        <div className="flex items-center gap-3 rounded-[18px] bg-white/[0.05] p-3">
          <span className="h-14 w-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
          <div>
            <p className="text-[15px] font-semibold text-white">Alex Rivera</p>
            <p className="text-[11px] text-white/50">Pro · joined March</p>
          </div>
        </div>
        <Ghost className="h-12" />
        <Ghost className="h-12" />
        <Ghost className="h-12" />
      </div>
      <TabBar platform={platform} active="profile" />
    </div>
  );
}

function CheckinScreen({ platform, card }: { platform: EngagePlatform; card: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center bg-gradient-to-b from-purple-900/60 via-[#070a17] to-[#070a17] px-4 pb-8 pt-10 text-center">
      <div className="relative">
        <div className="absolute -inset-4 rounded-full bg-orange-500/30 blur-2xl" />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-rose-500 text-5xl shadow-xl">🔥</span>
      </div>
      <p className="mt-5 text-[26px] font-bold text-white">Day 13!</p>
      <p className="mt-1 text-[13px] text-white/60">Your streak is counted. Keep showing up.</p>
      <div className="mt-3 flex gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Star key={i} className="h-4 w-4 fill-amber-300 text-amber-300" />
        ))}
      </div>
      <div className="mt-6 w-full text-left">
        <Slot highlight>{card}</Slot>
      </div>
      <div className={cn('mt-auto w-full pt-6 text-[15px] font-semibold text-slate-900', platform === 'android' ? 'rounded-full bg-white py-3' : 'rounded-[14px] bg-white py-3')}>Done</div>
    </div>
  );
}

function WebDashboard({ placement, card }: { placement?: Placement; card?: React.ReactNode }) {
  const label: Partial<Record<Placement, string>> = { circles_top: 'FitCircles', profile_top: 'Profile', post_checkin: 'Check-in complete' };
  const page = placement && label[placement] ? label[placement] : 'Dashboard';
  return (
    <div className="min-h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="flex h-11 items-center justify-between border-b border-white/5 px-4">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-white">
          <span className="inline-block h-4 w-4 rounded-full border-[3px] border-purple-400" /> FitCircle
        </span>
        <span className="flex gap-3 text-[11px] text-white/50">
          <span className={page === 'Dashboard' ? 'text-indigo-300' : ''}>Dashboard</span>
          <span className={page === 'FitCircles' ? 'text-indigo-300' : ''}>FitCircles</span>
        </span>
        <span className="h-6 w-6 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600" />
      </div>
      <div className="space-y-3 p-4">
        <p className="bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-lg font-bold text-transparent">{page === 'Dashboard' ? 'Welcome back, Alex!' : page}</p>
        {placement === 'home_hero' && card ? <Slot highlight>{card}</Slot> : placement && placement !== 'home_feed' && card ? <Slot highlight>{card}</Slot> : <Ghost className="h-24 rounded-2xl" />}
        <div className="grid grid-cols-3 gap-2">
          <Ghost className="h-16 rounded-xl" />
          <Ghost className="h-16 rounded-xl" />
          <Ghost className="h-16 rounded-xl" />
        </div>
        <StreakCard />
        {placement === 'home_feed' && card && <Slot highlight>{card}</Slot>}
        <Ghost className="h-32 rounded-2xl" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push + email
// ---------------------------------------------------------------------------

function PushPreview({ content, platform, assets }: { content: PushContent; platform: EngagePlatform; assets: Record<string, AssetRef | undefined> }) {
  const title = personalise(content.title, SAMPLE_VALUES) || 'Notification title';
  const body = personalise(content.body, SAMPLE_VALUES) || 'Notification body';
  const img = content.image?.assetId ? assets[content.image.assetId] ?? null : null;
  if (platform === 'web') {
    return (
      <div className="mx-auto max-w-sm rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-center text-sm text-amber-100">
        <Bell className="mx-auto mb-2 h-6 w-6" />
        Web push isn&apos;t supported. Web users are excluded from push messages.
      </div>
    );
  }
  const ios = platform === 'ios';
  return (
    <PhoneFrame platform={platform} wallpaper={ios ? 'linear-gradient(160deg,#3b2a7a 0%,#1d2b64 45%,#0b1023 100%)' : 'linear-gradient(170deg,#203a43 0%,#2c5364 50%,#0f2027 100%)'}>
      <div className="px-3 pt-6 text-center text-white">
        {ios ? (
          <>
            <p className="text-[15px] font-semibold opacity-90">Friday, October 16</p>
            <p className="text-[76px] font-bold leading-none tracking-tight">9:41</p>
          </>
        ) : (
          <>
            <p className="text-[64px] font-normal leading-none">9:41</p>
            <p className="mt-1 text-[13px] opacity-80">Fri, Oct 16</p>
          </>
        )}
      </div>
      <div className="mt-8 px-2.5">
        {ios ? (
          <div className="rounded-[22px] bg-white/25 p-3 text-white backdrop-blur-2xl">
            <div className="flex items-start gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.png" alt="" className="h-[38px] w-[38px] rounded-[9px]" />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-[13px]">
                  <span className="font-semibold">{title}</span>
                  <span className="text-white/60">now</span>
                </div>
                <p className="text-[13px] leading-snug text-white/90">{body}</p>
              </div>
              {img && <EngageImage image={img} neededPx={120} className="h-[38px] w-[38px] shrink-0 rounded-md" />}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] bg-[#e9eef6] text-[#1f1f1f]">
            <div className="p-3.5">
              <div className="flex items-center gap-1.5 text-[11px] text-[#444]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="" className="h-4 w-4 rounded-full" />
                FitCircle · now
              </div>
              <p className="mt-1.5 text-[14px] font-medium">{title}</p>
              <p className="text-[13px] text-[#444]">{body}</p>
            </div>
            {img && <EngageImage image={img} neededPx={640} className="mx-3.5 mb-3.5 aspect-[2/1] rounded-[14px]" />}
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function EmailPreview({ content, assets, localImage }: { content: EmailContent; assets: Record<string, AssetRef | undefined>; localImage?: string | null }) {
  const p = (s: string) => personalise(s ?? '', SAMPLE_VALUES);
  const img = content.image?.assetId ? assets[content.image.assetId] ?? null : null;
  const src = localImage ?? (img ? pickVariantUrl(img, 960) : null);
  return (
    <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-slate-500">
        <ChevronLeft className="h-4 w-4" />
        <Search className="ml-auto h-4 w-4" />
      </div>
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[15px] font-semibold text-slate-900">{p(content.subject) || 'Subject line'}</p>
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-8 w-8 rounded-full" />
          <div className="text-xs">
            <p className="font-semibold text-slate-900">
              FitCircle <span className="font-normal text-slate-500">&lt;team@fitcircle.ai&gt;</span>
            </p>
            <p className="text-slate-500">to me · {p(content.preheader)}</p>
          </div>
        </div>
      </div>
      <div className="bg-[#0b0f1f] p-5">
        <div className="mx-auto max-w-[460px] overflow-hidden rounded-2xl bg-[#111830]">
          <div className="h-1.5 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500" />
          {src && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="block aspect-[2/1] w-full object-cover" />
          )}
          <div className="space-y-3 p-5">
            <p className="text-xl font-bold text-white">{p(content.heading) || 'Heading'}</p>
            {p(content.body)
              .split(/\n\s*\n/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {para}
                </p>
              ))}
            <span className="inline-block rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white">{p(content.ctaLabel) || 'Open FitCircle'}</span>
            <p className="pt-2 text-[11px] text-slate-500">You&apos;re getting this because you opted in to FitCircle news · Unsubscribe</p>
          </div>
        </div>
      </div>
    </div>
  );
}
