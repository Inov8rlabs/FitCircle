'use client';

import { Lightbulb, Shuffle, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DOOR_IDEAS, addDays, fillDoorsFromIdeas, resizeDoors, shortDate, spanDays } from '@/lib/campaigns/campaign-utils';
import type { CalendarDoorContent, CircleTemplate } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import type { EditorApi } from '../editor-api';
import { Btn, Callout, Section, SelectField, TextAreaField, TextField, Toggle, inputCls } from '../fields';

const CIRCLE_TYPES: { value: CircleTemplate['type']; label: string }[] = [
  { value: 'custom', label: 'Custom (daily check-ins)' },
  { value: 'step_count', label: 'Steps' },
  { value: 'workout_minutes', label: 'Workout minutes' },
  { value: 'weight_loss', label: 'Weight loss' },
];

export function ContentSection({ api }: { api: EditorApi }) {
  const { draft, update } = api;
  const circleRequired = draft.template === 'seasonal_circle';
  const circleOptional = draft.template === 'daily_calendar' || (draft.template === 'spotlight' && draft.cta.action === 'start_circle');

  const setCircle = (patch: Partial<CircleTemplate>) =>
    update({ circle: { ...(draft.circle ?? { name: '', description: '', type: 'custom', startDate: draft.startsAt, endDate: draft.endsAt }), ...patch } });

  return (
    <Section id="content" index={3} title="Template content" description={draft.template === 'daily_calendar' ? 'Doors, plus an optional circle.' : draft.template === 'spotlight' ? 'Spotlight cards are just copy + one CTA.' : 'The circle the wizard prefills.'}>
      {(circleRequired || circleOptional) && (
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Circle template</p>
              <p className="text-xs text-slate-400">Prefills the circle wizard: &ldquo;Start {draft.circle?.name || 'a circle'}&rdquo;</p>
            </div>
            {circleOptional && (
              <Toggle
                checked={Boolean(draft.circle)}
                label="Include a circle template"
                onChange={(on) => update({ circle: on ? { name: draft.title, description: draft.description, type: 'custom', startDate: draft.startsAt, endDate: draft.endsAt } : null })}
              />
            )}
          </div>
          {draft.circle && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Circle name" value={draft.circle.name} max={60} onChange={(name) => setCircle({ name })} />
                <SelectField label="Type" value={draft.circle.type} options={CIRCLE_TYPES} onChange={(type) => setCircle({ type })} />
              </div>
              <TextAreaField label="Circle description" value={draft.circle.description} max={280} rows={2} onChange={(description) => setCircle({ description })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Circle starts" type="date" value={draft.circle.startDate} onChange={(startDate) => setCircle({ startDate })} />
                <TextField label="Circle ends" type="date" value={draft.circle.endDate} onChange={(endDate) => setCircle({ endDate })} />
              </div>
            </>
          )}
        </div>
      )}

      {draft.template === 'daily_calendar' && <DoorsEditor api={api} />}

      {draft.template === 'spotlight' && (
        <Callout tone="info">
          The spotlight card shows the art, title, description and one CTA ({draft.cta.action.replace('_', ' ')}). Edit them in Basics.
        </Callout>
      )}
    </Section>
  );
}

function DoorsEditor({ api }: { api: EditorApi }) {
  const { draft, update } = api;
  const days = Math.min(62, spanDays(draft.startsAt, draft.endsAt));
  const doors = useMemo(() => resizeDoors(days, draft.calendar?.doors ?? []), [days, draft.calendar]);
  const [active, setActive] = useState(1);
  const [ideaFilter, setIdeaFilter] = useState('');
  const filled = doors.filter((d) => d.title.trim() && d.task.trim() && d.emoji.trim()).length;
  const used = new Set(doors.map((d) => d.title.trim().toLowerCase()));

  const setDoors = (next: CalendarDoorContent[]) => update({ calendar: { doors: next } });
  const setDoor = (day: number, patch: Partial<CalendarDoorContent>) => setDoors(doors.map((d) => (d.day === day ? { ...d, ...patch } : d)));
  const applyIdea = (idea: Omit<CalendarDoorContent, 'day'>) => {
    setDoor(active, idea);
    const nextEmpty = doors.find((d) => d.day > active && !d.title.trim());
    if (nextEmpty) setActive(nextEmpty.day);
  };
  const ideas = DOOR_IDEAS.filter((i) => !ideaFilter || `${i.title} ${i.task}`.toLowerCase().includes(ideaFilter.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Doors</p>
          <p className="text-xs text-slate-400">
            {filled}/{days} filled · content is hidden until its day · keep them kind, small and doable
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => setDoors(fillDoorsFromIdeas(days, doors))}>
            <Sparkles className="h-3.5 w-3.5" /> Fill empty from ideas
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setDoors(fillDoorsFromIdeas(days, [], { overwrite: true, offset: Math.floor(Math.random() * DOOR_IDEAS.length) }))}>
            <Shuffle className="h-3.5 w-3.5" /> Shuffle all
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setDoors(resizeDoors(days, []))}>
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Btn>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_240px]">
        <div className="max-h-[560px] space-y-1.5 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/30 p-2 [scrollbar-width:thin]">
          {doors.map((d) => (
            <div
              key={d.day}
              onFocusCapture={() => setActive(d.day)}
              className={cn('grid grid-cols-[44px_52px_1fr] items-start gap-2 rounded-lg p-1.5 sm:grid-cols-[44px_52px_minmax(0,0.8fr)_minmax(0,1.4fr)]', active === d.day ? 'bg-purple-500/10 ring-1 ring-purple-500/40' : 'hover:bg-slate-800/40')}
            >
              <button type="button" onClick={() => setActive(d.day)} className="pt-1.5 text-left">
                <span className="block text-sm font-bold text-white">{d.day}</span>
                <span className="block text-[10px] text-slate-500">{shortDate(addDays(draft.startsAt, d.day - 1))}</span>
              </button>
              <input aria-label={`Door ${d.day} emoji`} value={d.emoji} onChange={(e) => setDoor(d.day, { emoji: e.target.value })} className={cn(inputCls, 'px-1 text-center text-lg')} placeholder="·" />
              <input aria-label={`Door ${d.day} title`} value={d.title} onChange={(e) => setDoor(d.day, { title: e.target.value })} className={inputCls} placeholder="Title" maxLength={40} />
              <input aria-label={`Door ${d.day} task`} value={d.task} onChange={(e) => setDoor(d.day, { task: e.target.value })} className={cn(inputCls, 'col-span-3 sm:col-span-1')} placeholder="The small task" maxLength={140} />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200">
            <Lightbulb className="h-3.5 w-3.5" /> Ideas → door {active}
          </p>
          <input value={ideaFilter} onChange={(e) => setIdeaFilter(e.target.value)} placeholder="Search ideas" className={cn(inputCls, 'mt-2 h-8 text-xs')} />
          <div className="mt-2 max-h-[480px] space-y-1 overflow-y-auto [scrollbar-width:thin]">
            {ideas.map((i) => (
              <button
                key={i.title}
                type="button"
                onClick={() => applyIdea(i)}
                className={cn('flex w-full items-start gap-2 rounded-lg p-2 text-left transition hover:bg-slate-800', used.has(i.title.toLowerCase()) && 'opacity-40')}
              >
                <span className="text-lg leading-none">{i.emoji}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-white">{i.title}</span>
                  <span className="block text-[11px] leading-snug text-slate-400">{i.task}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
