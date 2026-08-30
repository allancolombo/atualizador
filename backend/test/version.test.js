import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, findUpdateRelease } from '../src/version.js';

test('compares numeric versions', () => {
  assert.equal(compareVersions('2.5.18', '2.5.17'), 1);
  assert.equal(compareVersions('2.5.18', '2.5.18'), 0);
  assert.equal(compareVersions('2.5.9', '2.5.10'), -1);
});

test('ignores surrounding whitespace', () => {
  assert.equal(compareVersions(' 2.1.12.1', '2.1.12'), 1);
  assert.equal(compareVersions('2.1.12.1 ', ' 2.1.12.1 '), 0);
});

test('selects updates by release id when current version exists', () => {
  const releases = [
    { id: 5, version: '26.8.1.11' },
    { id: 4, version: 'front-enzo' },
    { id: 3, version: '26.8.1.10' },
  ];

  assert.deepEqual(findUpdateRelease(releases, 'front-enzo'), releases[0]);
  assert.equal(findUpdateRelease(releases, '26.8.1.11'), null);
});

test('keeps current release when it was published after numeric versions', () => {
  const releases = [
    { id: 4, version: 'front-enzo' },
    { id: 3, version: '26.8.1.11' },
  ];

  assert.equal(findUpdateRelease(releases, 'front-enzo'), null);
});

test('offers latest release when current version is unknown', () => {
  const releases = [
    { id: 5, version: '26.8.1.11' },
    { id: 4, version: 'front-enzo' },
  ];

  assert.deepEqual(findUpdateRelease(releases, 'local-build'), releases[0]);
});
