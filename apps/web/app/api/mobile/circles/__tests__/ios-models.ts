/**
 * The iOS 1.0 response models, as decode checks.
 *
 * Swift `Codable` fails the WHOLE decode on a missing required key, a wrong type
 * or an unknown raw value of a String-backed enum. Each function below mirrors
 * one struct of the submitted build (iOS repo, commit b485c3b / 0fcacdc) and
 * returns the reasons a payload would NOT decode; an empty list means it decodes.
 * Unknown keys are ignored by Swift and so are they here.
 */

type Json = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** APIClient.swift `decoder.dateDecodingStrategy`: YYYY-MM-DD, or ISO 8601 with a zone. */
function isIosDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

const absent = (value: unknown) => value === undefined || value === null;

class Check {
  problems: string[] = [];
  constructor(private source: Json) {}

  required(key: string, ok: (value: unknown) => boolean, what: string) {
    const value = this.source[key];
    if (absent(value)) this.problems.push(`${key}: required, missing`);
    else if (!ok(value)) this.problems.push(`${key}: expected ${what}, got ${JSON.stringify(value)}`);
    return this;
  }

  optional(key: string, ok: (value: unknown) => boolean, what: string) {
    const value = this.source[key];
    if (!absent(value) && !ok(value)) {
      this.problems.push(`${key}: expected ${what}, got ${JSON.stringify(value)}`);
    }
    return this;
  }
}

const isString = (value: unknown) => typeof value === 'string';
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value);
const isBool = (value: unknown) => typeof value === 'boolean';
const isUuid = (value: unknown) => typeof value === 'string' && UUID.test(value);
const oneOf = (values: string[]) => (value: unknown) => typeof value === 'string' && values.includes(value);

/** FitCircle/Core/Models/FitCircle.swift — enum ChallengeType */
const CHALLENGE_TYPES = ['weight_loss', 'step_count', 'workout_minutes', 'steps', 'weight', 'exercise', 'check_in', 'custom'];
/** enum ChallengeStatus */
const CHALLENGE_STATUSES = ['draft', 'upcoming', 'active', 'completed', 'cancelled'];
/** enum ChallengeVisibility */
const CHALLENGE_VISIBILITIES = ['public', 'private', 'invite_only'];

/** FitCircle/Core/Models/FitCircle.swift — struct FitCircle */
export function iosFitCircleProblems(data: unknown): string[] {
  if (!isObject(data)) return ['data: expected an object'];
  return new Check(data)
    .required('id', isUuid, 'UUID')
    .required('creator_id', isUuid, 'UUID')
    .required('name', isString, 'String')
    .optional('description', isString, 'String?')
    .optional('type', oneOf(CHALLENGE_TYPES), 'ChallengeType?')
    .required('status', oneOf(CHALLENGE_STATUSES), 'ChallengeStatus')
    .optional('visibility', oneOf(CHALLENGE_VISIBILITIES), 'ChallengeVisibility?')
    .required('start_date', isIosDate, 'Date')
    .required('end_date', isIosDate, 'Date')
    .required('participant_count', isInt, 'Int')
    .optional('member_count', isInt, 'Int?')
    .optional('invite_code', isString, 'String?')
    .optional('days_remaining', isInt, 'Int?')
    .optional('is_member', isBool, 'Bool?')
    .optional('user_progress', isNumber, 'Double?')
    .optional('created_at', isIosDate, 'Date?')
    .optional('updated_at', isIosDate, 'Date?').problems;
}

/** Features/FitCircles/UserDetail/UserDetailModels.swift — struct WeightProgressResponse */
export function iosWeightProgressProblems(data: unknown): string[] {
  if (!isObject(data)) return ['data: expected an object'];
  return new Check(data)
    .optional('starting_weight', isNumber, 'Double?')
    .optional('current_weight', isNumber, 'Double?')
    .optional('target_weight', isNumber, 'Double?')
    .required('weight_unit', isString, 'String')
    .required('progress_percentage', isNumber, 'Double')
    .required('weight_lost', isNumber, 'Double')
    .required('weight_to_go', isNumber, 'Double')
    .required('can_view', isBool, 'Bool').problems;
}

/** UserDetailModels.swift — struct CheckInHistory / CheckInEntry */
export function iosCheckInHistoryProblems(data: unknown): string[] {
  if (!isObject(data)) return ['data: expected an object'];
  const check = new Check(data)
    .required('entries', Array.isArray, '[CheckInEntry]')
    .required('can_view', isBool, 'Bool');

  if (Array.isArray(data.entries)) {
    data.entries.forEach((entry, index) => {
      if (!isObject(entry)) {
        check.problems.push(`entries[${index}]: expected an object`);
        return;
      }
      const inner = new Check(entry)
        .required('id', isString, 'String')
        .required('date', isIosDate, 'Date')
        .optional('weight', isNumber, 'Double?')
        .optional('weight_change', isNumber, 'Double?')
        .required('is_public', isBool, 'Bool')
        .optional('notes', isString, 'String?');
      inner.problems.forEach((problem) => check.problems.push(`entries[${index}].${problem}`));
    });
  }
  return check.problems;
}

/** FitCircle/Core/Models/APIResponse.swift — struct APIResponse<T> / APIError */
export function iosEnvelopeProblems(body: unknown): string[] {
  if (!isObject(body)) return ['body: expected an object'];
  const check = new Check(body).required('success', isBool, 'Bool');

  if (!absent(body.error)) {
    if (!isObject(body.error)) {
      check.problems.push('error: expected an object');
    } else {
      const inner = new Check(body.error)
        .required('code', isString, 'String')
        .required('message', isString, 'String')
        // [String: APIErrorDetailValue]? — an ARRAY here fails the decode.
        .optional('details', isObject, '[String: APIErrorDetailValue]?')
        .optional('timestamp', isIosDate, 'Date?');
      inner.problems.forEach((problem) => check.problems.push(`error.${problem}`));
    }
  }
  if (!absent(body.meta) && !isObject(body.meta)) check.problems.push('meta: expected an object');
  return check.problems;
}
