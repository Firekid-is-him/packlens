import * as assert from 'assert'
import { state, resetState } from './helpers/vscodeStub'

const extension = require('../extension')

const saved = [{
  id: '1',
  name: 'Starter',
  description: 'demo',
  packages: [{ name: 'lodash', version: '4.17.21', dev: false }],
  createdAt: '2026-01-01T00:00:00.000Z'
}]

suite('panel', () => {
  setup(() => {
    resetState()
    state.config = { watchedFolders: [], autoScanOnStartup: false }
    const context = {
      subscriptions: [],
      extensionUri: 'x',
      globalState: { get: (k: string, d: unknown) => (k === 'packlens.templates' ? saved : d), update: async () => {} }
    }
    extension.activate(context)
  })

  test('sends saved templates when the webview reports ready', async () => {
    await state.commands['packlens.openPanel']()
    state.posted.length = 0
    await state.handlers[state.handlers.length - 1]({ command: 'ready' })
    const update = state.posted.find(m => m.command === 'templatesUpdate')
    assert.ok(update, `messages: ${state.posted.map(m => m.command).join(',')}`)
    assert.strictEqual(update.data.length, 1)
    assert.strictEqual(update.data[0].name, 'Starter')
    assert.strictEqual(update.data[0].packageCount, 1)
  })
})
