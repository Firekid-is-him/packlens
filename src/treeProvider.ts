import * as vscode from 'vscode'
import * as path from 'path'
import { ProjectInfo, PackageInfo, ScanResult, formatBytes } from './scanner'

export type TreeItemKind =
  | 'watchedFolder'
  | 'project'
  | 'packageGroup'
  | 'package'
  | 'duplicatePackage'
  | 'duplicateVersion'
  | 'statItem'
  | 'empty'

export class PackLensTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: TreeItemKind,
    public readonly data?: any
  ) {
    super(label, collapsibleState)
    this.contextValue = kind
    this.applyIcon()
  }

  private applyIcon() {
    switch (this.kind) {
      case 'watchedFolder':
        this.iconPath = new vscode.ThemeIcon('root-folder')
        break
      case 'project':
        this.iconPath = new vscode.ThemeIcon('package')
        break
      case 'packageGroup':
        this.iconPath = new vscode.ThemeIcon('list-tree')
        break
      case 'package':
        this.iconPath = new vscode.ThemeIcon('library')
        break
      case 'duplicatePackage':
        this.iconPath = new vscode.ThemeIcon('warning')
        break
      case 'duplicateVersion':
        this.iconPath = new vscode.ThemeIcon('versions')
        break
      case 'statItem':
        this.iconPath = new vscode.ThemeIcon('graph')
        break
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('info')
        break
    }
  }
}

export class ProjectsProvider implements vscode.TreeDataProvider<PackLensTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PackLensTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private scanResult: ScanResult | null = null
  private loading = false

  setScanResult(result: ScanResult) {
    this.scanResult = result
    this.refresh()
  }

  setLoading(val: boolean) {
    this.loading = val
    this.refresh()
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: PackLensTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: PackLensTreeItem): PackLensTreeItem[] {
    if (this.loading) {
      return [new PackLensTreeItem('Scanning...', vscode.TreeItemCollapsibleState.None, 'empty')]
    }

    if (!this.scanResult) {
      return [new PackLensTreeItem('Add a folder to get started', vscode.TreeItemCollapsibleState.None, 'empty')]
    }

    if (!element) {
      if (this.scanResult.projects.length === 0) {
        return [new PackLensTreeItem('No projects found', vscode.TreeItemCollapsibleState.None, 'empty')]
      }
      return this.scanResult.projects.map(p => {
        const sizeLabel = p.nodeModulesSize ? ` — ${formatBytes(p.nodeModulesSize)}` : ''
        const item = new PackLensTreeItem(
          `${p.name}${sizeLabel}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          'project',
          p
        )
        item.description = p.nodeModulesExists ? `${p.packageCount} packages` : 'no node_modules'
        item.tooltip = p.folderPath
        return item
      })
    }

    if (element.kind === 'project') {
      const project = element.data as ProjectInfo
      if (!project.packages || project.packages.length === 0) {
        return [new PackLensTreeItem('No packages found', vscode.TreeItemCollapsibleState.None, 'empty')]
      }
      return project.packages.map(pkg => {
        const sizeLabel = pkg.sizeBytes ? ` — ${formatBytes(pkg.sizeBytes)}` : ''
        const item = new PackLensTreeItem(
          `${pkg.name}${sizeLabel}`,
          vscode.TreeItemCollapsibleState.None,
          'package',
          { pkg, project }
        )
        item.description = pkg.version
        item.tooltip = pkg.description || pkg.name
        return item
      })
    }

    return []
  }
}

export class DuplicatesProvider implements vscode.TreeDataProvider<PackLensTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PackLensTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private scanResult: ScanResult | null = null

  setScanResult(result: ScanResult) {
    this.scanResult = result
    this.refresh()
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: PackLensTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: PackLensTreeItem): PackLensTreeItem[] {
    if (!this.scanResult || this.scanResult.duplicates.size === 0) {
      return [new PackLensTreeItem('No duplicates found', vscode.TreeItemCollapsibleState.None, 'empty')]
    }

    if (!element) {
      const items: PackLensTreeItem[] = []
      for (const [pkgName, versions] of this.scanResult.duplicates.entries()) {
        const totalWasted = versions.reduce((acc, v) => {
          const perExtra = v.totalSize / v.projects.length
          return acc + perExtra * (v.projects.length - 1)
        }, 0)
        const item = new PackLensTreeItem(
          pkgName,
          vscode.TreeItemCollapsibleState.Collapsed,
          'duplicatePackage',
          { pkgName, versions }
        )
        item.description = `${versions.reduce((a, v) => a + v.projects.length, 0)} projects — wasting ${formatBytes(totalWasted)}`
        return [...items, item]
      }
      return items
    }

    if (element.kind === 'duplicatePackage') {
      const { versions } = element.data as { pkgName: string; versions: { version: string; projects: string[]; totalSize: number }[] }
      return versions.map(v => {
        const item = new PackLensTreeItem(
          `v${v.version}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          'duplicateVersion',
          v
        )
        item.description = `${v.projects.length} projects — ${formatBytes(v.totalSize)}`
        return item
      })
    }

    if (element.kind === 'duplicateVersion') {
      const { projects } = element.data as { projects: string[] }
      return projects.map(p => {
        const item = new PackLensTreeItem(p, vscode.TreeItemCollapsibleState.None, 'project')
        item.iconPath = new vscode.ThemeIcon('folder')
        return item
      })
    }

    return []
  }
}

export class StatsProvider implements vscode.TreeDataProvider<PackLensTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PackLensTreeItem | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private scanResult: ScanResult | null = null

  setScanResult(result: ScanResult) {
    this.scanResult = result
    this.refresh()
  }

  refresh() {
    this._onDidChangeTreeData.fire()
  }

  getTreeItem(element: PackLensTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): PackLensTreeItem[] {
    if (!this.scanResult) {
      return [new PackLensTreeItem('Run a scan to see stats', vscode.TreeItemCollapsibleState.None, 'empty')]
    }

    const { projects, totalSize, duplicates } = this.scanResult
    const totalPackages = projects.reduce((a, p) => a + p.packageCount, 0)
    const totalWasted = Array.from(duplicates.values()).reduce((acc, versions) => {
      return acc + versions.reduce((a, v) => {
        const perExtra = v.totalSize / v.projects.length
        return a + perExtra * (v.projects.length - 1)
      }, 0)
    }, 0)

    const make = (label: string, value: string): PackLensTreeItem => {
      const item = new PackLensTreeItem(label, vscode.TreeItemCollapsibleState.None, 'statItem')
      item.description = value
      return item
    }

    return [
      make('Total projects', `${projects.length}`),
      make('Total packages', `${totalPackages}`),
      make('Total size', formatBytes(totalSize)),
      make('Duplicate packages', `${duplicates.size}`),
      make('Wasted space', formatBytes(totalWasted))
    ]
  }
}