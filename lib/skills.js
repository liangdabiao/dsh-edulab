// 课件实验室 · 技能快照提供方（8 个学科技能）+ DSH 环境说明注入（addendum）。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FAMILY_DEPS, skillByName } from './skills-meta.js'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  let description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2') || null
  // YAML 折叠/字面标量（> / >- / | 开头）单行抓不到内容，走多行收集
  if (description && /^[>|][+-]?$/.test(description)) description = null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*[>|]/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  if (!name || !description) return null
  return { name, description, body: text.slice(m[0].length) }
}

function readDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (parsed) out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name })
  }
  return out
}

function addendum(skill) {
  const meta = skillByName(skill.name)
  const deps = meta ? FAMILY_DEPS[meta.family] : ''
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用（课件实验室）',
    '',
    `- 本技能目录：\`${skill.dir}\`。**你的 bash 沙箱读不到插件安装目录**——开工前先把整个技能目录复制到当前工作区：`,
    '  ```bash',
    `  cp -r "${skill.dir}" ./${skill.name}-skill`,
    '  ```',
    `- 之后在工作区副本 \`./${skill.name}-skill/\` 里按 SKILL.md 的流程操作（template/、references/、scripts/、lib/ 都在副本里）。`,
    `- 依赖要求：${deps || '见技能文档'}。**首次使用前先跑 \`edulab\` 工具 action=check** 探测 python3/sympy；Windows 上 python 可能叫 \`python\` 或 \`py -3\`。`,
    '- 成品课件是**自包含单文件 HTML**，写到当前工作区（不要写进技能目录）。完成后走闭环：`edulab` 工具 `validate` 安检（拦占位符残留/坏 JSON 数据岛）→ `save` 存证 → `serve` 启动预览 → 告知用户去侧栏「课件实验室」看板回看。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s) => ({
    name: s.name, description: s.description, path: s.file,
    invocation: INVOCATION, source: 'bundled', provider: 'dsh-edulab', rank: RANK,
    locator: s.dir, resourceBase: { kind: 'directory', path: s.dir },
  })

  return {
    name: 'dsh-edulab',
    async list() { return list.flatMap(readDir).map(candidate) },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, ...summary } = candidate(s)
      return { ...summary, content }
    },
  }
}

export { readDir, addendum }
