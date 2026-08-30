import assert from 'node:assert/strict';
import { hasVisionAnalysisConfig } from '../../background/ai-vision.js';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../background/settings-schema.js';

const configured = {
  ...DEFAULT_SETTINGS,
  apiBaseUrl: 'https://api.example.com',
  apiKey: 'test-only-key',
  modelId: 'vision-model'
};

assert.equal(DEFAULT_SETTINGS.aiDataSharingConsent, false, 'AI screenshot sharing must be opt-in');
assert.equal(hasVisionAnalysisConfig(configured), false, 'credentials alone must not authorize screenshot upload');
assert.equal(
  hasVisionAnalysisConfig(normalizeSettings({ ...configured, aiDataSharingConsent: true })),
  true,
  'explicit consent enables configured AI features'
);
console.log('ok - AI screenshot sharing is explicit opt-in and revocable through settings');
