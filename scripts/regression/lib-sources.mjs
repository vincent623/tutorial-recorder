import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const BACKGROUND_DIR = 'background';

export async function readSources(repoRoot, files) {
  const backgroundNames = await listBackgroundModuleNames(repoRoot);

  const entries = await Promise.all(
    Object.entries(files).map(async ([key, relativePath]) => {
      if (relativePath === `${BACKGROUND_DIR}/`) {
        const contents = await Promise.all(
          backgroundNames.map((name) =>
            readFile(path.join(repoRoot, BACKGROUND_DIR, name), 'utf8')
          )
        );
        return [key, contents.join('\n')];
      }

      return [key, await readFile(path.join(repoRoot, relativePath), 'utf8')];
    })
  );

  return Object.fromEntries(entries);
}

async function listBackgroundModuleNames(repoRoot) {
  const dir = path.join(repoRoot, BACKGROUND_DIR);
  const names = await readdir(dir).catch(() => []);
  return names.filter((name) => name.endsWith('.js')).sort();
}
