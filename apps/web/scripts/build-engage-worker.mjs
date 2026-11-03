import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const enabled = process.env.NEXT_PUBLIC_ENGAGE_WEB_PUSH_ENABLED === 'true';
const environment = enabled ? process.env.NEXT_PUBLIC_ENGAGE_ENVIRONMENT : null;
if (
  enabled &&
  !['development', 'test', 'staging', 'production'].includes(environment)
)
  throw new Error(
    'An explicit Engage environment is required for the browser push worker',
  );
const result = await Bun.build({
  entrypoints: [resolve(root, 'scripts/engage-worker-entry.js')],
  outdir: resolve(root, 'public'),
  naming: 'engage-worker.js',
  target: 'browser',
  format: 'iife',
  minify: true,
  define: { __ENGAGE_ENVIRONMENT__: JSON.stringify(environment) },
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
