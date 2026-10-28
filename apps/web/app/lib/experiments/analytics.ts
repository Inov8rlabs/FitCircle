/**
 * Experiment user properties for Amplitude and other analytics tools
 * (analytics/tracking-plan.json → conventions.experiments). Pure builders.
 *
 *   exp_<key>            = arm key (control | variantA | …) — randomised users and QA overrides only
 *   exp_<key>_name       = the arm's human label (readable charts)
 *   exp_<key>_override   = true for QA overrides (filter these out of readouts)
 *   exp_<key>_exposed_at = ISO time of first exposure ($setOnce)
 *
 * Fallback / not-enrolled / layer / layer_conflict / winner users never get exp_<key>.
 */
import type { AmplitudeIdentification } from '../analytics/amplitude-server';

import type { AssignmentReason } from './model';

export const experimentProperty = (key: string) => `exp_${key}`;

/** Identify for an assignment, or null when this reason must not set the property. */
export function assignmentIdentify(
  userId: string,
  experimentKey: string,
  arm: { key: string; name?: string | null },
  reason: AssignmentReason
): AmplitudeIdentification | null {
  if (reason !== 'bucket' && reason !== 'override') return null;
  const p = experimentProperty(experimentKey);
  const $set: Record<string, string | boolean> = { [p]: arm.key };
  if (arm.name) $set[`${p}_name`] = arm.name;
  if (reason === 'override') $set[`${p}_override`] = true;
  return { user_id: userId, user_properties: { $set } };
}

export function exposureIdentify(userId: string, experimentKey: string, at: Date): AmplitudeIdentification {
  return { user_id: userId, user_properties: { $setOnce: { [`${experimentProperty(experimentKey)}_exposed_at`]: at.toISOString() } } };
}

/** Amplitude org slug (analytics/README.md). */
export const AMPLITUDE_ORG_SLUG = 'inov8rlabs-545043';
export const AMPLITUDE_PROJECTS = {
  production: { id: 746168, name: 'FitCircle' },
  dev: { id: 875589, name: 'FitCircle Dev' },
} as const;
export const READOUT_EVENTS = ['Experiment Exposed', 'Onboarding Completed', 'Purchase Completed'] as const;

/**
 * Link-only Amplitude readout for the admin results page (no Amplitude API
 * calls). Amplitude has no documented URL that pre-fills a chart, so this is a
 * new-segmentation-chart link plus the exact definition to apply: the three
 * events, grouped by the user property exp_<key>, excluding QA overrides.
 */
export function amplitudeReadout(experimentKey: string, production: boolean) {
  const p = experimentProperty(experimentKey);
  const project = production ? AMPLITUDE_PROJECTS.production : AMPLITUDE_PROJECTS.dev;
  return {
    project,
    userProperty: p,
    nameProperty: `${p}_name`,
    overrideProperty: `${p}_override`,
    exposedAtProperty: `${p}_exposed_at`,
    events: [...READOUT_EVENTS],
    chartUrl: `https://app.amplitude.com/analytics/${AMPLITUDE_ORG_SLUG}/chart/new`,
    chartDefinition: {
      type: 'eventsSegmentation',
      events: READOUT_EVENTS.map((event) => ({
        event_type: event,
        filters: event === 'Experiment Exposed' ? [{ property: 'experiment_key', type: 'event', op: 'is', values: [experimentKey] }] : [],
      })),
      groupBy: [{ type: 'user', property: p }],
      segments: [{ filters: [{ type: 'user', property: `${p}_override`, op: 'is not', values: ['true'] }] }],
      metric: 'uniques',
    },
    note: `Open the chart link (project ${project.name} ${project.id}), add the events, group by user property ${p} and exclude ${p}_override = true.`,
  };
}
