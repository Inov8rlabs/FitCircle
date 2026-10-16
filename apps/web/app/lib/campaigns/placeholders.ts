/**
 * Message placeholders (docs/CAMPAIGNS_SPEC.md §5): `{{day}}`, `{{door_title}}`,
 * `{{door_emoji}}` (daily_calendar), and `{{days_left}}`, `{{title}}`,
 * `{{first_name}}` everywhere. Unknown placeholders render as empty strings;
 * whitespace left behind is tidied.
 */
export type PlaceholderVars = Partial<Record<'day' | 'door_title' | 'door_emoji' | 'days_left' | 'title' | 'first_name', string | number | null>>;

export const PLACEHOLDERS = ['day', 'door_title', 'door_emoji', 'days_left', 'title', 'first_name'] as const;

export function renderPlaceholders(template: string, vars: PlaceholderVars): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => {
      const v = (vars as Record<string, unknown>)[name];
      return v === null || v === undefined ? '' : String(v);
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.:;!?])/g, '$1')
    .trim();
}

/** First word of a display name, or "there" ("Hi there"). */
export function firstNameOf(displayName?: string | null, username?: string | null): string {
  const n = (displayName || username || '').trim().split(/\s+/)[0];
  return n || 'there';
}
