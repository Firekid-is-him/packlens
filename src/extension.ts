import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { quickScan, deepScan, ScanResult, formatBytes } from './scanner'
import { ProjectsProvider, DuplicatesProvider, StatsProvider } from './treeProvider'
import { PackLensPanel } from './webviewPanel'
import { installPackage } from './installer'
import { checkOutdated, findDeadPackages, OutdatedPackage, DeadPackage } from './features'
import { PackageJsonHoverProvider } from './hoverProvider'
import { getTemplates, createTemplateFromProject, applyTemplate, deleteTemplate, serializeTemplates } from './templates'

let projectsProvider: ProjectsProvider
let duplicatesProvider: DuplicatesProvider
let statsProvider: StatsProvider
let statusBarItem: vscode.StatusBarItem
let lastScanResult: ScanResult | null = null
let extensionContext: vscode.ExtensionContext

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context

  projectsProvider = new ProjectsProvider()
  duplicatesProvider = new DuplicatesProvider()
  statsProvider = new StatsProvider()

  vscode.window.registerTreeDataProvider('packlens.projectsView', projectsProvider)
  vscode.window.registerTreeDataProvider('packlens.duplicatesView', duplicatesProvider)
  vscode.window.registerTreeDataProvider('packlens.statsView', statsProvider)

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBarItem.command = 'packlens.openPanel'
  statusBarItem.text = '$(package) PackLens'
  statusBarItem.tooltip = 'Open PackLens'
  statusBarItem.show()
  context.subscriptions.push(statusBarItem)

  context.subscriptions.push(
    vscode.commands.registerCommand('packlens.addFolder', addFolder),
    vscode.commands.registerCommand('packlens.removeFolder', removeFolder),
    vscode.commands.registerCommand('packlens.quickScan', runQuickScan),
    vscode.commands.registerCommand('packlens.deepScan', runDeepScan),
    vscode.commands.registerCommand('packlens.refreshAll', runQuickScan),
    vscode.commands.registerCommand('packlens.openProject', openProject),
    vscode.commands.registerCommand('packlens.deleteNodeModules', deleteNodeModules),
    vscode.commands.registerCommand('packlens.deleteNodeModulesPath', deleteNodeModulesByPath),
    vscode.commands.registerCommand('packlens.openPackageDetail', openPackageDetail),
    vscode.commands.registerCommand('packlens.installFromCache', installFromCache),
    vscode.commands.registerCommand('packlens.openPanel', openPanel),
    vscode.commands.registerCommand('packlens.checkOutdated', checkOutdatedCmd),
    vscode.commands.registerCommand('packlens.findDead', findDeadCmd),
    vscode.commands.registerCommand('packlens.saveTemplate', saveTemplateCmd),
    vscode.commands.registerCommand('packlens.applyTemplate', applyTemplateCmd),
    vscode.commands.registerCommand('packlens.deleteTemplate', deleteTemplateCmd),
    vscode.languages.registerHoverProvider(
      { pattern: '**/package.json' },
      new PackageJsonHoverProvider()
    )
  )

  const config = vscode.workspace.getConfiguration('packlens')
  const autoScan = config.get<boolean>('autoScanOnStartup', true)
  const folders = config.get<string[]>('watchedFolders', [])

  if (autoScan && folders.length > 0) {
    runQuickScan()
  }
}

async function openPanel() {
  PackLensPanel.createOrShow(extensionContext, lastScanResult)
  if (!lastScanResult) {
    const folders = vscode.workspace.getConfiguration('packlens').get<string[]>('watchedFolders', [])
    if (folders.length > 0) runQuickScan()
  }
}

async function addFolder() {
  const uris = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: true,
    openLabel: 'Add to PackLens'
  })

  if (!uris || uris.length === 0) return

  const config = vscode.workspace.getConfiguration('packlens')
  const existing = config.get<string[]>('watchedFolders', [])
  const newFolders = uris.map(u => u.fsPath).filter(f => !existing.includes(f))

  if (newFolders.length === 0) {
    vscode.window.showInformationMessage('All selected folders are already being watched.')
    return
  }

  await config.update('watchedFolders', [...existing, ...newFolders], vscode.ConfigurationTarget.Global)
  vscode.window.showInformationMessage(`Added ${newFolders.length} folder(s). Running scan...`)
  runQuickScan()
}

async function removeFolder() {
  const config = vscode.workspace.getConfiguration('packlens')
  const folders = config.get<string[]>('watchedFolders', [])

  if (folders.length === 0) {
    vscode.window.showInformationMessage('No watched folders to remove.')
    return
  }

  const picked = await vscode.window.showQuickPick(folders, {
    placeHolder: 'Select folder to remove',
    canPickMany: true
  })

  if (!picked || picked.length === 0) return

  const updated = folders.filter(f => !picked.includes(f))
  await config.update('watchedFolders', updated, vscode.ConfigurationTarget.Global)
  vscode.window.showInformationMessage(`Removed ${picked.length} folder(s).`)
  runQuickScan()
}

async function runQuickScan() {
  const folders = vscode.workspace.getConfiguration('packlens').get<string[]>('watchedFolders', [])

  if (folders.length === 0) {
    vscode.window.showInformationMessage('No folders added yet. Click the + button to add a folder.')
    return
  }

  projectsProvider.setLoading(true)
  statusBarItem.text = '$(sync~spin) PackLens: Scanning...'

  try {
    const result = await quickScan(folders)
    lastScanResult = result
    applyResult(result)

    const wasted = calculateWastedSpace(result)
    if (wasted > 100 * 1024 * 1024) {
      vscode.window.showWarningMessage(
        `PackLens: You have ${formatBytes(wasted)} of duplicate packages across ${result.projects.length} projects.`,
        'Open PackLens'
      ).then(action => {
        if (action === 'Open PackLens') openPanel()
      })
    }
  } catch (err) {
    vscode.window.showErrorMessage(`PackLens scan failed: ${err}`)
  } finally {
    projectsProvider.setLoading(false)
  }
}

async function runDeepScan() {
  const folders = vscode.workspace.getConfiguration('packlens').get<string[]>('watchedFolders', [])

  if (folders.length === 0) {
    vscode.window.showInformationMessage('No folders added yet. Click the + button to add a folder.')
    return
  }

  projectsProvider.setLoading(true)
  statusBarItem.text = '$(sync~spin) PackLens: Deep scanning...'

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'PackLens Deep Scan',
    cancellable: false
  }, async (progress) => {
    try {
      const result = await deepScan(folders, progress)
      lastScanResult = result
      applyResult(result)

      const wasted = calculateWastedSpace(result)
      vscode.window.showInformationMessage(
        `Deep scan complete — ${result.projects.length} projects · ${formatBytes(result.totalSize)} total · ${formatBytes(wasted)} wasted`,
        'Open PackLens'
      ).then(action => {
        if (action === 'Open PackLens') openPanel()
      })
    } catch (err) {
      vscode.window.showErrorMessage(`PackLens deep scan failed: ${err}`)
    } finally {
      projectsProvider.setLoading(false)
    }
  })
}

function applyResult(result: ScanResult) {
  projectsProvider.setScanResult(result)
  duplicatesProvider.setScanResult(result)
  statsProvider.setScanResult(result)

  const wasted = calculateWastedSpace(result)
  statusBarItem.text = `$(package) PackLens: ${formatBytes(result.totalSize)}`
  statusBarItem.tooltip = `${result.projects.length} projects · ${formatBytes(wasted)} wasted\nClick to open PackLens`

  if (PackLensPanel.currentPanel) {
    setTimeout(() => PackLensPanel.currentPanel?.update(result), 1500)
  }
}

function calculateWastedSpace(result: ScanResult): number {
  let wasted = 0
  for (const versions of result.duplicates.values()) {
    for (const v of versions) {
      const perExtra = v.totalSize / v.projects.length
      wasted += perExtra * (v.projects.length - 1)
    }
  }
  return wasted
}

async function openProject(item: any) {
  const project = item?.data
  if (!project?.folderPath) return
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.folderPath), { forceNewWindow: true })
}

async function deleteNodeModules(item: any) {
  const project = item?.data
  if (!project?.folderPath) return
  await deleteNodeModulesByPath(project.folderPath, project.name)
}

async function deleteNodeModulesByPath(folderPath: string, projectName: string) {
  const nodeModulesPath = path.join(folderPath, 'node_modules')

  if (!fs.existsSync(nodeModulesPath)) {
    vscode.window.showInformationMessage('No node_modules folder found.')
    return
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete node_modules from "${projectName}"? This cannot be undone.`,
    { modal: true },
    'Delete'
  )

  if (confirm !== 'Delete') return

  try {
    fs.rmSync(nodeModulesPath, { recursive: true, force: true })
    vscode.window.showInformationMessage(`Deleted node_modules from ${projectName}.`)
    runQuickScan()
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to delete node_modules: ${err}`)
  }
}

async function openPackageDetail(item: any) {
  const { pkg, project } = item?.data || {}
  if (!pkg) return

  const panel = vscode.window.createWebviewPanel(
    'packlens.packageDetail',
    pkg.name,
    vscode.ViewColumn.One,
    { enableScripts: true }
  )

  panel.webview.html = getPackageDetailHtml(pkg, project)

  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.command === 'openExternal') {
      await vscode.env.openExternal(vscode.Uri.parse(msg.url))
    }
  })
}

async function installFromCache(item: any) {
  const { pkg } = item?.data || {}
  if (!pkg || !lastScanResult) return

  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showInformationMessage('Open a project in VS Code first.')
    return
  }

  let targetPath = workspaceFolders[0].uri.fsPath
  if (workspaceFolders.length > 1) {
    const picked = await vscode.window.showQuickPick(
      workspaceFolders.map(f => f.name),
      { placeHolder: 'Which project to install into?' }
    )
    if (!picked) return
    targetPath = workspaceFolders.find(f => f.name === picked)!.uri.fsPath
  }

  const result = await installPackage(pkg.name, pkg.version, targetPath, lastScanResult)
  if (result.success) {
    vscode.window.showInformationMessage(`PackLens: ${result.message}`)
  } else {
    vscode.window.showErrorMessage(`PackLens: ${result.message}`)
  }
}

function getPackageDetailHtml(pkg: any, project: any): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pkg.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px;
    }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .version { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
    .description { margin-bottom: 24px; opacity: 0.8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 6px;
      padding: 14px;
    }
    .card-label { font-size: 11px; text-transform: uppercase; opacity: 0.6; margin-bottom: 4px; }
    .card-value { font-size: 16px; font-weight: 600; }
    .actions { display: flex; gap: 10px; }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h1>${pkg.name}</h1>
  <div class="version">${pkg.version}</div>
  ${pkg.description ? `<div class="description">${pkg.description}</div>` : ''}
  <div class="grid">
    <div class="card">
      <div class="card-label">Size on disk</div>
      <div class="card-value">${pkg.sizeBytes ? formatBytes(pkg.sizeBytes) : 'Run deep scan'}</div>
    </div>
    <div class="card">
      <div class="card-label">Project</div>
      <div class="card-value">${project?.name || '—'}</div>
    </div>
  </div>
  <div class="actions">
    <button onclick="openNpm()">View on npm</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function openNpm() {
      vscode.postMessage({ command: 'openExternal', url: 'https://npmjs.com/package/${pkg.name}' });
    }
  </script>
</body>
</html>`
}

async function checkOutdatedCmd() {
  if (!lastScanResult) {
    vscode.window.showInformationMessage('Run a scan first.')
    return
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'PackLens: Checking for outdated packages...',
    cancellable: false
  }, async () => {
    const outdated = await checkOutdated(lastScanResult!.projects)
    if (PackLensPanel.currentPanel) {
      PackLensPanel.currentPanel.sendMessage({ command: 'outdatedResult', data: outdated })
    }
    if (outdated.length === 0) {
      vscode.window.showInformationMessage('All packages are up to date.')
    } else {
      vscode.window.showWarningMessage(
        `PackLens: ${outdated.length} outdated packages found.`,
        'View in PackLens'
      ).then(a => { if (a) openPanel() })
    }
  })
}

async function findDeadCmd() {
  if (!lastScanResult) {
    vscode.window.showInformationMessage('Run a scan first.')
    return
  }

  const dead: DeadPackage[] = []
  for (const project of lastScanResult.projects) {
    dead.push(...findDeadPackages(project))
  }

  if (PackLensPanel.currentPanel) {
    PackLensPanel.currentPanel.sendMessage({ command: 'deadResult', data: dead })
  }

  if (dead.length === 0) {
    vscode.window.showInformationMessage('No unused packages found.')
  } else {
    vscode.window.showWarningMessage(
      `PackLens: ${dead.length} potentially unused packages found.`,
      'View in PackLens'
    ).then(a => { if (a) openPanel() })
  }
}

async function saveTemplateCmd(item: any) {
  const project = item?.data
  if (!project) {
    vscode.window.showInformationMessage('Right-click a project to save it as a template.')
    return
  }
  await createTemplateFromProject(extensionContext, project.name, project.packages)
  if (PackLensPanel.currentPanel) {
    const templates = getTemplates(extensionContext)
    PackLensPanel.currentPanel.sendMessage({ command: 'templatesUpdate', data: serializeTemplates(templates) })
  }
}

async function applyTemplateCmd() {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showInformationMessage('Open a project first.')
    return
  }
  const template = await applyTemplate(extensionContext, workspaceFolders[0].uri.fsPath)
  if (!template) return

  if (PackLensPanel.currentPanel) {
    PackLensPanel.currentPanel.sendMessage({ command: 'applyTemplate', data: template })
  } else {
    vscode.window.showInformationMessage(`Template "${template.name}" ready — open PackLens to install packages.`)
  }
}

async function deleteTemplateCmd(id: string) {
  await deleteTemplate(extensionContext, id)
  if (PackLensPanel.currentPanel) {
    const templates = getTemplates(extensionContext)
    PackLensPanel.currentPanel.sendMessage({ command: 'templatesUpdate', data: serializeTemplates(templates) })
  }
}

export function deactivate() {}