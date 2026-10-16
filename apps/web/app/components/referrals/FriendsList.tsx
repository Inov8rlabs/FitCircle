'use client';

import { Check, Clock, Copy, Loader2, Mail, MessageSquare, ShieldAlert, Users, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { copyText } from '@/lib/referrals/clipboard';
import {
  FRIEND_STATUS_LABEL,
  mergeFriends,
  nudgeAnalytics,
  nudgeView,
  progressFraction,
  progressLabel,
  smsHref,
  type FriendRowModel,
  type FriendStatus,
  type HubInviteRow,
  type HubInviteeRow,
} from '@/lib/referrals/invite-form';
import type { NudgeResult } from '@/lib/referrals/types';

const CHIP_STYLE: Record<FriendStatus, string> = {
  invited_email: 'bg-slate-700/40 text-gray-200',
  invited_sms: 'bg-slate-700/40 text-gray-200',
  joined: 'bg-purple-500/15 text-purple-200',
  qualified: 'bg-green-500/15 text-green-300',
  review: 'bg-amber-500/15 text-amber-300',
  rejected: 'bg-slate-700/40 text-gray-400',
};

function ChipIcon({ status }: { status: FriendStatus }) {
  switch (status) {
    case 'invited_email':
      return <Mail className="h-3 w-3" />;
    case 'invited_sms':
      return <MessageSquare className="h-3 w-3" />;
    case 'joined':
      return <Clock className="h-3 w-3" />;
    case 'qualified':
      return <Check className="h-3 w-3" />;
    case 'review':
      return <ShieldAlert className="h-3 w-3" />;
    default:
      return null;
  }
}

/** Merged friends list (§9.1): sent invites first, then joined friends, each with a rate-limited Nudge. */
export function FriendsList({
  invites,
  invitees,
  onChanged,
}: {
  invites: HubInviteRow[] | undefined;
  invitees: HubInviteeRow[] | undefined;
  onChanged: () => void;
}) {
  const rows = mergeFriends(invites, invitees);
  const [sms, setSms] = useState<{ row: FriendRowModel; body: string } | null>(null);

  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-center">
        <Users className="mx-auto h-8 w-8 text-purple-300" />
        <p className="mt-2 font-medium text-white">No friends yet</p>
        <p className="text-sm text-gray-400">Fitness is better together. Send your link to get started.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="mt-4 space-y-2" data-testid="hub-friends">
        {rows.map((row) => (
          <FriendRow key={row.key} row={row} onChanged={onChanged} onSms={(body) => setSms({ row, body })} />
        ))}
      </ul>
      {sms && (
        <div
          role="dialog"
          aria-label="Text your friend"
          className="mt-3 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4"
          data-testid="nudge-sms"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-white">Send {sms.row.name} a reminder from your phone</p>
            <button type="button" aria-label="Close" onClick={() => setSms(null)} className="text-gray-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-sm text-gray-200">{sms.body}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={async () => {
                if (await copyText(sms.body)) toast.success('Message copied');
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-gray-200"
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <a
              href={smsHref(sms.body)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-gray-200"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Open Messages
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function FriendRow({
  row,
  onChanged,
  onSms,
}: {
  row: FriendRowModel;
  onChanged: () => void;
  onSms: (body: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const view = nudgeView(row.nudge);

  const nudge = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/referrals/me/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(row.source === 'invite' ? { inviteId: row.id } : { referralId: row.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        toast.error(body?.error?.message || "Couldn't nudge right now.");
        return;
      }
      const result = body.data as NudgeResult;
      if (result.status === 'sent') {
        analytics.track(AnalyticsEvents.referralNudgeSent(nudgeAnalytics(row)));
        if (result.smsBody) onSms(result.smsBody);
        else toast.success(row.source === 'referral' ? `Cheered ${row.name} on 💪` : `Reminder sent to ${row.name} 💌`);
      } else if (result.status === 'too_soon') {
        toast.info('You nudged them recently. Give it a little time.');
      } else {
        toast.info("They've had all the nudges we send. Over to them now!");
      }
      onChanged();
    } catch {
      toast.error("Couldn't nudge right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-3" data-testid="friend-row">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500 to-pink-500 font-semibold text-white">
        {row.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : row.source === 'invite' && !row.subtitle ? (
          row.channel === 'sms' ? <MessageSquare className="h-4 w-4" /> : <Mail className="h-4 w-4" />
        ) : (
          (row.name.trim().charAt(0) || '?').toUpperCase()
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white">{row.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${CHIP_STYLE[row.status]}`}>
            <ChipIcon status={row.status} /> {FRIEND_STATUS_LABEL[row.status]}
          </span>
          {row.subtitle && <span className="truncate text-xs text-gray-500">{row.subtitle}</span>}
        </div>
        {row.progress && (
          <div className="mt-2 flex items-center gap-2" data-testid="friend-progress">
            <div
              className="h-1.5 max-w-[10rem] flex-1 overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
              aria-label={`${row.name} check-in progress`}
              aria-valuemin={0}
              aria-valuemax={row.progress.required}
              aria-valuenow={Math.min(row.progress.days, row.progress.required)}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-[width] duration-700"
                style={{ width: `${progressFraction(row.progress) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-400">{progressLabel(row.progress)}</span>
          </div>
        )}
      </div>
      {view.kind === 'button' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void nudge()}
          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-purple-500/60 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Nudge'}
        </button>
      )}
      {view.kind === 'wait' && <span className="shrink-0 text-xs text-gray-500">{view.label}</span>}
    </li>
  );
}
