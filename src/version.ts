const NON_REGISTRY = /^(workspace:|file:|link:|portal:|patch:|git\+|git:|github:|gitlab:|bitbucket:|https?:|npm:)/i
const SEMVER_PART = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

/*
 * Reduces a dependency spec to a single comparable version.
 * Returns null for anything that is not a registry semver range
 * (workspace:, git, file:, npm: aliases, tags, upper-bound-only ranges).
 */
export function parseSpec(spec: string): string | null {
  const s = (spec || '').trim()
  if (!s || NON_REGISTRY.test(s) || s.includes('/')) return null

  const alternative = s.split('||').pop()!.trim()
  const first = alternative.split(/\s+/)[0]
  if (first.startsWith('<')) return null

  const bare = first.replace(/^[\^~>=v]+/, '')
  const match = bare.match(SEMVER_PART)
  if (!match) return null

  const [, major, minor, patch, pre] = match
  const num = (v?: string) => (v && /^\d+$/.test(v) ? v : '0')
  return `${major}.${num(minor)}.${num(patch)}${pre ?? ''}`
}

export function normalizeVersion(spec: string): string {
  return parseSpec(spec) ?? (spec || '').trim()
}

function split(v: string): { core: number[]; pre: string[] } {
  const [core, ...rest] = v.split('+')[0].split('-')
  return {
    core: core.split('.').map(n => parseInt(n, 10) || 0),
    pre: rest.length ? rest.join('-').split('.') : []
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = split(a)
  const pb = split(b)

  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] || 0) - (pb.core[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1
  if (pb.pre.length === 0) return -1

  const len = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const diff = parseInt(x, 10) - parseInt(y, 10)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x > y ? 1 : -1
    }
  }
  return 0
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}
