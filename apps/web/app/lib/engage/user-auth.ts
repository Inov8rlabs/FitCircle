import { IdSchema, TenantSchema, type Tenant } from '@inov8r/engage-protocol';
import type { UserIdentity } from '@inov8r/engage-server';
/** The header selects a verifier, never a tenant or identity. Cookie fallback is intentionally absent. */
export function createFitCircleUserAuth(
  tenant: Tenant,
  verifiers: {
    web(token: string): Promise<string | null>;
    mobile(token: string): Promise<string | null>;
  },
) {
  const scope = Object.freeze(TenantSchema.parse(tenant));
  if (scope.app_id !== 'fitcircle') throw new Error('FitCircle auth cannot verify another app');
  return async (request: Request): Promise<UserIdentity | null> => {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ') || authorization.length > 8199)
      return null;
    const token = authorization.slice(7);
    if (!token || /\s/.test(token)) return null;
    const format = request.headers.get('x-engage-auth');
    if (format !== null && format !== 'fitcircle-mobile') return null;
    try {
      const raw = await (format === 'fitcircle-mobile'
        ? verifiers.mobile(token)
        : verifiers.web(token));
      const id = IdSchema.safeParse(raw);
      return id.success ? { tenant: scope, user_id: id.data } : null;
    } catch {
      return null;
    }
  };
}
