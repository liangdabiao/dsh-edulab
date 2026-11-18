// 课件实验室 · 环境探测：python3 / sympy 可用性（check 动作与面板 catalog 共用）。
// Windows 上 python 可能叫 python3 / python / py -3，依次探测；execFile 固定参数防注入。
import { execFile } from 'node:child_process'
import { FAMILY_DEPS, SKILL_META } from './skills-meta.js'

const PY_CANDIDATES = process.platform === 'win32' ? ['python3', 'python', 'py'] : ['python3', 'python']

function run(cmd, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
      if (err) resolve({ ok: false, out: String(stdout || err.message || '') })
      else resolve({ ok: true, out: String(stdout).trim() })
    })
    child.on('error', () => resolve({ ok: false, out: '' }))
  })
}

// 探测一个可用的 Python 解释器（带版本号）
export async function detectPython() {
  for (const cmd of PY_CANDIDATES) {
    // py launcher 需要 -3 选 Python3；其余直接跑
    const args = cmd === 'py' ? ['-3', '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'] : ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])']
    const r = await run(cmd, args)
    if (r.ok && /^\d+\.\d+/.test(r.out)) return { cmd: cmd === 'py' ? `${cmd} -3` : cmd, spawnCmd: cmd, spawnArgsPrefix: cmd === 'py' ? ['-3'] : [], version: r.out, ok: true }
  }
  return { ok: false, cmd: null, version: null }
}

// 用已探测到的解释器 import sympy
export async function detectSympy(python) {
  if (!python?.ok) return { ok: false, version: null }
  const r = await run(python.spawnCmd, [...python.spawnArgsPrefix, '-c', 'import sympy; print(sympy.__version__)'])
  return r.ok && r.out ? { ok: true, version: r.out } : { ok: false, version: null }
}

// 全量探测：node / python / sympy + 每个技能可用性矩阵
export async function probeEnv({ nodeVersion } = {}) {
  const python = await detectPython()
  const sympy = await detectSympy(python)
  const skills = SKILL_META.map((s) => ({
    name: s.name,
    title: s.title,
    family: s.family,
    deps: s.deps,
    depsLabel: FAMILY_DEPS[s.family],
    available:
      s.family === 'sciviz' ? true :
      s.family === 'tutorial' ? python.ok :
      python.ok && sympy.ok,
  }))
  return {
    node: { version: nodeVersion || process.version, ok: true },
    python,
    sympy,
    skills,
    allGood: skills.every((s) => s.available),
  }
}
