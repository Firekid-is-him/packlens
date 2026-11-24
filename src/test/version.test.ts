import * as assert from 'assert'
import { parseSpec, normalizeVersion, compareVersions, isNewer } from '../version'

suite('version', () => {
  test('parseSpec strips range operators', () => {
    assert.strictEqual(parseSpec('^4.17.21'), '4.17.21')
    assert.strictEqual(parseSpec('~1.2.3'), '1.2.3')
    assert.strictEqual(parseSpec('>=1.0.0'), '1.0.0')
    assert.strictEqual(parseSpec('>2.0.0'), '2.0.0')
    assert.strictEqual(parseSpec('=3.1.0'), '3.1.0')
    assert.strictEqual(parseSpec('v2.0.0'), '2.0.0')
  })

  test('parseSpec fills partial versions', () => {
    assert.strictEqual(parseSpec('1.x'), '1.0.0')
    assert.strictEqual(parseSpec('1.2.x'), '1.2.0')
    assert.strictEqual(parseSpec('2'), '2.0.0')
  })

  test('parseSpec keeps prerelease tags', () => {
    assert.strictEqual(parseSpec('^4.0.0-beta.1'), '4.0.0-beta.1')
  })

  test('parseSpec uses the last alternative and first comparator', () => {
    assert.strictEqual(parseSpec('^1.0.0 || ^2.3.0'), '2.3.0')
    assert.strictEqual(parseSpec('>=1.0.0 <2.0.0'), '1.0.0')
  })

  test('parseSpec rejects non-registry specs', () => {
    for (const s of ['workspace:*', 'file:../x', 'link:../x', 'github:a/b', 'a/b', 'git+https://x/y.git', 'https://x/y.tgz', 'npm:other@1.0.0', 'latest', '*', '', '<2.0.0']) {
      assert.strictEqual(parseSpec(s), null, s)
    }
  })

  test('normalizeVersion falls back to the raw spec', () => {
    assert.strictEqual(normalizeVersion('^1.2.3'), '1.2.3')
    assert.strictEqual(normalizeVersion('workspace:*'), 'workspace:*')
    assert.strictEqual(normalizeVersion('unknown'), 'unknown')
  })

  test('compareVersions orders core versions numerically', () => {
    assert.strictEqual(compareVersions('1.10.0', '1.9.0'), 1)
    assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0)
    assert.strictEqual(compareVersions('0.9.9', '1.0.0'), -1)
  })

  test('compareVersions follows semver prerelease rules', () => {
    assert.strictEqual(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
    assert.strictEqual(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
    assert.strictEqual(compareVersions('1.0.0-beta.2', '1.0.0-beta.11'), -1)
    assert.strictEqual(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
    assert.strictEqual(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  })

  test('isNewer', () => {
    assert.strictEqual(isNewer('4.18.1', '4.17.21'), true)
    assert.strictEqual(isNewer('4.17.21', '4.17.21'), false)
    assert.strictEqual(isNewer('1.0.0-rc.1', '1.0.0'), false)
  })
})
