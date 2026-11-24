import * as assert from 'assert'
import { EventEmitter } from 'events'
import { checkOutdated } from '../features'
import { ProjectInfo } from '../scanner'

const https: any = require('https')

interface Stats { calls: number; inFlight: number; max: number }

function installFakeRegistry(latest: Record<string, string>, stats: Stats): () => void {
  const original = https.get
  https.get = (url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
    stats.calls++
    stats.inFlight++
    stats.max = Math.max(stats.max, stats.inFlight)
    const req: any = new EventEmitter()
    req.setTimeout = () => {}
    req.destroy = () => {}
    setTimeout(() => {
      const name = decodeURIComponent(url.replace('https://registry.npmjs.org/', '').replace('/latest', ''))
      const res: any = new EventEmitter()
      res.statusCode = latest[name] ? 200 : 404
      cb(res)
      res.emit('data', JSON.stringify(latest[name] ? { name, version: latest[name] } : 'Not Found'))
      res.emit('end')
      stats.inFlight--
    }, 10)
    return req
  }
  return () => { https.get = original }
}

function project(name: string, deps: Record<string, string>): ProjectInfo {
  const packages = Object.entries(deps).map(([n, v]) => ({ name: n, version: v }))
  return { name, folderPath: `/x/${name}`, packages, declared: packages, nodeModulesExists: false, packageCount: packages.length }
}

suite('checkOutdated', () => {
  let restore: () => void
  let stats: Stats

  teardown(() => restore())

  test('parses specs and skips non-registry ones', async () => {
    stats = { calls: 0, inFlight: 0, max: 0 }
    restore = installFakeRegistry({ lodash: '4.18.1' }, stats)
    const result = await checkOutdated([
      project('a', { lodash: '>=1.0.0' }),
      project('b', { lodash: '^4.18.1' }),
      project('c', { lodash: 'workspace:*' }),
      project('d', { lodash: 'github:a/b' }),
      project('e', { lodash: '~4.0.0-beta.1' })
    ])
    assert.deepStrictEqual(result.map(r => [r.projectName, r.current]), [['a', '1.0.0'], ['e', '4.0.0-beta.1']])
  })

  test('requests each package once, in parallel, with a cap', async () => {
    stats = { calls: 0, inFlight: 0, max: 0 }
    const latest: Record<string, string> = {}
    const deps: Record<string, string> = {}
    for (let i = 0; i < 20; i++) { latest[`pkg${i}`] = '2.0.0'; deps[`pkg${i}`] = '1.0.0' }
    restore = installFakeRegistry(latest, stats)
    const result = await checkOutdated([project('a', deps), project('b', deps)])
    assert.strictEqual(stats.calls, 20)
    assert.ok(stats.max > 1 && stats.max <= 8, `max in flight was ${stats.max}`)
    assert.strictEqual(result.length, 40)
  })

  test('prefers the installed version over the declared range', async () => {
    stats = { calls: 0, inFlight: 0, max: 0 }
    restore = installFakeRegistry({ lodash: '4.18.1' }, stats)
    const p = project('a', { lodash: '^4.0.0' })
    p.declared[0].installedVersion = '4.17.21'
    const result = await checkOutdated([p])
    assert.deepStrictEqual(result.map(r => [r.current, r.latest]), [['4.17.21', '4.18.1']])
  })

  test('ignores packages the registry does not know', async () => {
    stats = { calls: 0, inFlight: 0, max: 0 }
    restore = installFakeRegistry({}, stats)
    const result = await checkOutdated([project('a', { ghost: '1.0.0' })])
    assert.deepStrictEqual(result, [])
  })
})
