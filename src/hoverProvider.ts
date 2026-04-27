import * as vscode from 'vscode'
import { fetchPackageMeta } from './features'

const cache = new Map<string, { data: any; time: number }>()
const CACHE_TTL = 5 * 60 * 1000

export class PackageJsonHoverProvider implements vscode.HoverProvider {
  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
    const fileName = document.fileName.replace(/\\/g, '/')
    if (!fileName.endsWith('/package.json')) return null

    let parsed: any
    try {
      parsed = JSON.parse(document.getText())
    } catch {
      return null
    }

    const deps = { ...parsed.dependencies, ...parsed.devDependencies }
    if (Object.keys(deps).length === 0) return null

    const line = document.lineAt(position.line).text
    const match = line.match(/"(@?[a-zA-Z0-9][\w\-./@]*)"\s*:\s*"([^"]+)"/)
    if (!match) return null

    const pkgName = match[1]
    if (!deps[pkgName]) return null

    const wordRange = document.getWordRangeAtPosition(position, /"(@?[a-zA-Z0-9][\w\-./@]*)"\s*:\s*"[^"]+"/)
    if (!wordRange) return null

    const meta = await this.getMeta(pkgName)
    if (!meta) return null

    const isDev = !!parsed.devDependencies?.[pkgName]
    const isDeprecated = !!meta.deprecated

    const md = new vscode.MarkdownString('', true)
    md.isTrusted = true
    md.supportHtml = false

    md.appendMarkdown(`**${meta.name}** \`${meta.version}\``)
    if (isDev) md.appendMarkdown(` — *devDependency*`)
    md.appendMarkdown('\n\n')

    if (isDeprecated) {
      md.appendMarkdown(`⚠️ **Deprecated:** ${meta.deprecated}\n\n`)
    }

    if (meta.description) {
      md.appendMarkdown(`${meta.description}\n\n`)
    }

    if (meta.latestVersion && meta.latestVersion !== meta.version) {
      md.appendMarkdown(`📦 Latest: \`${meta.latestVersion}\`\n\n`)
    }

    if (meta.publishedAt) {
      const date = new Date(meta.publishedAt).toLocaleDateString()
      md.appendMarkdown(`🕐 Published: ${date}\n\n`)
    }

    if (meta.homepage) {
      md.appendMarkdown(`[View on npm](https://npmjs.com/package/${pkgName})`)
    } else {
      md.appendMarkdown(`[View on npm](https://npmjs.com/package/${pkgName})`)
    }

    return new vscode.Hover(md, wordRange)
  }

  private async getMeta(pkgName: string): Promise<any | null> {
    const cached = cache.get(pkgName)
    if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data

    try {
      const meta = await fetchPackageMeta(pkgName)
      if (meta) {
        cache.set(pkgName, { data: meta, time: Date.now() })
        return meta
      }
    } catch {}

    return null
  }
}