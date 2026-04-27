import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import { ScanResult, formatBytes } from './scanner'
import { installPackage } from './installer'

export class PackLensPanel {
  static currentPanel: PackLensPanel | undefined
  private readonly panel: vscode.WebviewPanel
  private scanResult: ScanResult | null = null
  private disposables: vscode.Disposable[] = []

  static createOrShow(context: vscode.ExtensionContext, scanResult: ScanResult | null) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One

    if (PackLensPanel.currentPanel) {
      PackLensPanel.currentPanel.panel.reveal(column)
      if (scanResult) PackLensPanel.currentPanel.update(scanResult)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'packlens.main',
      'PackLens',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')]
      }
    )

    PackLensPanel.currentPanel = new PackLensPanel(panel, context, scanResult)
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, scanResult: ScanResult | null) {
    this.panel = panel
    this.scanResult = scanResult
    this.panel.webview.html = this.getHtml()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)

    this.panel.webview.onDidReceiveMessage(async msg => {
      switch (msg.command) {
        case 'ready':
          if (this.scanResult) this.update(this.scanResult)
          break
        case 'addToProject':
          await this.handleInstall(msg.packageName, msg.version)
          break
        case 'openProject':
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(msg.folderPath), { forceNewWindow: true })
          break
        case 'deleteNodeModules':
          await vscode.commands.executeCommand('packlens.deleteNodeModulesPath', msg.folderPath, msg.projectName)
          break
        case 'openNpm':
          await vscode.env.openExternal(vscode.Uri.parse(`https://npmjs.com/package/${msg.packageName}`))
          break
        case 'runDeepScan':
          await vscode.commands.executeCommand('packlens.deepScan')
          break
        case 'runQuickScan':
          await vscode.commands.executeCommand('packlens.quickScan')
          break
        case 'addFolder':
          await vscode.commands.executeCommand('packlens.addFolder')
          break
        case 'checkOutdated':
          await vscode.commands.executeCommand('packlens.checkOutdated')
          break
        case 'findDead':
          await vscode.commands.executeCommand('packlens.findDead')
          break
        case 'saveTemplate':
          await vscode.commands.executeCommand('packlens.saveTemplate', msg.project)
          break
        case 'applyTemplate':
          await vscode.commands.executeCommand('packlens.applyTemplate')
          break
        case 'deleteTemplate':
          await vscode.commands.executeCommand('packlens.deleteTemplate', msg.id)
          break
        case 'installFromTemplate':
          await this.handleInstall(msg.packageName, msg.version)
          break
      }
    }, null, this.disposables)


  }

  update(result: ScanResult) {
    this.scanResult = result
    this.panel.webview.postMessage({ command: 'updateData', data: this.serializeResult(result) })
  }

  sendMessage(msg: any) {
    this.panel.webview.postMessage(msg)
  }

  private serializeResult(result: ScanResult) {
    const projects = result.projects.map(p => ({
      name: p.name,
      folderPath: p.folderPath,
      packageCount: p.packageCount,
      nodeModulesExists: p.nodeModulesExists,
      nodeModulesSize: p.nodeModulesSize || 0,
      nodeModulesSizeFormatted: p.nodeModulesSize ? formatBytes(p.nodeModulesSize) : null,
      lastModified: p.lastModified?.toLocaleDateString(),
      packages: p.packages.map(pkg => ({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description || '',
        sizeBytes: pkg.sizeBytes || 0,
        sizeFormatted: pkg.sizeBytes ? formatBytes(pkg.sizeBytes) : null
      }))
    }))

    const allPackages: any[] = []
    const seen = new Map<string, any>()
    for (const p of result.projects) {
      for (const pkg of p.packages) {
        const key = pkg.name
        if (seen.has(key)) {
          seen.get(key).projects.push(p.name)
        } else {
          const entry = {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description || '',
            sizeBytes: pkg.sizeBytes || 0,
            sizeFormatted: pkg.sizeBytes ? formatBytes(pkg.sizeBytes) : null,
            projects: [p.name]
          }
          seen.set(key, entry)
          allPackages.push(entry)
        }
      }
    }

    const duplicates: any[] = []
    for (const [pkgName, versions] of result.duplicates.entries()) {
      for (const v of versions) {
        const wasted = (v.totalSize / v.projects.length) * (v.projects.length - 1)
        duplicates.push({
          name: pkgName,
          version: v.version,
          projectCount: v.projects.length,
          projects: v.projects,
          totalSize: v.totalSize,
          wastedSize: wasted,
          wastedFormatted: formatBytes(wasted)
        })
      }
    }

    const totalWasted = duplicates.reduce((a, d) => a + d.wastedSize, 0)

    return {
      projects,
      allPackages,
      duplicates,
      stats: {
        totalProjects: result.projects.length,
        totalPackages: allPackages.length,
        totalSize: formatBytes(result.totalSize),
        duplicateCount: result.duplicates.size,
        wastedSpace: formatBytes(totalWasted),
        hasRealSizes: result.projects.some(p => p.nodeModulesSize && p.nodeModulesSize > 0)
      }
    }
  }

  private async handleInstall(packageName: string, version: string) {
    if (!this.scanResult) {
      vscode.window.showInformationMessage('Run a scan first.')
      return
    }

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

    const result = await installPackage(packageName, version, targetPath, this.scanResult)
    if (result.success) {
      vscode.window.showInformationMessage(`PackLens: ${result.message}`)
      this.panel.webview.postMessage({ command: 'installSuccess', packageName })
    } else {
      vscode.window.showErrorMessage(`PackLens: ${result.message}`)
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PackLens</title>
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: var(--vscode-editor-background);
    --bg2: var(--vscode-sideBar-background);
    --bg3: var(--vscode-input-background);
    --border: var(--vscode-panel-border, #ffffff18);
    --fg: var(--vscode-foreground);
    --fg2: var(--vscode-descriptionForeground);
    --accent: var(--vscode-focusBorder, #0078d4);
    --hover: var(--vscode-list-hoverBackground);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --btn-hover: var(--vscode-button-hoverBackground);
    --tag-bg: var(--vscode-badge-background);
    --tag-fg: var(--vscode-badge-foreground);
    --warn: #f59e0b;
    --danger: #ef4444;
    --success: #22c55e;
    --radius: 6px;
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.5;
    min-height: 100vh;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-left { display: flex; align-items: center; gap: 10px; }
  .header-left h1 { font-size: 15px; font-weight: 600; }
  .header-left .logo { color: var(--accent); }

  .header-actions { display: flex; gap: 8px; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    transition: background 0.15s;
  }
  .btn:hover { background: var(--btn-hover); }
  .btn.secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .btn.secondary:hover { background: var(--hover); }
  .btn.ghost {
    background: transparent;
    color: var(--fg2);
    padding: 4px 8px;
  }
  .btn.ghost:hover { background: var(--hover); color: var(--fg); }
  .btn.danger { background: var(--danger); }
  .btn.small { padding: 3px 8px; font-size: 11px; }
  .btn svg { width: 13px; height: 13px; flex-shrink: 0; }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 12px 20px 0;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    cursor: pointer;
    border-radius: var(--radius) var(--radius) 0 0;
    font-size: 12px;
    color: var(--fg2);
    border: 1px solid transparent;
    border-bottom: none;
    background: transparent;
    font-family: var(--vscode-font-family);
    transition: color 0.15s;
  }
  .tab:hover { color: var(--fg); background: var(--hover); }
  .tab.active {
    color: var(--fg);
    background: var(--bg);
    border-color: var(--border);
    border-bottom-color: var(--bg);
  }
  .tab svg { width: 13px; height: 13px; }
  .tab .badge {
    background: var(--tag-bg);
    color: var(--tag-fg);
    border-radius: 10px;
    padding: 1px 6px;
    font-size: 10px;
    font-weight: 600;
  }

  .content { padding: 20px; }

  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .search-bar {
    position: relative;
    margin-bottom: 16px;
  }
  .search-bar svg {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg2);
    width: 14px;
    height: 14px;
    pointer-events: none;
  }
  .search-bar input {
    width: 100%;
    padding: 8px 12px 8px 32px;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    font-size: 13px;
    font-family: var(--vscode-font-family);
    outline: none;
    transition: border-color 0.15s;
  }
  .search-bar input:focus { border-color: var(--accent); }
  .search-bar input::placeholder { color: var(--fg2); }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }

  .stat-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
  }
  .stat-card .stat-label {
    font-size: 11px;
    color: var(--fg2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .stat-card .stat-label svg { width: 12px; height: 12px; }
  .stat-card .stat-value { font-size: 22px; font-weight: 700; }
  .stat-card .stat-sub { font-size: 11px; color: var(--fg2); margin-top: 2px; }
  .stat-card.warn .stat-value { color: var(--warn); }
  .stat-card.danger .stat-value { color: var(--danger); }
  .stat-card.success .stat-value { color: var(--success); }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--fg2);
  }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .project-card {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px;
    transition: border-color 0.15s;
  }
  .project-card:hover { border-color: var(--accent); }
  .project-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .project-card-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 600;
    font-size: 13px;
  }
  .project-card-title svg { width: 14px; height: 14px; color: var(--accent); flex-shrink: 0; }
  .project-card-actions { display: flex; gap: 4px; }
  .project-card-meta {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .meta-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--fg2);
  }
  .meta-chip svg { width: 11px; height: 11px; }
  .no-modules { color: var(--warn); }

  .pkg-list { display: flex; flex-direction: column; gap: 2px; }

  .pkg-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-radius: var(--radius);
    transition: background 0.1s;
  }
  .pkg-row:hover { background: var(--hover); }
  .pkg-row-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pkg-row-left svg { width: 13px; height: 13px; color: var(--fg2); flex-shrink: 0; }
  .pkg-name { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
  .pkg-version {
    font-size: 11px;
    color: var(--fg2);
    background: var(--bg3);
    border-radius: 4px;
    padding: 1px 6px;
    flex-shrink: 0;
  }
  .pkg-row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .pkg-size { font-size: 11px; color: var(--fg2); }
  .pkg-projects { font-size: 11px; color: var(--fg2); }

  .dup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 6px;
  }
  .dup-left { display: flex; align-items: center; gap: 8px; }
  .dup-left svg { width: 14px; height: 14px; color: var(--warn); flex-shrink: 0; }
  .dup-name { font-weight: 500; }
  .dup-meta { font-size: 11px; color: var(--fg2); }
  .dup-right { display: flex; align-items: center; gap: 10px; }
  .wasted-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--warn);
    background: #f59e0b18;
    border-radius: 4px;
    padding: 2px 8px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
    gap: 12px;
  }
  .empty-state svg { width: 40px; height: 40px; color: var(--fg2); opacity: 0.4; }
  .empty-state h3 { font-size: 15px; font-weight: 600; }
  .empty-state p { color: var(--fg2); font-size: 12px; max-width: 300px; }

  .deep-scan-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #0078d418;
    border: 1px solid #0078d440;
    border-radius: var(--radius);
    margin-bottom: 16px;
    font-size: 12px;
  }
  .deep-scan-banner-left { display: flex; align-items: center; gap: 8px; color: var(--fg2); }
  .deep-scan-banner svg { width: 13px; height: 13px; color: var(--accent); }

  .filter-row {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .filter-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg2);
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
  }
  .filter-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .filter-chip:hover:not(.active) { background: var(--hover); color: var(--fg); }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px;
    gap: 10px;
    color: var(--fg2);
    font-size: 13px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 1s linear infinite; }

  .tag {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
  }
  .tag.dev { background: #6366f118; color: #818cf8; }
  .tag.prod { background: #22c55e18; color: #22c55e; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <i data-lucide="package" class="logo" style="width:18px;height:18px"></i>
    <h1>PackLens</h1>
  </div>
  <div class="header-actions">
    <button class="btn secondary small" onclick="send('addFolder')">
      <i data-lucide="folder-plus"></i> Add Folder
    </button>
    <button class="btn secondary small" onclick="send('runQuickScan')">
      <i data-lucide="search"></i> Quick Scan
    </button>
    <button class="btn small" onclick="send('runDeepScan')">
      <i data-lucide="database"></i> Deep Scan
    </button>
  </div>
</div>

<div class="tabs">
  <button class="tab active" data-tab="overview" onclick="switchTab('overview')">
    <i data-lucide="layout-dashboard"></i> Overview
  </button>
  <button class="tab" data-tab="projects" onclick="switchTab('projects')">
    <i data-lucide="folder"></i> Projects
    <span class="badge" id="projects-count">0</span>
  </button>
  <button class="tab" data-tab="packages" onclick="switchTab('packages')">
    <i data-lucide="box"></i> All Packages
    <span class="badge" id="packages-count">0</span>
  </button>
  <button class="tab" data-tab="duplicates" onclick="switchTab('duplicates')">
    <i data-lucide="copy"></i> Duplicates
    <span class="badge" id="duplicates-count" style="background:#f59e0b22;color:#f59e0b">0</span>
  </button>
  <button class="tab" data-tab="outdated" onclick="switchTab('outdated')">
    <i data-lucide="refresh-cw"></i> Outdated
    <span class="badge" id="outdated-count" style="background:#f59e0b22;color:#f59e0b">0</span>
  </button>
  <button class="tab" data-tab="dead" onclick="switchTab('dead')">
    <i data-lucide="skull"></i> Unused
    <span class="badge" id="dead-count" style="background:#ef444422;color:#ef4444">0</span>
  </button>
  <button class="tab" data-tab="templates" onclick="switchTab('templates')">
    <i data-lucide="layout-template"></i> Templates
  </button>
</div>

<div class="content">

  <div class="tab-panel active" id="panel-overview">
    <div id="overview-content">
      <div class="empty-state">
        <i data-lucide="package-open"></i>
        <h3>Welcome to PackLens</h3>
        <p>Add a folder and run a scan to see your npm packages across all projects.</p>
        <button class="btn" onclick="send('addFolder')">
          <i data-lucide="folder-plus"></i> Add Folder
        </button>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="panel-projects">
    <div class="search-bar">
      <i data-lucide="search"></i>
      <input type="text" id="project-search" placeholder="Search projects..." oninput="filterProjects(this.value)">
    </div>
    <div id="projects-grid" class="project-grid"></div>
  </div>

  <div class="tab-panel" id="panel-packages">
    <div class="search-bar">
      <i data-lucide="search"></i>
      <input type="text" id="package-search" placeholder="Search packages..." oninput="filterPackages(this.value)">
    </div>
    <div class="filter-row">
      <span style="font-size:11px;color:var(--fg2)">Sort by:</span>
      <button class="filter-chip active" onclick="sortPackages('name', this)">Name</button>
      <button class="filter-chip" onclick="sortPackages('size', this)">Size</button>
      <button class="filter-chip" onclick="sortPackages('projects', this)">Most used</button>
    </div>
    <div id="packages-list" class="pkg-list"></div>
  </div>

  <div class="tab-panel" id="panel-duplicates">
    <div id="duplicates-list"></div>
  </div>

  <div class="tab-panel" id="panel-outdated">
    <div class="section-header" style="margin-bottom:16px">
      <span style="font-size:12px;color:var(--fg2)">Checks npm registry for newer versions across all projects.</span>
      <button class="btn small" onclick="send('checkOutdated')">
        <i data-lucide="refresh-cw"></i> Check Now
      </button>
    </div>
    <div id="outdated-list">
      <div class="empty-state">
        <i data-lucide="refresh-cw"></i>
        <h3>Not checked yet</h3>
        <p>Click Check Now to scan for outdated packages. Requires internet.</p>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="panel-dead">
    <div class="section-header" style="margin-bottom:16px">
      <span style="font-size:12px;color:var(--fg2)">Packages in package.json not imported in any source file.</span>
      <button class="btn small" onclick="send('findDead')">
        <i data-lucide="scan-search"></i> Scan Now
      </button>
    </div>
    <div id="dead-list">
      <div class="empty-state">
        <i data-lucide="package-x"></i>
        <h3>Not scanned yet</h3>
        <p>Click Scan Now to find unused packages across your projects.</p>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="panel-templates">
    <div class="section-header" style="margin-bottom:16px">
      <span style="font-size:12px;color:var(--fg2)">Save package sets as reusable templates for new projects.</span>
      <button class="btn small" onclick="send('applyTemplate')">
        <i data-lucide="download"></i> Apply Template
      </button>
    </div>
    <div id="templates-list">
      <div class="empty-state">
        <i data-lucide="layout-template"></i>
        <h3>No templates saved</h3>
        <p>Right-click a project in the Projects tab and choose Save as Template.</p>
      </div>
    </div>
  </div>

</div>

<script>
  const vscode = acquireVsCodeApi()
  let appData = null
  let currentSort = 'name'

  function send(command, extra) {
    vscode.postMessage({ command, ...extra })
  }

  function switchTab(id) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + id))
  }

  window.addEventListener('message', e => {
    const msg = e.data
    if (msg.command === 'updateData') {
      appData = msg.data
      render()
    }
    if (msg.command === 'installSuccess') {
      const btn = document.querySelector('[data-pkg="' + msg.packageName + '"]')
      if (btn) { btn.textContent = 'Added'; btn.disabled = true }
    }
    if (msg.command === 'outdatedResult') {
      renderOutdated(msg.data)
      document.getElementById('outdated-count').textContent = msg.data.length
      lucide.createIcons()
    }
    if (msg.command === 'deadResult') {
      renderDead(msg.data)
      document.getElementById('dead-count').textContent = msg.data.length
      lucide.createIcons()
    }
    if (msg.command === 'templatesUpdate') {
      renderTemplates(msg.data)
      lucide.createIcons()
    }
    if (msg.command === 'applyTemplate') {
      renderTemplateInstaller(msg.data)
      switchTab('templates')
      lucide.createIcons()
    }
  })

  function render() {
    if (!appData) return
    const { projects, allPackages, duplicates, stats } = appData

    document.getElementById('projects-count').textContent = stats.totalProjects
    document.getElementById('packages-count').textContent = allPackages.length
    document.getElementById('duplicates-count').textContent = stats.duplicateCount

    renderOverview(stats, projects, duplicates)
    renderProjects(projects)
    renderPackages(allPackages)
    renderDuplicates(duplicates)

    lucide.createIcons()
  }

  function renderOverview(stats, projects, duplicates) {
    const hasRealSizes = stats.hasRealSizes
    document.getElementById('overview-content').innerHTML = \`
      \${!hasRealSizes ? \`
        <div class="deep-scan-banner">
          <div class="deep-scan-banner-left">
            <i data-lucide="info"></i>
            Run a Deep Scan to get real sizes — Quick Scan reads package.json only.
          </div>
          <button class="btn small" onclick="send('runDeepScan')">
            <i data-lucide="database"></i> Deep Scan
          </button>
        </div>
      \` : ''}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label"><i data-lucide="folder"></i> Projects</div>
          <div class="stat-value">\${stats.totalProjects}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label"><i data-lucide="box"></i> Packages</div>
          <div class="stat-value">\${stats.totalPackages}</div>
        </div>
        <div class="stat-card \${hasRealSizes ? '' : ''}">
          <div class="stat-label"><i data-lucide="hard-drive"></i> Total Size</div>
          <div class="stat-value">\${stats.totalSize}</div>
          <div class="stat-sub">\${hasRealSizes ? 'from deep scan' : 'run deep scan for sizes'}</div>
        </div>
        <div class="stat-card \${stats.duplicateCount > 0 ? 'warn' : 'success'}">
          <div class="stat-label"><i data-lucide="copy"></i> Duplicates</div>
          <div class="stat-value">\${stats.duplicateCount}</div>
        </div>
        <div class="stat-card \${hasRealSizes && parseFloat(stats.wastedSpace) > 0 ? 'danger' : ''}">
          <div class="stat-label"><i data-lucide="trash-2"></i> Wasted Space</div>
          <div class="stat-value">\${stats.wastedSpace}</div>
          <div class="stat-sub">from duplicate packages</div>
        </div>
      </div>

      <div class="section-header">
        <span class="section-title">Recent Projects</span>
      </div>
      <div class="project-grid">
        \${projects.slice(0, 6).map(p => projectCard(p)).join('')}
      </div>

      \${duplicates.length > 0 ? \`
        <div class="section-header" style="margin-top:24px">
          <span class="section-title">Top Duplicates</span>
          <button class="btn ghost small" onclick="switchTab('duplicates')">View all</button>
        </div>
        \${duplicates.slice(0, 5).map(d => dupRow(d)).join('')}
      \` : ''}
    \`
  }

  function renderProjects(projects) {
    document.getElementById('projects-grid').innerHTML = projects.length
      ? projects.map(p => projectCard(p)).join('')
      : '<div class="empty-state"><i data-lucide="folder-open"></i><h3>No projects</h3><p>Add a folder to get started.</p></div>'
  }

  function filterProjects(q) {
    if (!appData) return
    const filtered = appData.projects.filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    document.getElementById('projects-grid').innerHTML = filtered.map(p => projectCard(p)).join('')
    lucide.createIcons()
  }

  function renderPackages(packages) {
    const sorted = sortedPackages(packages, currentSort)
    document.getElementById('packages-list').innerHTML = sorted.length
      ? sorted.map(p => pkgRow(p, true)).join('')
      : '<div class="empty-state"><i data-lucide="box"></i><h3>No packages</h3><p>Run a scan first.</p></div>'
  }

  function filterPackages(q) {
    if (!appData) return
    const filtered = appData.allPackages.filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    document.getElementById('packages-list').innerHTML = filtered.map(p => pkgRow(p, true)).join('')
    lucide.createIcons()
  }

  function sortPackages(by, el) {
    currentSort = by
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'))
    el.classList.add('active')
    if (appData) {
      const q = document.getElementById('package-search').value
      const filtered = appData.allPackages.filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
      document.getElementById('packages-list').innerHTML = sortedPackages(filtered, by).map(p => pkgRow(p, true)).join('')
      lucide.createIcons()
    }
  }

  function sortedPackages(packages, by) {
    return [...packages].sort((a, b) => {
      if (by === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0)
      if (by === 'projects') return b.projects.length - a.projects.length
      return a.name.localeCompare(b.name)
    })
  }

  function renderDuplicates(duplicates) {
    document.getElementById('duplicates-list').innerHTML = duplicates.length
      ? duplicates.map(d => dupRow(d)).join('')
      : \`<div class="empty-state">
          <i data-lucide="check-circle"></i>
          <h3>No duplicates found</h3>
          <p>All packages are unique across your projects.</p>
        </div>\`
  }

  function projectCard(p) {
    return \`
      <div class="project-card">
        <div class="project-card-header">
          <div class="project-card-title">
            <i data-lucide="folder"></i>
            <span title="\${p.folderPath}">\${p.name}</span>
          </div>
          <div class="project-card-actions">
            <button class="btn ghost small" title="Open project" onclick="send('openProject', { folderPath: '\${p.folderPath}' })">
              <i data-lucide="external-link"></i>
            </button>
            \${p.nodeModulesExists ? \`<button class="btn ghost small" title="Delete node_modules" onclick="send('deleteNodeModules', { folderPath: '\${p.folderPath}', projectName: '\${p.name}' })">
              <i data-lucide="trash-2"></i>
            </button>\` : ''}
          </div>
        </div>
        <div class="project-card-meta">
          <span class="meta-chip \${!p.nodeModulesExists ? 'no-modules' : ''}">
            <i data-lucide="\${p.nodeModulesExists ? 'package' : 'alert-circle'}"></i>
            \${p.nodeModulesExists ? p.packageCount + ' packages' : 'no node_modules'}
          </span>
          \${p.nodeModulesSizeFormatted ? \`<span class="meta-chip"><i data-lucide="hard-drive"></i> \${p.nodeModulesSizeFormatted}</span>\` : ''}
          \${p.lastModified ? \`<span class="meta-chip"><i data-lucide="clock"></i> \${p.lastModified}</span>\` : ''}
        </div>
      </div>
    \`
  }

  function pkgRow(p, showInstall) {
    return \`
      <div class="pkg-row">
        <div class="pkg-row-left">
          <i data-lucide="box"></i>
          <span class="pkg-name" title="\${p.description || p.name}">\${p.name}</span>
          <span class="pkg-version">\${p.version}</span>
        </div>
        <div class="pkg-row-right">
          \${p.sizeFormatted ? \`<span class="pkg-size">\${p.sizeFormatted}</span>\` : ''}
          \${p.projects && p.projects.length > 1 ? \`<span class="pkg-projects">\${p.projects.length} projects</span>\` : ''}
          \${showInstall ? \`
            <button class="btn secondary small" data-pkg="\${p.name}" title="Add to current project" onclick="send('addToProject', { packageName: '\${p.name}', version: '\${p.version}' })">
              <i data-lucide="plus"></i> Add
            </button>
            <button class="btn ghost small" title="View on npm" onclick="send('openNpm', { packageName: '\${p.name}' })">
              <i data-lucide="external-link"></i>
            </button>
          \` : ''}
        </div>
      </div>
    \`
  }

  function dupRow(d) {
    return \`
      <div class="dup-row">
        <div class="dup-left">
          <i data-lucide="alert-triangle"></i>
          <div>
            <div class="dup-name">\${d.name}</div>
            <div class="dup-meta">v\${d.version} · \${d.projectCount} projects: \${d.projects.slice(0,3).join(', ')}\${d.projects.length > 3 ? '...' : ''}</div>
          </div>
        </div>
        <div class="dup-right">
          \${d.wastedFormatted !== '0 B' ? \`<span class="wasted-badge">~\${d.wastedFormatted} wasted</span>\` : ''}
        </div>
      </div>
    \`
  }

  lucide.createIcons()
  function renderOutdated(outdated) {
    const el = document.getElementById('outdated-list')
    if (!outdated || outdated.length === 0) {
      el.innerHTML = \`<div class="empty-state"><i data-lucide="check-circle"></i><h3>All up to date</h3><p>No outdated packages found.</p></div>\`
      return
    }
    el.innerHTML = outdated.map(o => \`
      <div class="dup-row">
        <div class="dup-left">
          <i data-lucide="refresh-cw"></i>
          <div>
            <div class="dup-name">\${o.name}</div>
            <div class="dup-meta">\${o.projectName} · current: \${o.current}</div>
          </div>
        </div>
        <div class="dup-right">
          <span class="wasted-badge" style="background:#22c55e18;color:#22c55e">→ \${o.latest}</span>
        </div>
      </div>
    \`).join('')
  }

  function renderDead(dead) {
    const el = document.getElementById('dead-list')
    if (!dead || dead.length === 0) {
      el.innerHTML = \`<div class="empty-state"><i data-lucide="check-circle"></i><h3>No unused packages</h3><p>All installed packages appear to be used.</p></div>\`
      return
    }
    el.innerHTML = dead.map(d => \`
      <div class="dup-row">
        <div class="dup-left">
          <i data-lucide="package-x"></i>
          <div>
            <div class="dup-name">\${d.name}</div>
            <div class="dup-meta">\${d.projectName} · v\${d.version} · not imported in any source file</div>
          </div>
        </div>
        <div class="dup-right">
          <span class="wasted-badge" style="background:#ef444422;color:#ef4444">unused</span>
        </div>
      </div>
    \`).join('')
  }

  function renderTemplates(templates) {
    const el = document.getElementById('templates-list')
    if (!templates || templates.length === 0) {
      el.innerHTML = \`<div class="empty-state"><i data-lucide="layout-template"></i><h3>No templates saved</h3><p>Right-click a project in the Projects tab and choose Save as Template.</p></div>\`
      return
    }
    el.innerHTML = templates.map(t => \`
      <div class="dup-row">
        <div class="dup-left">
          <i data-lucide="layout-template"></i>
          <div>
            <div class="dup-name">\${t.name}</div>
            <div class="dup-meta">\${t.description ? t.description + ' · ' : ''}\${t.packageCount} packages · \${t.createdAt}</div>
          </div>
        </div>
        <div class="dup-right" style="gap:6px">
          <button class="btn secondary small" onclick="send('applyTemplate')">
            <i data-lucide="download"></i> Apply
          </button>
          <button class="btn ghost small" onclick="send('deleteTemplate', { id: '\${t.id}' })">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    \`).join('')
  }

  function renderTemplateInstaller(template) {
    const el = document.getElementById('templates-list')
    el.innerHTML = \`
      <div style="margin-bottom:16px">
        <div style="font-size:14px;font-weight:600;margin-bottom:4px">Applying: \${template.name}</div>
        <div style="font-size:12px;color:var(--fg2);margin-bottom:16px">\${template.packages.length} packages — click Add on each to install</div>
        <div class="pkg-list">
          \${template.packages.map(p => \`
            <div class="pkg-row">
              <div class="pkg-row-left">
                <i data-lucide="box"></i>
                <span class="pkg-name">\${p.name}</span>
                <span class="pkg-version">\${p.version}</span>
              </div>
              <div class="pkg-row-right">
                <button class="btn secondary small" data-pkg="\${p.name}" onclick="send('installFromTemplate', { packageName: '\${p.name}', version: '\${p.version}' })">
                  <i data-lucide="plus"></i> Add
                </button>
              </div>
            </div>
          \`).join('')}
        </div>
      </div>
    \`
  }

  vscode.postMessage({ command: 'ready' })
</script>
</body>
</html>`
  }

  dispose() {
    PackLensPanel.currentPanel = undefined
    this.panel.dispose()
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
  }
}