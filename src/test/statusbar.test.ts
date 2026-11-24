import * as assert from 'assert'
const fs: any = require('fs')
import * as os from 'os'
import * as path from 'path'
import { state, resetState } from './helpers/vscodeStub'

const extension = require('../extension')

suite('status bar', () => {
  let root: string

  setup(() => {
    resetState()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlens-sb-'))
    fs.mkdirSync(path.join(root, 'a'))
    fs.writeFileSync(path.join(root, 'a', 'package.json'), JSON.stringify({ name: 'a', dependencies: { lodash: '1.0.0' } }))
    state.config = { watchedFolders: [root], autoScanOnStartup: false }
    extension.activate({ subscriptions: [], extensionUri: 'x', globalState: { get: (_k: string, d: unknown) => d, update: async () => {} } })
  })

  teardown(() => fs.rmSync(root, { recursive: true, force: true }))

  test('shows scan result after a quick scan', async () => {
    await state.commands['packlens.quickScan']()
    assert.ok(/^\$\(package\) PackLens: /.test(state.status.text), state.status.text)
  })

  test('leaves the scanning label when a quick scan fails', async () => {
    const realExists = fs.existsSync
    ;fs.existsSync = (p: string) => { if (String(p).endsWith('node_modules')) throw new Error('EPERM'); return realExists(p) }
    try {
      await state.commands['packlens.quickScan']()
    } finally {
      ;fs.existsSync = realExists
    }
    assert.ok(!state.status.text.includes('spin') && state.status.text.startsWith('$(package) PackLens'), state.status.text)
    assert.ok(state.messages.some(m => m.startsWith('ERR: PackLens scan failed')))
  })

  test('leaves the scanning label when a deep scan fails', async () => {
    const realExists = fs.existsSync
    ;fs.existsSync = (p: string) => { if (String(p).endsWith('node_modules')) throw new Error('EPERM'); return realExists(p) }
    try {
      await state.commands['packlens.deepScan']()
    } finally {
      ;fs.existsSync = realExists
    }
    assert.ok(!state.status.text.includes('spin') && state.status.text.startsWith('$(package) PackLens'), state.status.text)
    assert.ok(state.messages.some(m => m.startsWith('ERR: PackLens deep scan failed')))
  })
})
