// 课件实验室 · Host 半边（8 个学科技能快照 + edulab 原生工具 + 看板数据面）。
// 工具职责：环境自检（python/sympy）/ 技能盘点 / 成品安检 / 课件存证 / 预览服务 / 档案管理。
// 创作本身由 agent 按技能完成（数据岛注入模板或直接创作单文件课件）。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { registerApi } from '../lib/api.js'
import { createSkillProvider } from '../lib/skills.js'
import { createEdulabTool } from '../lib/tools.js'

const PLUGIN_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version } catch { return '?' }
})()

export const name = 'edulab' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'webServer', 'connection']

export const Config = Schema.object({
  previewPort: Schema.number().default(5200).description('本地预览服务端口（挂课件档案静态目录，面板 iframe 预览用）'),
})

export const configRef = { config: null }

export function apply(ctx, config) {
  configRef.config = { ...(config ?? {}), _version: PLUGIN_VERSION }
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]
  const port = configRef.config.previewPort

  ctx.effect(() => ctx.tools.register(createEdulabTool({ port })), `${name}: tool edulab`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  ctx.effect(() => registerApi(ctx, { configRef }), `${name}: routes`)
}
