import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import * as child_process from 'child_process'
import { ScanResult } from './scanner'

export interface InstallResult {
  success: boolean
  method: 'symlink' | 'copy' | 'npm'
  message: string
}

function canSymlink(): boolean {
  const testDir = path.join(require('os').tmpdir(), '_packlens_symtest')
  const testLink = testDir + '_link'
  try {
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir)
    if (fs.existsSync(testLink)) fs.unlinkSync(testLink)
    fs.symlinkSync(testDir, testLink, 'junction')
    fs.unlinkSync(testLink)
    fs.rmdirSync(testDir)
    return true
  } catch {
    try { fs.rmdirSync(testDir) } catch {}
    return false
  }
}

function findPackageSource(packageName: string, scanResult: ScanResult): string | null {
  for (const project of scanResult.projects) {
    if (!project.nodeModulesExists) continue
    const pkgPath = path.join(project.folderPath, 'node_modules', packageName)
    if (fs.existsSync(pkgPath)) return pkgPath
  }
  return null
}

function getInstalledVersion(packagePath: string): string {
  try {
    const pkgJson = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8'))
    return pkgJson.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

function updatePackageJson(projectPath: string, packageName: string, version: string) {
  const pkgJsonPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) return
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    pkg.dependencies = pkg.dependencies || {}
    pkg.dependencies[packageName] = `^${version}`
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2))
  } catch {}
}

function runNpmInstall(targetPath: string, packageName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = child_process.spawn('npm', ['install', packageName], {
      cwd: targetPath,
      shell: true,
      stdio: 'ignore'
    })
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}`)))
    proc.on('error', reject)
  })
}

export async function installPackage(
  packageName: string,
  requestedVersion: string,
  targetProjectPath: string,
  scanResult: ScanResult
): Promise<InstallResult> {
  const nodeModulesPath = path.join(targetProjectPath, 'node_modules')
  const targetPkgPath = path.join(nodeModulesPath, packageName)

  if (fs.existsSync(targetPkgPath)) {
    const existingVersion = getInstalledVersion(targetPkgPath)
    return {
      success: false,
      method: 'symlink',
      message: `${packageName}@${existingVersion} is already installed in this project.`
    }
  }

  const sourcePath = findPackageSource(packageName, scanResult)

  if (sourcePath) {
    const version = getInstalledVersion(sourcePath)
    fs.mkdirSync(nodeModulesPath, { recursive: true })

    if (canSymlink()) {
      try {
        fs.symlinkSync(sourcePath, targetPkgPath, 'junction')
        updatePackageJson(targetProjectPath, packageName, version)
        return {
          success: true,
          method: 'symlink',
          message: `Linked ${packageName}@${version} from existing project. No download needed.`
        }
      } catch {
        // fall through to copy
      }
    }

    try {
      copyDir(sourcePath, targetPkgPath)
      updatePackageJson(targetProjectPath, packageName, version)
      return {
        success: true,
        method: 'copy',
        message: `Copied ${packageName}@${version} from existing project. (Symlinks unavailable — enable Developer Mode for zero-copy installs.)`
      }
    } catch (err) {
      return {
        success: false,
        method: 'copy',
        message: `Failed to copy ${packageName}: ${err}`
      }
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    `PackLens: "${packageName}" wasn't found in any local project. Install via npm? This will use your internet.`,
    { modal: true },
    'Install via npm',
    'Cancel'
  )

  if (!confirm || confirm === 'Cancel') {
    return {
      success: false,
      method: 'npm',
      message: `Cancelled. "${packageName}" is not available locally.`
    }
  }

  try {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `PackLens: Installing ${packageName} via npm...`,
      cancellable: false
    }, async () => {
      await runNpmInstall(targetProjectPath, packageName)
    })

    const installedPath = path.join(nodeModulesPath, packageName)
    const version = fs.existsSync(installedPath) ? getInstalledVersion(installedPath) : requestedVersion

    return {
      success: true,
      method: 'npm',
      message: `Installed ${packageName}@${version} via npm.`
    }
  } catch (err) {
    return {
      success: false,
      method: 'npm',
      message: `npm install failed for ${packageName}: ${err}`
    }
  }
}

export function getInstallMethodLabel(method: 'symlink' | 'copy' | 'npm'): string {
  switch (method) {
    case 'symlink': return 'Linked locally — no download'
    case 'copy': return 'Copied locally — no download'
    case 'npm': return 'Installed via npm'
  }
}