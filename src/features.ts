import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { ProjectInfo, PackageInfo } from './scanner'
import { parseSpec, normalizeVersion, isNewer } from './version'

const REGISTRY_CONCURRENCY = 8

export interface OutdatedPackage {
  name: string
  current: string
  latest: string
  projectName: string
  projectPath: string
}

export interface DeadPackage {
  name: string
  version: string
  projectName: string
  projectPath: string
}

export interface NpmPackageMeta {
  name: string
  version: string
  description: string
  homepage?: string
  weeklyDownloads?: number
  deprecated?: string
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'packlens-vscode' } }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error('Failed to parse response')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

export async function fetchPackageMeta(packageName: string): Promise<NpmPackageMeta | null> {
  try {
    const encoded = packageName.startsWith('@')
      ? packageName.replace('/', '%2F')
      : packageName
    const data = await fetchJson(`https://registry.npmjs.org/${encoded}/latest`)
    return {
      name: data.name,
      version: data.version,
      description: data.description || '',
      homepage: data.homepage,
      deprecated: data.deprecated
    }
  } catch {
    return null
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function resolveCurrent(pkg: PackageInfo): string | null {
  return parseSpec(pkg.installedVersion ?? '') ?? parseSpec(pkg.version)
}

export async function checkOutdated(projects: ProjectInfo[]): Promise<OutdatedPackage[]> {
  const names = new Set<string>()
  for (const project of projects) {
    for (const pkg of project.declared) {
      if (resolveCurrent(pkg) !== null) names.add(pkg.name)
    }
  }

  const latestByName = new Map<string, string>()
  await mapPool(Array.from(names), REGISTRY_CONCURRENCY, async name => {
    const meta = await fetchPackageMeta(name)
    if (meta?.version) latestByName.set(name, meta.version)
  })

  const outdated: OutdatedPackage[] = []
  for (const project of projects) {
    for (const pkg of project.declared) {
      const current = resolveCurrent(pkg)
      const latest = latestByName.get(pkg.name)
      if (current === null || !latest) continue

      if (isNewer(latest, current)) {
        outdated.push({
          name: pkg.name,
          current,
          latest,
          projectName: project.name,
          projectPath: project.folderPath
        })
      }
    }
  }

  return outdated
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']
const IMPORT_RE = /(?:import|require)\s*(?:\(?\s*['"`]([^'"`\n]+)['"`]|.*?from\s+['"`]([^'"`\n]+)['"`])/g

function extractImports(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const imports = new Set<string>()
    let match
    IMPORT_RE.lastIndex = 0
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const raw = match[1] || match[2]
      if (!raw || raw.startsWith('.') || raw.startsWith('/')) continue
      const pkg = raw.startsWith('@')
        ? raw.split('/').slice(0, 2).join('/')
        : raw.split('/')[0]
      imports.add(pkg)
    }
    return Array.from(imports)
  } catch {
    return []
  }
}

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (['node_modules', 'dist', 'build', 'out', '.next', '.nuxt'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkSourceFiles(full, files)
      else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) files.push(full)
    }
  } catch {}
  return files
}

export function findDeadPackages(project: ProjectInfo): DeadPackage[] {
  const dead: DeadPackage[] = []
  if (project.declared.length === 0) return dead

  const sourceFiles = walkSourceFiles(project.folderPath)
  const usedPackages = new Set<string>()

  for (const file of sourceFiles) {
    for (const imp of extractImports(file)) {
      usedPackages.add(imp)
    }
  }

  const ALWAYS_USED = new Set([
    'typescript', '@types/', 'eslint', 'prettier', 'jest', 'vitest',
    'webpack', 'vite', 'esbuild', 'rollup', 'babel', '@babel/',
    'ts-node', 'tsx', 'nodemon', 'husky', 'lint-staged',
    'tailwindcss', 'postcss', 'autoprefixer'
  ])

  for (const pkg of project.declared) {
    const cleanVersion = pkg.installedVersion ?? normalizeVersion(pkg.version)
    const isTooling = Array.from(ALWAYS_USED).some(t => pkg.name.startsWith(t))
    if (isTooling) continue
    if (!usedPackages.has(pkg.name)) {
      dead.push({
        name: pkg.name,
        version: cleanVersion,
        projectName: project.name,
        projectPath: project.folderPath
      })
    }
  }

  return dead
}