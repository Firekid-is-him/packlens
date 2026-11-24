import * as assert from 'assert'
import './helpers/vscodeStub'
import { ProjectsProvider, DuplicatesProvider } from '../treeProvider'
import { ScanResult, ProjectInfo } from '../scanner'

function project(name: string, nodeModulesExists: boolean): ProjectInfo {
  const packages = [{ name: 'lodash', version: '4.17.21' }]
  return { name, folderPath: `/x/${name}`, packages, declared: packages, nodeModulesExists, packageCount: 1 }
}

function result(projects: ProjectInfo[], duplicates: ScanResult['duplicates'] = new Map()): ScanResult {
  return { projects, totalSize: 0, duplicates }
}

suite('tree views', () => {
  test('duplicates view lists every duplicated package', () => {
    const dupes: ScanResult['duplicates'] = new Map([
      ['a', [{ version: '1.0.0', projects: ['p', 'q'], totalSize: 10 }]],
      ['b', [{ version: '2.0.0', projects: ['p', 'q'], totalSize: 20 }]],
      ['c', [{ version: '3.0.0', projects: ['p', 'q', 'r'], totalSize: 30 }]]
    ])
    const provider = new DuplicatesProvider()
    provider.setScanResult(result([], dupes))
    assert.deepStrictEqual(provider.getChildren().map(i => i.label), ['a', 'b', 'c'])
  })

  test('packages from projects with node_modules offer install from cache', () => {
    const provider = new ProjectsProvider()
    provider.setScanResult(result([project('with', true), project('without', false)]))
    const [withModules, withoutModules] = provider.getChildren()
    const cached = provider.getChildren(withModules)[0]
    const plain = provider.getChildren(withoutModules)[0]
    assert.ok(/(^| )cachedPackage( |$)/.test(cached.contextValue!), cached.contextValue)
    assert.ok(/(^| )package( |$)/.test(cached.contextValue!), cached.contextValue)
    assert.strictEqual(plain.contextValue, 'package')
  })
})
