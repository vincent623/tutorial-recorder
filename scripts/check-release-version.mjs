import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertReleaseTagMatchesVersion(tag, version) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(tag || ''))) {
    throw new Error(`Release tag ${tag || '<empty>'} must use the v<version> format`);
  }

  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version ${version}`);
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  assertReleaseTagMatchesVersion(tag, packageJson.version);
  console.log(`ok - release tag ${tag} matches package version ${packageJson.version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
