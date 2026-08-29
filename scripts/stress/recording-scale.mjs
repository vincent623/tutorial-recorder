import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const backgroundDir = path.join(repoRoot, 'background');
const reportPath = path.join(repoRoot, 'output', 'stress', 'recording-scale-report.json');
const stepCounts = [100, 300, 1000];
const screenshotBytes = 250 * 1024;
const audioBytes = 8 * 1024 * 1024;
const videoBytes = 40 * 1024 * 1024;

const background = await readBackgroundSources(backgroundDir);
const pdfScreenshotLimit = readIntegerConstant(background, 'EXPORT_PDF_MAX_SCREENSHOTS');
const pdfImageByteLimit = readByteExpressionConstant(background, 'EXPORT_PDF_MAX_IMAGE_BYTES');

async function readBackgroundSources(dir) {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.js')).sort();
  const contents = await Promise.all(names.map((name) => readFile(path.join(dir, name), 'utf8')));
  return contents.join('\n');
}

const scenarios = stepCounts.map((steps) => buildScenario(steps));
const report = {
  pdfScreenshotLimit,
  pdfImageByteLimit,
  assumptions: {
    screenshotBytes,
    audioBytes,
    videoBytes
  },
  scenarios
};

assertScenarioExpectations(report);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));

for (const scenario of scenarios) {
  console.log(
    [
      `steps=${scenario.steps}`,
      `metadata=${formatBytes(scenario.recordingMetadataBytes)}`,
      `inlineEquivalent=${formatBytes(scenario.inlineRecordingBytes)}`,
      `zipEntries=${scenario.zipEntries}`,
      `pdf=${scenario.pdf.shouldGenerate ? 'generate' : 'skip'}`,
      `assetPayload=${formatBytes(scenario.assetPayloadBytes)}`
    ].join(' ')
  );
}

console.log(`stress report: ${path.relative(repoRoot, reportPath)}`);

function buildScenario(steps) {
  const recording = createSyntheticRecording(steps);
  const recordingMetadataBytes = byteLength(JSON.stringify(recording));
  const inlineRecordingBytes = byteLength(JSON.stringify(createInlineSyntheticRecording(steps)));
  const screenshotPayloadBytes = steps * screenshotBytes;
  const pdf = {
    shouldGenerate: steps <= pdfScreenshotLimit && screenshotPayloadBytes <= pdfImageByteLimit,
    reason:
      steps > pdfScreenshotLimit
        ? `step-count>${pdfScreenshotLimit}`
        : screenshotPayloadBytes > pdfImageByteLimit
          ? `image-bytes>${pdfImageByteLimit}`
          : ''
  };

  return {
    steps,
    recordingMetadataBytes,
    inlineRecordingBytes,
    metadataReductionRatio: Number((inlineRecordingBytes / recordingMetadataBytes).toFixed(1)),
    assetPayloadBytes: screenshotPayloadBytes + audioBytes + videoBytes,
    screenshotPayloadBytes,
      zipEntries: 2 + (pdf.shouldGenerate ? 1 : 0) + 2 + steps,
    pdf
  };
}

function createSyntheticRecording(steps) {
  return {
    id: 'stress-recording',
    startTime: 1777640000000,
    title: 'Scale Stress Recording',
    status: 'ready',
    commitState: 'complete',
    audioAssetId: 'stress-recording:asset:audio:audio',
    audioDataUrl: null,
    videoAssetId: 'stress-recording:asset:video:video',
    videoDataUrl: null,
    screenshots: Array.from({ length: steps }, (_, index) => ({
      id: `stress-recording-shot-${String(index + 1).padStart(5, '0')}`,
      sequence: index + 1,
      assetId: `stress-recording:asset:screenshot:${String(index + 1).padStart(5, '0')}`,
      dataSize: screenshotBytes,
      timestamp: 1777640000000 + index * 1000,
      timeOffsetMs: index * 1000,
      description: `步骤 ${index + 1}`,
      pageContext: {
        title: 'Stress Fixture',
        url: 'https://example.test/stress'
      }
    }))
  };
}

function createInlineSyntheticRecording(steps) {
  const recording = createSyntheticRecording(steps);
  const inlineData = `data:image/png;base64,${'A'.repeat(Math.ceil((screenshotBytes * 4) / 3))}`;

  return {
    ...recording,
    screenshots: recording.screenshots.map((screenshot) => ({
      ...screenshot,
      assetId: '',
      data: inlineData
    }))
  };
}

function assertScenarioExpectations({ scenarios: items }) {
  const bySteps = new Map(items.map((item) => [item.steps, item]));

  assert(bySteps.get(100).pdf.shouldGenerate, '100-step recording should remain eligible for PDF');
  assert(!bySteps.get(300).pdf.shouldGenerate, '300-step recording should skip PDF by count threshold');
  assert(!bySteps.get(1000).pdf.shouldGenerate, '1000-step recording should skip PDF by count threshold');

  for (const scenario of items) {
    assert(
      scenario.recordingMetadataBytes < 1_000_000,
      `${scenario.steps}-step metadata should stay below 1 MB after asset split`
    );
    assert(
      scenario.metadataReductionRatio > 100,
      `${scenario.steps}-step metadata reduction ratio should be greater than 100x`
    );
    assert(
      scenario.zipEntries >= scenario.steps + 3,
      `${scenario.steps}-step ZIP entry count should include every screenshot and core documents`
    );
  }
}

function readIntegerConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\d+);`));
  if (!match) {
    throw new Error(`Unable to read ${name}`);
  }

  return Number.parseInt(match[1], 10);
}

function readByteExpressionConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!match) {
    throw new Error(`Unable to read ${name}`);
  }

  return match[1]
    .split('*')
    .map((item) => Number.parseInt(item.trim(), 10))
    .reduce((total, value) => total * value, 1);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes) || 0;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)}${units[unitIndex]}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
