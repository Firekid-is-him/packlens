import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { quickScan, deepScan } from '../scanner'
import { findDeadPackages } from '../features'

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function makeProject(root: string, name: string, deps: Record<string, string>, dev: Record<string, string> = {}) {
  const dir = path.join(root, name)
  write(path.join(dir, 'package.json'), JSON.stringify({ name, dependencies: deps, devDependencies: dev }))
  return dir
}

function install(dir: string, name: string, version: string, extra = 0) {
  const pkgDir = path.join(dir, 'node_modules', name)
  write(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }))
  if (extra) write(path.join(pkgDir, 'data.bin'), 'x'.repeat(extra))
}

suite('scanner', () => {
  let root: string

  setup(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlens-')) })
  teardown(() => fs.rmSync(root, { recursive: true, force: true }))

  test('quickScan reads declared dependencies and dev flags', async () => {
    makeProject(root, 'a', { lodash: '^4.17.21' }, { typescript: '^5.0.0' })
    const result = await quickScan([root])
    const a = result.projects[0]
    assert.deepStrictEqual(a.declared.map(d => [d.name, d.dev]), [['lodash', false], ['typescript', true]])
    assert.strictEqual(a.packageCount, 2)
  })

  test('deepScan keeps declared deps and records installed versions', async () => {
    const dir = makeProject(root, 'a', { lodash: '^4.17.0', 'unused-lib': '^2.0.0' })
    install(dir, 'lodash', '4.17.21', 100)
    install(dir, 'transitive-dep', '9.9.9')
    const result = await deepScan([root], { report() {} })
    const a = result.projects[0]

    assert.deepStrictEqual(a.packages.map(p => p.name).sort(), ['lodash', 'transitive-dep'])
    assert.strictEqual(a.packageCount, 2)
    assert.deepStrictEqual(a.declared.map(d => [d.name, d.installedVersion]), [['lodash', '4.17.21'], ['unused-lib', undefined]])
  })

  test('findDeadPackages only judges declared dependencies after a deep scan', async () => {
    const dir = makeProject(root, 'a', { lodash: '^4.17.0', 'unused-lib': '^2.0.0', left: '1.0.0' }, { typescript: '^5.0.0' })
    install(dir, 'lodash', '4.17.21')
    install(dir, 'transitive-dep', '9.9.9')
    write(path.join(dir, 'src', 'index.ts'), "import _ from 'lodash'\nconst l = require('left')\n")

    const result = await deepScan([root], { report() {} })
    const dead = findDeadPackages(result.projects[0]).map(d => d.name)
    assert.deepStrictEqual(dead, ['unused-lib'])
  })

  test('duplicates are detected across projects with real sizes', async () => {
    const a = makeProject(root, 'a', { lodash: '4.17.21' })
    const b = makeProject(root, 'b', { lodash: '4.17.21' })
    install(a, 'lodash', '4.17.21', 1000)
    install(b, 'lodash', '4.17.21', 1000)
    const result = await deepScan([root], { report() {} })
    const dup = result.duplicates.get('lodash')!
    assert.strictEqual(dup.length, 1)
    assert.deepStrictEqual(dup[0].projects.sort(), ['a', 'b'])
    assert.ok(dup[0].totalSize >= 2000)
  })
})
