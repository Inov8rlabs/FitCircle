import { readFile, writeFile, readdir, unlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import ts from 'typescript';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const directory = join(root, 'vendor/engage');
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const web = JSON.parse(await readFile(join(root, 'apps/web/package.json'), 'utf8'));
for (const entry of manifest.packages) {
  if (!/^@inov8r\/engage-(protocol|server|adapters|connector|web)$/.test(entry.name) || !/^engage-[a-z]+-[a-f0-9]{16}\.tgz$/.test(entry.file)) throw new Error('Unexpected Engage package entry');
  if (createHash('sha256').update(await readFile(join(directory, entry.file))).digest('hex') !== entry.sha256) throw new Error(`Checksum mismatch: ${entry.file}`);
  pkg.dependencies[entry.name] = `file:./vendor/engage/${entry.file}`;
  pkg.overrides[entry.name] = pkg.dependencies[entry.name];
  web.dependencies[entry.name] = entry.version;
}
await writeFile(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
await writeFile(join(root, 'apps/web/package.json'), JSON.stringify(web, null, 2) + '\n');
// Preserve every unrelated pin. Bun can retain old transitive archive references
// when only override paths change; discard just this unpublished package family.
const parsed = ts.parseConfigFileTextToJson('bun.lock', await readFile(join(root, 'bun.lock'), 'utf8'));
if (parsed.error) throw new Error('Cannot parse Bun lock');
const lock = parsed.config;
for (const key of Object.keys(lock.packages)) if (key.startsWith('@inov8r/engage-')) delete lock.packages[key];
for (const key of Object.keys(lock.overrides ?? {})) if (key.startsWith('@inov8r/engage-')) delete lock.overrides[key];
for (const workspace of Object.values(lock.workspaces ?? {})) for (const key of Object.keys(workspace.dependencies ?? {})) if (key.startsWith('@inov8r/engage-')) delete workspace.dependencies[key];
await writeFile(join(root, 'bun.lock'), JSON.stringify(lock, null, 2) + '\n');
// Unchanged adapter/web archives can retain links to an older 0.0.0 protocol
// snapshot in Bun's virtual store. Rebuild this unpublished family only.
for (const entry of await readdir(join(root,'node_modules/.bun'))) if(entry.startsWith('@inov8r+engage-')) await rm(join(root,'node_modules/.bun',entry),{recursive:true,force:true});
for (const base of [join(root,'node_modules/@inov8r'),join(root,'apps/web/node_modules/@inov8r')]) for(const entry of await readdir(base).catch(()=>[])) if(entry.startsWith('engage-')) await rm(join(base,entry),{force:true,recursive:true});
execFileSync('bun', ['install', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
const keep = new Set(manifest.packages.map(entry => entry.file));
for (const file of await readdir(directory)) if (/^engage-[a-z]+-[a-f0-9]{16}\.tgz$/.test(file) && !keep.has(file)) await unlink(join(directory, file));
