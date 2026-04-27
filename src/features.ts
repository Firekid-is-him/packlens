import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { ProjectInfo } from './scanner'

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
  latestVersion?: string
  publishedAt?: string
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
      deprecated: data.deprecated,
      publishedAt: data.time?.[data.version]
    }
  } catch {
    return null
  }
}

export async function checkOutdated(projects: ProjectInfo[]): Promise<OutdatedPackage[]> {
  const outdated: OutdatedPackage[] = []
  const checked = new Map<string, string>()

  for (const project of projects) {
    for (const pkg of project.packages) {
      const cleanCurrent = pkg.version.replace(/[\^~>=<]/, '').trim()
      if (!cleanCurrent || cleanCurrent === '*' || cleanCurrent === 'latest') continue

      let latest = checked.get(pkg.name)
      if (!latest) {
        const meta = await fetchPackageMeta(pkg.name)
        latest = meta?.version || cleanCurrent
        checked.set(pkg.name, latest)
      }

      if (latest && latest !== cleanCurrent && isNewer(latest, cleanCurrent)) {
        outdated.push({
          name: pkg.name,
          current: cleanCurrent,
          latest,
          projectName: project.name,
          projectPath: project.folderPath
        })
      }
    }
  }

  return outdated
}

function isNewer(a: string, b: string): boolean {
  try {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0)
      if (diff > 0) return true
      if (diff < 0) return false
    }
    return false
  } catch {
    return false
  }
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
  if (project.packages.length === 0) return dead

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

  for (const pkg of project.packages) {
    const cleanVersion = pkg.version.replace(/[\^~>=<]/, '')
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