import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib-sources.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const files = {
  background: 'background/',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  manifest: 'manifest.json',
  watchdog: 'scripts/dev-watchdog.mjs',
  progress: 'memory/dev-loop-progress.md'
};

const source = await readSources(repoRoot, files);

const packageJson = JSON.parse(source.packageJson);
const packageLock = JSON.parse(source.packageLock);
const manifest = JSON.parse(source.manifest);

function versionAtLeast(version, minimum) {
  const currentParts = version.split('.').map((item) => Number.parseInt(item, 10));
  const minimumParts = minimum.split('.').map((item) => Number.parseInt(item, 10));

  for (let index = 0; index < minimumParts.length; index += 1) {
    if ((currentParts[index] || 0) > minimumParts[index]) {
      return true;
    }

    if ((currentParts[index] || 0) < minimumParts[index]) {
      return false;
    }
  }

  return true;
}

const checks = [
  {
    name: 'version metadata is aligned at or above 2.1.1',
    pass:
      versionAtLeast(packageJson.version, '2.1.1') &&
      packageLock.version === packageJson.version &&
      packageLock.packages?.['']?.version === packageJson.version &&
      manifest.version === packageJson.version
  },
  {
    name: 'background uses fflate streaming ZIP APIs instead of zipSync',
    pass:
      /import \{ strToU8, Zip, ZipDeflate \} from '\.\.\/lib\/fflate\.js'/.test(source.background) &&
      !/zipSync/.test(source.background) &&
      /async function buildRecordingZipBlob/.test(source.background) &&
      /new Zip\(\(error, data, final\) =>/.test(source.background) &&
      /new ZipDeflate\(filename, \{ level: 6 \}\)/.test(source.background)
  },
  {
    name: 'ZIP entries are added incrementally without archiveEntries aggregation',
    pass:
      /const addEntry = async \(filename, bytes\) =>/.test(source.background) &&
      /await addEntry\(`\$\{archiveRoot\}\/tutorial\.md`, strToU8\(markdown\)\)/.test(source.background) &&
      /for \(let index = 0; index < recording\.screenshots\.length; index \+= 1\)/.test(source.background) &&
      /await addEntry\([\s\S]*dataUrlToUint8Array\(recording\.screenshots\[index\]\.data\)/.test(
        source.background
      ) &&
      !/const archiveEntries =/.test(source.background)
  },
  {
    name: 'ZIP export reports progress and yields during large packaging',
    pass:
      /const EXPORT_PROGRESS_STEP_FILES = 10/.test(source.background) &&
      /function notifyExportProgress\(processedEntries, totalEntries\)/.test(source.background) &&
      /正在打包 ZIP \$\{processedEntries\}\/\$\{totalEntries\}/.test(source.background) &&
      /function yieldToEventLoop\(\)/.test(source.background) &&
      /setTimeout\(resolve, 0\)/.test(source.background)
  },
  {
    name: 'PDF generation has large-record protective thresholds',
    pass:
      /const EXPORT_PDF_MAX_SCREENSHOTS = 150/.test(source.background) &&
      /const EXPORT_PDF_MAX_IMAGE_BYTES = 200 \* 1024 \* 1024/.test(source.background) &&
      /async function generatePdfForRecording\(recording\)/.test(source.background) &&
      /function getPdfGenerationPlan\(recording\)/.test(source.background) &&
      /screenshotCount > EXPORT_PDF_MAX_SCREENSHOTS/.test(source.background) &&
      /imageBytes > EXPORT_PDF_MAX_IMAGE_BYTES/.test(source.background)
  },
  {
    name: 'oversized PDF skip preserves non-PDF export contents',
    pass:
      /已跳过 PDF；ZIP 仍包含 Markdown、全部截图和可用音视频/.test(source.background) &&
      /return \{ pdfDataUrl: null, skipped: true, reason: plan\.reason \}/.test(source.background) &&
      /const pdfResult = await generatePdfForRecording\((S\.)?currentRecording\)/.test(source.background) &&
      /const pdfResult = await generatePdfForRecording\(recording\)/.test(source.background)
  },
  {
    name: 'watchdog knows the v2.1.1 export-scaling task',
    pass:
      /v2\.1\.1-export-scaling/.test(source.watchdog) &&
      /v2\.1\.1-export-scaling/.test(source.progress)
  }
];

const failed = checks.filter((check) => !check.pass);

for (const check of checks) {
  console.log(`${check.pass ? 'ok' : 'not ok'} - ${check.name}`);
}

if (failed.length) {
  throw new Error(`v2.1.1 regression checks failed: ${failed.map((check) => check.name).join(', ')}`);
}
