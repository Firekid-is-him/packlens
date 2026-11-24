import * as assert from 'assert'
import { EventEmitter } from 'events'
import './helpers/vscodeStub'

const https: any = require('https')
const { PackageJsonHoverProvider } = require('../hoverProvider')

function fakeRegistry(meta: Record<string, unknown>): () => void {
  const original = https.get
  https.get = (_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
    const req: any = new EventEmitter()
    req.setTimeout = () => {}
    req.destroy = () => {}
    setTimeout(() => {
      const res: any = new EventEmitter()
      res.statusCode = 200
      cb(res)
      res.emit('data', JSON.stringify(meta))
      res.emit('end')
    }, 0)
    return req
  }
  return () => { https.get = original }
}

function documentFor(pkgJson: object, lineText: string): any {
  return {
    fileName: '/proj/package.json',
    getText: () => JSON.stringify(pkgJson),
    lineAt: () => ({ text: lineText }),
    getWordRangeAtPosition: () => ({})
  }
}

suite('hover provider', () => {
  let restore: () => void

  teardown(() => restore())

  test('is untrusted and escapes registry text', async () => {
    restore = fakeRegistry({
      name: 'evilpkg',
      version: '2.0.0',
      description: '[click](command:workbench.action.reloadWindow)',
      deprecated: '**bad** <b>x</b>'
    })
    const provider = new PackageJsonHoverProvider()
    const hover = await provider.provideHover(
      documentFor({ dependencies: { evilpkg: '^1.0.0' } }, '    "evilpkg": "^1.0.0"'),
      { line: 0 }
    )
    const md = hover.contents
    assert.strictEqual(md.isTrusted, false)
    assert.ok(!md.value.includes('[click](command:'), md.value)
    assert.ok(!md.value.includes('<b>'), md.value)
  })

  test('reports the real latest version against the declared range', async () => {
    restore = fakeRegistry({ name: 'lodash', version: '4.18.1', description: 'utils' })
    const provider = new PackageJsonHoverProvider()
    const outdated = await provider.provideHover(
      documentFor({ dependencies: { lodash: '^4.17.0' } }, '    "lodash": "^4.17.0"'),
      { line: 0 }
    )
    assert.ok(outdated.contents.value.includes('Latest: `4.18.1` (update available)'), outdated.contents.value)
  })

  test('does not claim an update when the declared range is current', async () => {
    restore = fakeRegistry({ name: 'chalk', version: '5.0.0', description: 'colors' })
    const provider = new PackageJsonHoverProvider()
    const hover = await provider.provideHover(
      documentFor({ dependencies: { chalk: '^5.0.0' } }, '    "chalk": "^5.0.0"'),
      { line: 0 }
    )
    assert.ok(hover.contents.value.includes('Latest: `5.0.0`'))
    assert.ok(!hover.contents.value.includes('update available'))
  })
})
