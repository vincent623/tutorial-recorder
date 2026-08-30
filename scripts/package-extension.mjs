import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'dist');
const runtimeEntries = [
  'manifest.json',
  'THIRD_PARTY_NOTICES.txt',
  'background',
  'content',
  'offscreen',
  'popup',
  'settings',
  'icons',
  'lib'
];
const ignoredNames = new Set(['.DS_Store']);
const PACKAGE_MTIME = new Date(2000, 0, 1, 0, 0, 0);

async function main() {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));

  if (packageJson.version !== manifest.version) {
    throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
  }

  const packageName = `${packageJson.name}-v${packageJson.version}`;
  const zipFileName = `${packageName}.zip`;
  const zipPath = path.join(distDir, zipFileName);
  const checksumPath = path.join(distDir, `${zipFileName}.sha256`);
  const entries = {};

  for (const relativePath of runtimeEntries) {
    await addPackageEntry(entries, relativePath);
  }

  const zipBytes = zipSync(entries, { level: 9 });
  const checksum = createHash('sha256').update(zipBytes).digest('hex');

  await mkdir(distDir, { recursive: true });
  await writeFile(zipPath, zipBytes);
  await writeFile(checksumPath, `${checksum}  ${zipFileName}\n`);

  console.log(`packaged ${zipFileName}`);
  console.log(`files ${Object.keys(entries).length}`);
  console.log(`sha256 ${checksum}`);
}

async function addPackageEntry(entries, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const item = await stat(absolutePath);

  if (item.isDirectory()) {
    const children = await readdir(absolutePath, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!ignoredNames.has(child.name)) {
        await addPackageEntry(entries, path.posix.join(relativePath, child.name));
      }
    }
    return;
  }

  if (!item.isFile()) {
    return;
  }

  const zipPath = relativePath.split(path.sep).join(path.posix.sep);
  entries[zipPath] = [
    new Uint8Array(await readFile(absolutePath)),
    { mtime: PACKAGE_MTIME }
  ];
}

await main();
