import * as vscode from 'vscode'

export interface Template {
  id: string
  name: string
  description: string
  packages: { name: string; version: string; dev: boolean }[]
  createdAt: string
}

const STORAGE_KEY = 'packlens.templates'

export function getTemplates(context: vscode.ExtensionContext): Template[] {
  return context.globalState.get<Template[]>(STORAGE_KEY, [])
}

export async function saveTemplate(context: vscode.ExtensionContext, template: Template) {
  const templates = getTemplates(context)
  const existing = templates.findIndex(t => t.id === template.id)
  if (existing >= 0) templates[existing] = template
  else templates.push(template)
  await context.globalState.update(STORAGE_KEY, templates)
}

export async function deleteTemplate(context: vscode.ExtensionContext, id: string) {
  const templates = getTemplates(context).filter(t => t.id !== id)
  await context.globalState.update(STORAGE_KEY, templates)
}

export async function createTemplateFromProject(
  context: vscode.ExtensionContext,
  projectName: string,
  packages: { name: string; version: string }[]
) {
  const name = await vscode.window.showInputBox({
    prompt: 'Template name',
    value: projectName,
    placeHolder: 'e.g. React Starter'
  })
  if (!name) return null

  const description = await vscode.window.showInputBox({
    prompt: 'Short description (optional)',
    placeHolder: 'e.g. React + TypeScript + Tailwind'
  })

  const template: Template = {
    id: Date.now().toString(),
    name,
    description: description || '',
    packages: packages.map(p => ({
      name: p.name,
      version: p.version.replace(/[\^~>=<]/, ''),
      dev: false
    })),
    createdAt: new Date().toISOString()
  }

  await saveTemplate(context, template)
  vscode.window.showInformationMessage(`Template "${name}" saved with ${packages.length} packages.`)
  return template
}

export async function applyTemplate(
  context: vscode.ExtensionContext,
  targetProjectPath: string
): Promise<Template | null> {
  const templates = getTemplates(context)

  if (templates.length === 0) {
    vscode.window.showInformationMessage('No templates saved yet. Save one from a project first.')
    return null
  }

  const picked = await vscode.window.showQuickPick(
    templates.map(t => ({
      label: t.name,
      description: t.description,
      detail: `${t.packages.length} packages`,
      template: t
    })),
    { placeHolder: 'Choose a template' }
  )

  if (!picked) return null
  return (picked as any).template
}

export function serializeTemplates(templates: Template[]) {
  return templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    packageCount: t.packages.length,
    packages: t.packages,
    createdAt: new Date(t.createdAt).toLocaleDateString()
  }))
}