// 课件实验室面板 · 常驻演示服务（稳定目录，数据不丢）。
// 用法：node scripts/panel-demo.mjs [port]   默认 5293。
// DSH_HOME 固定在 %TEMP%/dsh-edulab-demo，重启服务档案还在；空目录时自动预置 2 份范例课件。
import http from 'node:http'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.argv[2]) || 5293
process.env.DSH_HOME = join(tmpdir(), 'dsh-edulab-demo')
mkdirSync(process.env.DSH_HOME, { recursive: true })

const { apply } = await import('file:///D:/dsh-research/dsh-edulab/src/host.js')
const ctx = { _tool: null, _route: null,
  tools: { register(t) { ctx._tool = t } },
  skills: { registerProvider() {} },
  webServer: { register(def) { ctx._route = def } },
  get: () => undefined, effect(fn) { fn() } }
apply(ctx, { previewPort: 5291 })

// 首次运行预置两份真实范例课件（来自 sci-viz 已验证成品）
if (!existsSync(join(process.env.DSH_HOME, 'tides.html'))) {
  const example = join(ROOT, 'skills', 'edu-sci-viz', 'examples', 'tides.html')
  copyFileSync(example, join(process.env.DSH_HOME, 'tides.html'))
  copyFileSync(example, join(process.env.DSH_HOME, 'moon.html'))
  await ctx._tool.execute({ action: 'save', file: join(process.env.DSH_HOME, 'tides.html'), title: '潮汐为什么每天两次', skill: 'edu-sci-viz', entry: '主题创作', grade: '通识', note: '范例课件' })
  await ctx._tool.execute({ action: 'save', file: join(process.env.DSH_HOME, 'moon.html'), title: '月相变化的全周期演示', skill: 'edu-sci-viz', subject: '科普', grade: '通识', entry: '主题创作', note: '范例课件' })
}
await ctx._tool.execute({ action: 'serve', mode: 'start' })

const server = http.createServer((req, res) => ctx._route.handler(req, res))
server.listen(PORT, '127.0.0.1', () => console.log(`panel ready at http://127.0.0.1:${PORT}/edulab/  (DSH_HOME=${process.env.DSH_HOME})`))
setInterval(() => {}, 10000)
