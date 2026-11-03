import type { EngageClient } from '@inov8r/engage-web';
let current: EngageClient | null = null;
export function registerEngageSession(client: EngageClient) {
  current = client;
  return () => {
    if (current === client) current = null;
  };
}
/** Called before the host signs out so the SDK can unbind with the old credential. */
export async function logoutEngageSession() {
  const previous = current;
  current = null;
  try { await previous?.logout(); }
  catch { /* SDK cleanup must never prevent the host from signing out. */ }
}
