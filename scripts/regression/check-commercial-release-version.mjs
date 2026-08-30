import assert from 'node:assert/strict';
import { assertReleaseTagMatchesVersion } from '../check-release-version.mjs';

assert.doesNotThrow(() => assertReleaseTagMatchesVersion('v2.8.0', '2.8.0'));
console.log('ok - matching release tag and package version is accepted');

assert.throws(
  () => assertReleaseTagMatchesVersion('v2.7.0', '2.8.0'),
  /does not match package version/,
  'mismatched tag must stop release publication'
);
console.log('ok - mismatched release tag is rejected');

assert.throws(
  () => assertReleaseTagMatchesVersion('latest', '2.8.0'),
  /must use the v<version> format/,
  'non-version release tag must be rejected'
);
console.log('ok - non-version release tag is rejected');
