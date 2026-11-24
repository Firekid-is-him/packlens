const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;'
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'`]/g, ch => ESCAPES[ch])
}

export function npmPackageUrl(name: string): string {
  return 'https://npmjs.com/package/' + String(name).split('/').map(encodeURIComponent).join('/')
}

export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}
