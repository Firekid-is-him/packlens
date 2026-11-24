import * as vscode from 'vscode'
import { fetchPackageMeta } from './features'
import { parseSpec, isNewer } from './version'
import { escapeMarkdown, npmPackageUrl } from './html'

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
    md.isTrusted = false
    md.supportHtml = false

    md.appendMarkdown(`**${escapeMarkdown(meta.name)}** \`${escapeMarkdown(deps[pkgName])}\``)
    if (isDev) md.appendMarkdown(` — *devDependency*`)
    md.appendMarkdown('\n\n')

    if (isDeprecated) {
      md.appendMarkdown(`**Deprecated:** ${escapeMarkdown(meta.deprecated)}\n\n`)
    }

    if (meta.description) {
      md.appendMarkdown(`${escapeMarkdown(meta.description)}\n\n`)
    }

    const declared = parseSpec(String(deps[pkgName]))
    const outdated = declared !== null && isNewer(meta.version, declared)
    md.appendMarkdown(`Latest: \`${escapeMarkdown(meta.version)}\`${outdated ? ' (update available)' : ''}\n\n`)

    md.appendMarkdown(`[View on npm](${npmPackageUrl(pkgName)})`)

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