// GPF-1: CI guard against @napi-rs/cli major drift (#48, #49). The release
// workflow speaks napi v2, but the declared caret range lets the lockfile
// resolve a different major. Fail the build when either side leaves v2.
// Widen EXPECTED_MAJOR if the workflow ever moves to napi v3.
import { readFileSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const EXPECTED_MAJOR = 2;

const pkg = JSON.parse(readFileSync(new URL('../packages/graphify-cli/package.json', import.meta.url)));
const declared = pkg.devDependencies['@napi-rs/cli'];

// Stream package-lock.json line by line — it is megabytes, never read it whole.
let resolved;
let inEntry = false;
const lines = createInterface({ input: createReadStream(new URL('../package-lock.json', import.meta.url)) });
for await (const line of lines) {
  if (inEntry && line.includes('"resolved"')) {
    resolved = line.match(/cli-(\d+\.\d+\.\d+)\.tgz/)?.[1];
    break;
  }
  if (line.includes('node_modules/@napi-rs/cli":')) inEntry = true;
}

if (Number.parseInt(String(declared).replace(/^[~^]/, ''), 10) !== EXPECTED_MAJOR || Number.parseInt(String(resolved), 10) !== EXPECTED_MAJOR) {
  console.error(`@napi-rs/cli drift: declared "${declared}" in packages/graphify-cli, resolved "${resolved ?? 'not found'}" in package-lock.json — expected v${EXPECTED_MAJOR}.x`);
  process.exit(1);
}
