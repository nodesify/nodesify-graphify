// GPF-1: regression test for scripts/check-napi-version.mjs.
// Runs the real guard against throwaway fixture trees, so no repo file is
// ever mutated. `npm test` at the repo root runs this; the full workspace
// suite needs the native module and runs in CI's cli-test job.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-napi-version.mjs', import.meta.url));

function makeFixture(dir, declared, resolved) {
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'packages', 'graphify-cli'), { recursive: true });
  copyFileSync(GUARD, join(dir, 'scripts', 'check-napi-version.mjs'));
  writeFileSync(
    join(dir, 'packages', 'graphify-cli', 'package.json'),
    JSON.stringify({ devDependencies: { '@napi-rs/cli': declared } }),
  );
  const entry = resolved == null ? '' :
    `"packages/graphify-cli/node_modules/@napi-rs/cli": {
      "version": "${resolved}",
      "resolved": "https://registry.npmjs.org/@napi-rs/cli/-/cli-${resolved}.tgz"
    }`;
  writeFileSync(
    join(dir, 'package-lock.json'),
    `{\n  "lockfileVersion": 3,\n  "packages": {\n${entry}\n  }\n}\n`,
  );
}

function runGuard(scriptPath) {
  try {
    // stdio pipes keep the fixture guard's stderr out of this suite's output
    // while still capturing it on err.stderr for the assertions below.
    execFileSync(process.execPath, [scriptPath], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stderr: err.stderr ?? '' };
  }
}

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failed++;
    console.error(`FAIL - ${name}\n  ${detail}`);
  }
}

// Case 0: the committed guard passes on the real repo state.
{
  const { code, stderr } = runGuard(GUARD);
  check('repo state: guard exits 0', code === 0 && stderr === '', `exit ${code}, stderr: ${stderr}`);
}

const cases = [
  { name: 'happy path: ^2.18.4 declared, 2.18.4 resolved', declared: '^2.18.4', resolved: '2.18.4', wantCode: 0, wantInStderr: [] },
  { name: 'declared drift: ^3.0.0 vs resolved 2.18.4', declared: '^3.0.0', resolved: '2.18.4', wantCode: 1, wantInStderr: ['^3.0.0', '2.18.4'] },
  { name: 'lockfile drift: ^2.18.4 declared, 3.1.0 resolved', declared: '^2.18.4', resolved: '3.1.0', wantCode: 1, wantInStderr: ['2.18.4', '3.1.0'] },
  { name: 'missing lockfile entry fails loudly', declared: '^2.18.4', resolved: null, wantCode: 1, wantInStderr: ['not found'] },
];

for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'napi-guard-'));
  try {
    makeFixture(dir, c.declared, c.resolved);
    const { code, stderr } = runGuard(join(dir, 'scripts', 'check-napi-version.mjs'));
    const ok = code === c.wantCode && c.wantInStderr.every((s) => stderr.includes(s));
    check(c.name, ok, `exit ${code} (want ${c.wantCode}), stderr: ${JSON.stringify(stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
console.log('napi version guard: all cases passed');
