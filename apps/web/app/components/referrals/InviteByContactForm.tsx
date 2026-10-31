'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Loader2, Mail, MessageSquare, Plus, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics, type ReferralContactsInvitedSource } from '@/lib/analytics';
import { emitAppEvent } from '@/lib/engage/client/runtime';
import { copyText } from '@/lib/referrals/clipboard';
import {
  MAX_CONTACTS_PER_SEND,
  addChips,
  chipsToContacts,
  resultCopy,
  smsHref,
  type ContactChip,
} from '@/lib/referrals/invite-form';
import type { InviteResult } from '@/lib/referrals/types';

interface Props {
  /** Prefilled text for phone contacts (hub.smsBody). */
  smsBody: string | null;
  /** Bumping this focuses the field and scrolls it into view (celebration CTA). */
  focusSignal: number;
  source: ReferralContactsInvitedSource;
  onSent: () => void;
}

const toneClass = {
  good: 'text-green-300',
  neutral: 'text-gray-300',
  bad: 'text-red-300',
} as const;

/**
 * "Invite by email or phone" (spec §9.1, web): one smart field + optional
 * name → chips (max 10). Emails are sent by the server. Phone numbers can't
 * be texted from the web, so we show the message with Copy and an `sms:` link,
 * and "Mark as texted" records the invite so it appears in the friends list.
 */
export function InviteByContactForm({ smsBody, focusSignal, source, onSent }: Props) {
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [chips, setChips] = useState<ContactChip[]>([]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [texted, setTexted] = useState<Record<string, 'saving' | 'done'>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (!focusSignal) return;
    sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    inputRef.current?.focus({ preventScroll: true });
  }, [focusSignal]);

  const trackOpened = () => {
    if (opened.current) return;
    opened.current = true;
    analytics.track(AnalyticsEvents.referralInviteSheetOpened({ source }));
  };

  const commit = (): ContactChip[] => {
    if (!value.trim()) return chips;
    const { chips: next, rejected } = addChips(chips, value, name);
    setChips(next);
    if (rejected.length) {
      setFieldError(rejected[0].reason);
      setValue(rejected.map((r) => r.input).join(', '));
    } else {
      setFieldError(null);
      setValue('');
      setName('');
    }
    return next;
  };

  const emailChips = chips.filter((c) => c.kind === 'email');
  const phoneChips = chips.filter((c) => c.kind === 'phone');

  const send = async () => {
    const all = commit();
    const emails = all.filter((c) => c.kind === 'email');
    if (!emails.length) return;
    setSending(true);
    try {
      const res = await fetch('/api/referrals/me/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contacts: chipsToContacts(emails) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        toast.error(body?.error?.message || "Couldn't send invites. Try again.");
        return;
      }
      const data = body.data as { results: InviteResult[]; sentCount: number };
      setResults(data.results);
      if (data.sentCount > 0) {
        analytics.track(AnalyticsEvents.referralContactsInvited({ channel: 'email', count: data.sentCount, source }));
        emitAppEvent('invite_sent', { count: data.sentCount });
        toast.success(data.sentCount === 1 ? 'Invite sent 💌' : `${data.sentCount} invites sent 💌`);
        onSent();
      }
      setChips((prev) => prev.filter((c) => c.kind !== 'email'));
    } catch {
      toast.error("Couldn't send invites. Try again.");
    } finally {
      setSending(false);
    }
  };

  const markTexted = async (chip: ContactChip) => {
    setTexted((t) => ({ ...t, [chip.key]: 'saving' }));
    try {
      const res = await fetch('/api/referrals/me/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ contacts: chipsToContacts([chip]) }),
      });
      const body = await res.json().catch(() => null);
      const status: string | undefined = body?.data?.results?.[0]?.status;
      if (res.ok && (status === 'sent' || status === 'already_invited')) {
        if (status === 'sent') {
          analytics.track(AnalyticsEvents.referralContactsInvited({ channel: 'sms', count: 1, source }));
          emitAppEvent('invite_sent', { count: 1 });
        }
        setTexted((t) => ({ ...t, [chip.key]: 'done' }));
        setChips((prev) => prev.filter((c) => c.key !== chip.key));
        onSent();
      } else {
        toast.error(status ? resultCopy(status).label : "Couldn't save that. Try again.");
        setTexted((t) => {
          const { [chip.key]: _drop, ...rest } = t;
          return rest;
        });
      }
    } catch {
      toast.error("Couldn't save that. Try again.");
      setTexted((t) => {
        const { [chip.key]: _drop, ...rest } = t;
        return rest;
      });
    }
  };

  return (
    <section ref={sectionRef} className="mt-10" aria-labelledby="invite-by-contact" data-testid="invite-by-contact">
      <h2 id="invite-by-contact" className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        Invite by email or text
      </h2>
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setFieldError(null);
            }}
            onFocus={trackOpened}
            onPaste={trackOpened}
            placeholder="Email or phone number"
            aria-label="Email or phone number"
            aria-invalid={Boolean(fieldError)}
            autoComplete="off"
            inputMode="email"
            className="min-w-0 flex-[2] rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={trackOpened}
            placeholder="First name (optional)"
            aria-label="First name (optional)"
            maxLength={60}
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!value.trim() || chips.length >= MAX_CONTACTS_PER_SEND}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 px-4 py-3 text-sm font-medium text-gray-200 hover:border-purple-500/60 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
        {fieldError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {fieldError}
          </p>
        )}

        {chips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Contacts to invite">
            <AnimatePresence initial={false}>
              {chips.map((c) => (
                <motion.li
                  key={c.key}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-purple-500/15 py-1 pl-3 pr-1 text-sm text-purple-100"
                >
                  {c.kind === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                  <span className="truncate">{c.name ? `${c.name} · ${c.label}` : c.label}</span>
                  <button
                    type="button"
                    onClick={() => setChips((prev) => prev.filter((x) => x.key !== c.key))}
                    aria-label={`Remove ${c.label}`}
                    className="rounded-full p-1 hover:bg-white/10"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        <p className="mt-3 text-xs text-gray-500">
          {chips.length}/{MAX_CONTACTS_PER_SEND} · We email your friends an invite from you. Phone numbers are never stored in plain text,
          and we never text anyone for you.
        </p>

        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || (emailChips.length === 0 && !value.includes('@'))}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {emailChips.length > 1 ? `Send ${emailChips.length} invites` : 'Send invite'}
        </button>

        {phoneChips.length > 0 && (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3" data-testid="sms-panel">
            <p className="text-sm text-gray-300">
              Text {phoneChips.length === 1 ? 'this friend' : 'each friend'} from your phone. Here&apos;s a message you can send:
            </p>
            {smsBody && <p className="whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-sm text-gray-200">{smsBody}</p>}
            {phoneChips.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-2">
                <span className="mr-auto truncate text-sm text-white">{c.name ? `${c.name} · ${c.label}` : c.label}</span>
                {smsBody && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        if (await copyText(smsBody)) toast.success('Message copied');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-gray-200"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                    <a
                      href={smsHref(smsBody, c.value)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-gray-200"
                    >
                      <MessageSquare className="h-3.5 w-3.5" /> Open Messages
                    </a>
                  </>
                )}
                <button
                  type="button"
                  disabled={texted[c.key] === 'saving'}
                  onClick={() => void markTexted(c)}
                  className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {texted[c.key] === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} I texted them
                </button>
              </div>
            ))}
          </div>
        )}

        {results && results.length > 0 && (
          <ul className="mt-4 space-y-1.5" aria-label="Invite results" data-testid="invite-results">
            {results.map((r, i) => {
              const copy = resultCopy(r.status);
              return (
                <li key={`${r.contact}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-gray-200">{r.name ? `${r.name} · ${r.contact}` : r.contact}</span>
                  <span className={`shrink-0 ${toneClass[copy.tone]}`}>{copy.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
