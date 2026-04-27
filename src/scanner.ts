import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export interface PackageInfo {
  name: string
  version: string
  description?: string
  sizeBytes?: number
  projectCount?: number
}

export interface ProjectInfo {
  name: string
  folderPath: string
  packages: PackageInfo[]
  nodeModulesSize?: number
  nodeModulesExists: boolean
  packageCount: number
  lastModified?: Date
}

export interface ScanResult {
  projects: ProjectInfo[]
  totalSize: number
  duplicates: Map<string, { version: string; projects: string[]; totalSize: number }[]>
}

export async function quickScan(watchedFolders: string[]): Promise<ScanResult> {
  const projects: ProjectInfo[] = []

  for (const folder of watchedFolders) {
    if (!fs.existsSync(folder)) continue
    const found = await findProjects(folder)
    projects.push(...found)
  }

  return buildResult(projects)
}

export async function deepScan(watchedFolders: string[], progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<ScanResult> {
  const projects: ProjectInfo[] = []

  for (const folder of watchedFolders) {
    if (!fs.existsSync(folder)) continue
    const found = await findProjects(folder)
    for (const project of found) {
      progress.report({ message: `Scanning ${project.name}...` })
      if (project.nodeModulesExists) {
        project.nodeModulesSize = await getFolderSize(path.join(project.folderPath, 'node_modules'))
        project.packages = await readInstalledPackages(project.folderPath)
      }
      projects.push(project)
    }
  }

  return buildResult(projects)
}

const SKIP_DIRS = new Set([
  'node_modules', '$RECYCLE.BIN', 'System Volume Information',
  'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
  'AppData', 'recovery', 'boot', '.git'
])

async function findProjects(rootFolder: string): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(rootFolder, { withFileTypes: true })
  } catch {
    return projects
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || entry.name.startsWith('$') || SKIP_DIRS.has(entry.name)) continue

    const projectPath = path.join(rootFolder, entry.name)
    const packageJsonPath = path.join(projectPath, 'package.json')

    if (fs.existsSync(packageJsonPath)) {
      const info = readPackageJson(packageJsonPath)
      const nodeModulesPath = path.join(projectPath, 'node_modules')
      const nodeModulesExists = fs.existsSync(nodeModulesPath)
      const stat = fs.statSync(packageJsonPath)

      projects.push({
        name: info.name || entry.name,
        folderPath: projectPath,
        packages: readDependenciesFromPackageJson(info),
        nodeModulesExists,
        packageCount: countDependencies(info),
        lastModified: stat.mtime
      })
    } else {
      const nested = await findProjects(projectPath)
      projects.push(...nested)
    }
  }

  return projects
}

function readPackageJson(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function readDependenciesFromPackageJson(pkg: any): PackageInfo[] {
  const deps: PackageInfo[] = []
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const [name, version] of Object.entries(allDeps)) {
    deps.push({ name, version: String(version) })
  }
  return deps
}

function countDependencies(pkg: any): number {
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length
}

async function readInstalledPackages(projectPath: string): Promise<PackageInfo[]> {
  const nodeModulesPath = path.join(projectPath, 'node_modules')
  const packages: PackageInfo[] = []

  if (!fs.existsSync(nodeModulesPath)) return packages

  const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    if (entry.name.startsWith('@')) {
      const scopePath = path.join(nodeModulesPath, entry.name)
      const scopedEntries = fs.readdirSync(scopePath, { withFileTypes: true })
      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory()) continue
        const pkgPath = path.join(scopePath, scoped.name)
        const pkgJson = path.join(pkgPath, 'package.json')
        if (fs.existsSync(pkgJson)) {
          const info = readPackageJson(pkgJson)
          const size = await getFolderSize(pkgPath)
          packages.push({
            name: `${entry.name}/${scoped.name}`,
            version: info.version || 'unknown',
            description: info.description,
            sizeBytes: size
          })
        }
      }
    } else {
      const pkgPath = path.join(nodeModulesPath, entry.name)
      const pkgJson = path.join(pkgPath, 'package.json')
      if (fs.existsSync(pkgJson)) {
        const info = readPackageJson(pkgJson)
        const size = await getFolderSize(pkgPath)
        packages.push({
          name: entry.name,
          version: info.version || 'unknown',
          description: info.description,
          sizeBytes: size
        })
      }
    }
  }

  return packages
}

export async function getFolderSize(folderPath: string): Promise<number> {
  let total = 0
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(folderPath, entry.name)
      if (entry.isDirectory()) {
        total += await getFolderSize(entryPath)
      } else {
        try {
          total += fs.statSync(entryPath).size
        } catch {}
      }
    }
  } catch {}
  return total
}

function buildResult(projects: ProjectInfo[]): ScanResult {
  const totalSize = projects.reduce((acc, p) => acc + (p.nodeModulesSize || 0), 0)
  const duplicates = detectDuplicates(projects)
  return { projects, totalSize, duplicates }
}

function detectDuplicates(projects: ProjectInfo[]): Map<string, { version: string; projects: string[]; totalSize: number }[]> {
  const map = new Map<string, Map<string, { projects: string[]; totalSize: number }>>()

  for (const project of projects) {
    for (const pkg of project.packages) {
      if (!map.has(pkg.name)) map.set(pkg.name, new Map())
      const versionMap = map.get(pkg.name)!
      const cleanVersion = pkg.version.replace(/[\^~]/, '')
      if (!versionMap.has(cleanVersion)) {
        versionMap.set(cleanVersion, { projects: [], totalSize: 0 })
      }
      const entry = versionMap.get(cleanVersion)!
      entry.projects.push(project.name)
      entry.totalSize += pkg.sizeBytes || 0
    }
  }

  const result = new Map<string, { version: string; projects: string[]; totalSize: number }[]>()

  for (const [pkgName, versionMap] of map.entries()) {
    const versions: { version: string; projects: string[]; totalSize: number }[] = []
    for (const [version, data] of versionMap.entries()) {
      if (data.projects.length > 1) {
        versions.push({ version, ...data })
      }
    }
    if (versions.length > 0) result.set(pkgName, versions)
  }

  return result
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}