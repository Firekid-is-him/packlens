import * as assert from 'assert'
import { state, resetState } from './helpers/vscodeStub'

const extension = require('../extension')

suite('package detail page', () => {
  setup(() => {
    resetState()
    state.config = { watchedFolders: [], autoScanOnStartup: false }
    extension.activate({ subscriptions: [], extensionUri: 'x', globalState: { get: (_k: string, d: unknown) => d, update: async () => {} } })
  })

  test('escapes package and project fields', async () => {
    await state.commands['packlens.openPackageDetail']({
      data: {
        pkg: { name: 'evil', version: '1.0.0', description: '<img src=x onerror=alert(1)>' },
        project: { name: '<b>p</b>' }
      }
    })
    const html = state.htmls[state.htmls.length - 1]
    assert.ok(!html.includes('<img src=x'), 'description injected')
    assert.ok(!html.includes('<b>p</b>'), 'project name injected')
    assert.ok(html.includes('&lt;img src=x'))
  })

  test('does not place the package name inside script code', async () => {
    await state.commands['packlens.openPackageDetail']({ data: { pkg: { name: "x'+alert(1)+'", version: '1.0.0' }, project: { name: 'p' } } })
    const html = state.htmls[state.htmls.length - 1]
    const script = html.slice(html.indexOf('<script'), html.indexOf('</script>'))
    assert.ok(!script.includes('alert(1)'), script)
  })

  test('opens only the npm page of the shown package', async () => {
    const opened: string[] = []
    const vscode = require('vscode')
    const original = vscode.env.openExternal
    vscode.env.openExternal = async (u: string) => { opened.push(String(u)); return true }
    try {
      await state.commands['packlens.openPackageDetail']({ data: { pkg: { name: 'lodash', version: '1.0.0' }, project: { name: 'p' } } })
      const handler = state.handlers[state.handlers.length - 1]
      await handler({ command: 'openExternal', url: 'file:///etc/passwd' })
      await handler({ command: 'openNpm' })
    } finally {
      vscode.env.openExternal = original
    }
    assert.deepStrictEqual(opened, ['https://npmjs.com/package/lodash'])
  })
})
