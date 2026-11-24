/* eslint-disable @typescript-eslint/no-explicit-any */
const Module = require('module')

export const state: {
  commands: Record<string, (...args: any[]) => any>
  status: { text: string; tooltip?: string; command?: string; show(): void; dispose(): void }
  posted: any[]
  handlers: Array<(msg: any) => any>
  htmls: string[]
  messages: string[]
  config: Record<string, any>
} = {
  commands: {},
  status: { text: '', show() {}, dispose() {} },
  posted: [],
  handlers: [],
  htmls: [],
  messages: [],
  config: {}
}

export function resetState() {
  state.commands = {}
  state.status = { text: '', show() {}, dispose() {} }
  state.posted = []
  state.handlers = []
  state.htmls = []
  state.messages = []
  state.config = {}
}

class EventEmitter {
  event = () => ({ dispose() {} })
  fire() {}
}

class TreeItem {
  contextValue?: string
  description?: string
  tooltip?: string
  iconPath?: unknown
  constructor(public label: string, public collapsibleState: number) {}
}

class ThemeIcon {
  constructor(public id: string) {}
}

class MarkdownString {
  value = ''
  isTrusted = false
  appendMarkdown(v: string) { this.value += v; return this }
  appendText(v: string) { this.value += v; return this }
}

class Hover {
  constructor(public contents: unknown) {}
}

const stub = {
  EventEmitter,
  TreeItem,
  ThemeIcon,
  MarkdownString,
  Hover,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1 },
  ProgressLocation: { Notification: 15 },
  ConfigurationTarget: { Global: 1 },
  Uri: {
    file: (p: string) => ({ fsPath: p }),
    parse: (s: string) => s,
    joinPath: (...a: any[]) => a.join('/')
  },
  commands: {
    registerCommand: (name: string, fn: (...args: any[]) => any) => { state.commands[name] = fn; return { dispose() {} } },
    executeCommand: async (name: string, ...args: any[]) => state.commands[name]?.(...args)
  },
  languages: { registerHoverProvider: () => ({ dispose() {} }) },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key: string, dflt: unknown) => (key in state.config ? state.config[key] : dflt),
      update: async (key: string, value: unknown) => { state.config[key] = value }
    })
  },
  env: { openExternal: async () => true },
  window: {
    activeTextEditor: undefined,
    registerTreeDataProvider: () => ({ dispose() {} }),
    createStatusBarItem: () => state.status,
    createWebviewPanel: () => ({
      webview: {
        set html(v: string) { state.htmls.push(v) },
        get html() { return state.htmls[state.htmls.length - 1] },
        onDidReceiveMessage: (h: (msg: any) => any) => { state.handlers.push(h); return { dispose() {} } },
        postMessage: (m: any) => { state.posted.push(m); return Promise.resolve(true) }
      },
      onDidDispose() {},
      reveal() {},
      dispose() {}
    }),
    withProgress: (_o: unknown, fn: (p: { report(): void }) => Promise<unknown>) => fn({ report() {} }),
    showInformationMessage: (m: string) => { state.messages.push(m); return Promise.resolve(undefined) },
    showWarningMessage: (m: string) => { state.messages.push(m); return Promise.resolve(undefined) },
    showErrorMessage: (m: string) => { state.messages.push('ERR: ' + m); return Promise.resolve(undefined) },
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined
  }
}

const originalLoad = Module._load
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'vscode') return stub
  return originalLoad.call(this, request, ...rest)
}

export default stub
