import * as assert from 'assert'
import { JSDOM } from 'jsdom'
import { state, resetState } from './helpers/vscodeStub'

const extension = require('../extension')
const { PackLensPanel } = require('../webviewPanel')

interface Harness {
  window: any
  sent: any[]
}

async function openWebview(): Promise<Harness> {
  await state.commands['packlens.openPanel']()
  const html = state.htmls[state.htmls.length - 1]
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const markup = html.replace(/<script[\s\S]*?<\/script>/g, '')

  const sent: any[] = []
  const dom = new JSDOM(markup, { runScripts: 'outside-only' })
  dom.window.acquireVsCodeApi = () => ({ postMessage: (m: unknown) => sent.push(m) })
  dom.window.eval(inline)
  assert.deepStrictEqual(sent.map((m: any) => m.command), ['ready'])
  sent.length = 0
  return { window: dom.window, sent }
}

function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

function project(name: string, folderPath: string) {
  return {
    name,
    folderPath,
    packageCount: 1,
    nodeModulesExists: true,
    nodeModulesSize: 1000,
    nodeModulesSizeFormatted: '1 KB',
    lastModified: '1/1/2026',
    packages: []
  }
}

function dataMessage(projects: any[], allPackages: any[] = []) {
  return {
    command: 'updateData',
    data: {
      projects,
      allPackages,
      duplicates: [],
      stats: { totalProjects: projects.length, totalPackages: allPackages.length, totalSize: '1 KB', duplicateCount: 0, wastedSpace: '0 B', hasRealSizes: true }
    }
  }
}

function post(window: any, data: unknown) {
  window.dispatchEvent(new window.MessageEvent('message', { data }))
}

suite('main webview', () => {
  setup(() => {
    resetState()
    PackLensPanel.currentPanel = undefined
    state.config = { watchedFolders: [], autoScanOnStartup: false }
    extension.activate({ subscriptions: [], extensionUri: 'x', globalState: { get: (_k: string, d: unknown) => d, update: async () => {} } })
  })

  test('script runs and renders without the icon library', async () => {
    const { window } = await openWebview()
    post(window, dataMessage([project('plain', '/home/ok/plain')]))
    assert.ok(window.document.body.innerHTML.includes('plain'))
  })

  test('project buttons send exact paths for Windows, apostrophe and quote cases', async () => {
    const { window, sent } = await openWebview()
    const paths = ['C:\\Users\\Ramadan\\new\\proj', "D:\\dev\\O'Brien\\app", '/home/ok/proj', '/tmp/"quoted"/p']
    post(window, dataMessage(paths.map((p, i) => project(`p${i}`, p))))

    const open = [...window.document.querySelectorAll('#projects-grid [data-action="openProject"]')]
    assert.strictEqual(open.length, paths.length)
    open.forEach((b: any) => b.click())
    assert.deepStrictEqual(sent.map(m => m.folderPath), paths)

    sent.length = 0
    const del = [...window.document.querySelectorAll('#projects-grid [data-action="deleteNodeModules"]')]
    del.forEach((b: any) => b.click())
    assert.deepStrictEqual(sent.map(m => m.folderPath), paths)
    assert.deepStrictEqual(sent.map(m => m.projectName), ['p0', 'p1', 'p2', 'p3'])
  })

  test('markup in project and package names is shown as text', async () => {
    const { window, sent } = await openWebview()
    const evil = '<img id="pwn" src=x>'
    const pkg = { name: 'evil"pkg', version: '1.0.0', description: '<b id="pwn2">d</b>', sizeBytes: 1, sizeFormatted: '1 B', projects: ['x'] }
    post(window, dataMessage([project(evil, '/x/"><img id="pwn3" src=x>')], [pkg]))

    for (const id of ['pwn', 'pwn2', 'pwn3']) {
      assert.strictEqual(window.document.getElementById(id), null, id)
    }
    assert.ok(window.document.body.textContent.includes(evil))

    const add = window.document.querySelector('#packages-list [data-action="addToProject"]')
    add.click()
    assert.deepStrictEqual(plain(sent[sent.length - 1]), { command: 'addToProject', packageName: 'evil"pkg', version: '1.0.0' })
  })

  test('installSuccess disables the matching button even with quotes in the name', async () => {
    const { window } = await openWebview()
    const pkg = { name: 'a"b', version: '1.0.0', description: '', sizeBytes: 0, sizeFormatted: null, projects: ['x'] }
    post(window, dataMessage([project('p', '/x')], [pkg]))
    post(window, { command: 'installSuccess', packageName: 'a"b' })
    const btn = window.document.querySelector('#packages-list [data-action="addToProject"]')
    assert.strictEqual(btn.disabled, true)
    assert.strictEqual(btn.textContent, 'Added')
  })

  test('template buttons send ids safely', async () => {
    const { window, sent } = await openWebview()
    post(window, { command: 'templatesUpdate', data: [{ id: "1'2", name: '<i id="t">x</i>', description: '', packageCount: 0, packages: [], createdAt: 'today' }] })
    assert.strictEqual(window.document.getElementById('t'), null)
    window.document.querySelector('[data-action="deleteTemplate"]').click()
    assert.deepStrictEqual(plain(sent[sent.length - 1]), { command: 'deleteTemplate', id: "1'2" })
  })
})
