import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = ['background/background.js', 'background/browser-observation.js'];
const modules = new Map();

async function getModule(absolutePath) {
  const normalizedPath = path.resolve(absolutePath);
  if (modules.has(normalizedPath)) {
    return modules.get(normalizedPath);
  }

  const source = await readFile(normalizedPath, 'utf8');
  const module = new vm.SourceTextModule(source, {
    identifier: pathToFileURL(normalizedPath).href
  });
  modules.set(normalizedPath, module);

  return module;
}

async function resolveModule(specifier, referencingModule) {
  if (!specifier.startsWith('.')) {
    throw new Error(`Unsupported non-local import ${specifier} from ${referencingModule.identifier}`);
  }

  const dependencyUrl = new URL(specifier, referencingModule.identifier);
  return getModule(fileURLToPath(dependencyUrl));
}

for (const entry of entries) {
  const module = await getModule(path.join(repoRoot, entry));
  if (module.status === 'unlinked') {
    await module.link(resolveModule);
  }
  console.log(`ok - module links ${entry}`);
}
