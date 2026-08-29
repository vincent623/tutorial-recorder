import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  checkSyntax: 'scripts/check-syntax.mjs',
  packageScript: 'scripts/package-extension.mjs',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md',
  workflow: '.github/workflows/release.yml',
  gitignore: '.gitignore'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

function versionAtLeast(version, minimum) {
  const currentParts = version.split('.').map((item) => Number.parseInt(item, 10));
  const minimumParts = minimum.split('.').map((item) => Number.parseInt(item, 10));

  for (let index = 0; index < minimumParts.length; index += 1) {
    if ((currentParts[index] || 0) > (minimumParts[index] || 0)) {
      return true;
    }

    if ((currentParts[index] || 0) < (minimumParts[index] || 0)) {
      return false;
    }
  }

  return true;
}

const checks = [
  {
    name: 'version metadata is aligned at or above 2.3.0',
    pass:
      versionAtLeast(packageJson.version, '2.3.0') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'package script is registered and syntax-checked',
    pass:
      packageJson.scripts.package === 'node scripts/package-extension.mjs' &&
      (/node --check scripts\/package-extension\.mjs/.test(source.packageJson) ||
        /scripts\/package-extension\.mjs/.test(source.checkSyntax))
  },
  {
    name: 'package script includes only extension runtime entries',
    pass:
      /const runtimeEntries = \[[\s\S]*?'manifest\.json'[\s\S]*?'background'[\s\S]*?'content'[\s\S]*?'offscreen'[\s\S]*?'popup'[\s\S]*?'settings'[\s\S]*?'icons'[\s\S]*?'lib'[\s\S]*?\]/.test(
        source.packageScript
      ) &&
      !/node_modules|\.env|output|memory/.test(source.packageScript)
  },
  {
    name: 'package script validates versions and emits checksum',
    pass:
      /packageJson\.version !== manifest\.version/.test(source.packageScript) &&
      /createHash\('sha256'\)/.test(source.packageScript) &&
      /\.sha256/.test(source.packageScript)
  },
  {
    name: 'dist packages are ignored by git',
    pass: /^dist\/$/m.test(source.gitignore)
  },
  {
    name: 'GitHub workflow checks and packages on main, PR, tags, and manual dispatch',
    pass:
      /push:[\s\S]*branches:[\s\S]*- main/.test(source.workflow) &&
      /tags:[\s\S]*- 'v\*'/.test(source.workflow) &&
      /pull_request:/.test(source.workflow) &&
      /workflow_dispatch:/.test(source.workflow) &&
      /npm ci/.test(source.workflow) &&
      /npm run check/.test(source.workflow) &&
      /npm run package/.test(source.workflow)
  },
  {
    name: 'GitHub workflow uploads artifacts and publishes tag releases',
    pass:
      /actions\/upload-artifact@v4/.test(source.workflow) &&
      /dist\/\*\.zip/.test(source.workflow) &&
      /dist\/\*\.sha256/.test(source.workflow) &&
      /startsWith\(github\.ref, 'refs\/tags\/v'\)/.test(source.workflow) &&
      /gh release create/.test(source.workflow) &&
      /gh release upload "\$TAG_NAME" dist\/\*\.zip dist\/\*\.sha256 --clobber/.test(source.workflow)
  },
  {
    name: 'watchdog knows the v2.3.0 release automation task',
    pass:
      /v2\.3\.0-github-release-automation/.test(source.watchdog) &&
      /v2\.3\.0-github-release-automation/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.3.0 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
