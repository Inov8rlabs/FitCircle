import { describe, expect, it } from 'vitest';

import { messageChecklist } from '../checklist';
import { newMessageInput } from '../content';

const blocking = (m: ReturnType<typeof newMessageInput>) => messageChecklist(m).filter((c) => c.blocking && !c.ok).map((c) => c.id);

describe('messageChecklist', () => {
  it('flags a fresh card for name and content', () => {
    expect(blocking(newMessageInput('content_card'))).toEqual(['name', 'content']);
  });
  it('passes a complete card and checks per-platform overrides', () => {
    const m = newMessageInput('content_card');
    m.name = 'Winter card';
    m.variants[0].content = { ...(m.variants[0].content as object), title: 'Hi', body: 'There' } as never;
    expect(blocking(m)).toEqual([]);
    m.variants[0].platformOverrides = { web: { title: '' } } as never;
    const content = messageChecklist(m).find((c) => c.id === 'content');
    expect(content?.ok).toBe(false);
    expect(content?.hint).toMatch(/web/);
  });
  it('push without iOS/Android is blocked', () => {
    const m = newMessageInput('push');
    m.platforms = ['web'];
    expect(blocking(m)).toContain('platforms');
  });
  it('hero needs an image and weights must total 100', () => {
    const m = newMessageInput('content_card');
    m.name = 'x';
    m.layout = 'hero';
    m.variants[0].content = { ...(m.variants[0].content as object), title: 'Hi' } as never;
    m.controlWeight = 10;
    const ids = blocking(m);
    expect(ids).toContain('content');
    expect(ids).toContain('weights');
  });
});
