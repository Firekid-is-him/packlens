import * as assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import './helpers/vscodeStub'
import { installPackage, copyDir } from '../installer'
import { ScanResult, ProjectInfo } from '../scanner'

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function scanOf(sourceDir: string): ScanResult {
  const project: ProjectInfo = { name: 'source', folderPath: sourceDir, packages: [], declared: [], nodeModulesExists: true, packageCount: 0 }
  return { projects: [project], totalSize: 0, duplicates: new Map() }
}

suite('installer', () => {
  let root: string
  let source: string
  let target: string

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'packlens-inst-'))
    source = path.join(root, 'source')
    target = path.join(root, 'target')
    write(path.join(source, 'node_modules', 'left-pad', 'package.json'), '{"name":"left-pad","version":"1.3.0"}')
    write(path.join(source, 'node_modules', '@scope', 'pkg', 'package.json'), '{"name":"@scope/pkg","version":"1.0.0"}')
    fs.mkdirSync(target, { recursive: true })
  })

  teardown(() => fs.rmSync(root, { recursive: true, force: true }))

  test('links an unscoped package', async () => {
    write(path.join(target, 'package.json'), '{\n  "name": "t"\n}\n')
    const result = await installPackage('left-pad', '1.3.0', target, scanOf(source))
    assert.ok(result.success, result.message)
    assert.strictEqual(result.method, 'symlink')
    assert.ok(fs.lstatSync(path.join(target, 'node_modules', 'left-pad')).isSymbolicLink())
  })

  test('links a scoped package instead of copying it', async () => {
    write(path.join(target, 'package.json'), '{\n  "name": "t"\n}\n')
    const result = await installPackage('@scope/pkg', '1.0.0', target, scanOf(source))
    assert.ok(result.success, result.message)
    assert.strictEqual(result.method, 'symlink')
    assert.ok(fs.lstatSync(path.join(target, 'node_modules', '@scope', 'pkg')).isSymbolicLink())
  })

  test('keeps CRLF line endings, indentation and trailing newline in package.json', async () => {
    const original = '{\r\n    "name": "t",\r\n    "dependencies": {\r\n        "zed": "^1.0.0"\r\n    }\r\n}\r\n'
    write(path.join(target, 'package.json'), original)
    await installPackage('left-pad', '1.3.0', target, scanOf(source))
    const after = fs.readFileSync(path.join(target, 'package.json'), 'utf-8')
    assert.strictEqual(after, '{\r\n    "name": "t",\r\n    "dependencies": {\r\n        "left-pad": "^1.3.0",\r\n        "zed": "^1.0.0"\r\n    }\r\n}\r\n')
  })

  test('keeps a missing trailing newline and tab indentation', async () => {
    write(path.join(target, 'package.json'), '{\n\t"name": "t"\n}')
    await installPackage('left-pad', '1.3.0', target, scanOf(source))
    const after = fs.readFileSync(path.join(target, 'package.json'), 'utf-8')
    assert.strictEqual(after, '{\n\t"name": "t",\n\t"dependencies": {\n\t\t"left-pad": "^1.3.0"\n\t}\n}')
  })

  test('does not touch an unparseable package.json', async () => {
    write(path.join(target, 'package.json'), '{ not json')
    await installPackage('left-pad', '1.3.0', target, scanOf(source))
    assert.strictEqual(fs.readFileSync(path.join(target, 'package.json'), 'utf-8'), '{ not json')
  })

  test('copyDir follows symlinked directories and files', () => {
    const src = path.join(root, 'copy-src')
    write(path.join(src, 'real', 'a.txt'), 'a')
    fs.symlinkSync(path.join(src, 'real'), path.join(src, 'linkdir'), 'junction')
    fs.symlinkSync(path.join(src, 'real', 'a.txt'), path.join(src, 'linkfile.txt'))
    const dest = path.join(root, 'copy-dest')
    copyDir(src, dest)
    assert.strictEqual(fs.readFileSync(path.join(dest, 'linkdir', 'a.txt'), 'utf-8'), 'a')
    assert.strictEqual(fs.readFileSync(path.join(dest, 'linkfile.txt'), 'utf-8'), 'a')
  })
})
