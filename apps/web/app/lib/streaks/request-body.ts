/**
 * Tolerant JSON body reader for the streak / daily-challenge / momentum routes.
 *
 * Several shipped clients POST with no body at all, or with an empty string,
 * where `request.json()` throws and the route answered 500. An absent, empty or
 * malformed body is read as `{}` so the schema decides what is missing; a body
 * that is valid JSON but not an object (array, string, number) is also read as
 * `{}` because none of these routes accepts one.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let text = '';
  try {
    text = await request.text();
  } catch {
    return {};
  }
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
