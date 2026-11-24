import * as assert from 'assert'
import { escapeHtml, npmPackageUrl } from '../html'

suite('html', () => {
  test('escapeHtml neutralises markup and quotes', () => {
    assert.strictEqual(escapeHtml('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;')
    assert.strictEqual(escapeHtml("O'Brien & co"), 'O&#39;Brien &amp; co')
    assert.strictEqual(escapeHtml(undefined), '')
    assert.strictEqual(escapeHtml(42), '42')
  })

  test('npmPackageUrl keeps scopes and encodes the rest', () => {
    assert.strictEqual(npmPackageUrl('lodash'), 'https://npmjs.com/package/lodash')
    assert.strictEqual(npmPackageUrl('@scope/pkg'), 'https://npmjs.com/package/%40scope/pkg')
    assert.strictEqual(npmPackageUrl('a b/../c'), 'https://npmjs.com/package/a%20b/../c')
  })
})
