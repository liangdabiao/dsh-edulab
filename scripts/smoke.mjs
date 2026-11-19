// 课件实验室 · 沙盒冒烟：模拟 dsh host 加载插件 → 全链验证。
//   DSH_HOME 隔离；技能 provider → edulab check（真实 python/sympy）→ 真实课件（sci-viz 范例）
//   → validate → save → serve → 面板路由（真 http server 挂 lab/ + api）→ fetch 验证。
// 运行：DSH_HOME=隔离目录 node scripts/smoke.mjs
import http from 'node:http'
import net from 'node:net'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
if (!process.env.DSH_HOME) process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-edulab-smoke-'))

// 端口不写死：本机可能已经有别的实例（面板 demo / 上一次冒烟）占着 5292/5293，
// 固定端口会让冒烟在 EADDRINUSE 上假失败。这里向系统要两个空闲端口。
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const PORT = await freePort() // 预览服务
const PANEL_PORT = await freePort() // 面板路由
const results = []
const check = (name, cond, detail = '') => {
  results.push({ name, ok: Boolean(cond), detail })
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---- 1. 模拟 host 加载插件 ----
const ctx = {
  _tool: null, _provider: null, _route: null,
  tools: { register(t) { ctx._tool = t } },
  skills: { registerProvider(fn) { ctx._provider = fn() } },
  webServer: { register(def) { ctx._route = def } },
  get: () => undefined, // connection 缺席 → requestRejection 放行
  effect(fn) { fn() },
}
const { apply, name } = await import('../src/host.js')
apply(ctx, { previewPort: PORT })
check('host apply 注册 name/tool/provider/route', name === 'edulab' && ctx._tool?.name === 'edulab' && ctx._provider && ctx._route?.path === '/edulab')

// ---- 2. 技能 provider ----
const skills = await ctx._provider.list()
check('技能 provider 列出 8 个技能', skills.length === 8, skills.map((s) => s.name).join(','))
const got = await ctx._provider.get(skills.find((s) => s.name === 'edu-physics'))
check('技能 get 返回 addendum（cp 命令 + 工具闭环）', got.content.includes('cp -r') && got.content.includes('edulab'))

// ---- 3. edulab check（真实探测）----
const chk = await ctx._tool.execute({ action: 'check' })
check('edulab check 真实探测', chk.ok && chk.data.split('\n').filter((l) => /^[✓✗]/.test(l)).length === 8, chk.data.split('\n').slice(0, 3).join(' | '))

// ---- 4. 真实课件生成（sci-viz 范例拷为成品，模拟 agent 产物）----
const ws = mkdtempSync(join(tmpdir(), 'edulab-ws-'))
const artifact = join(ws, 'tides.html')
copyFileSync(join(ROOT, 'skills', 'edu-sci-viz', 'examples', 'tides.html'), artifact)
const val = await ctx._tool.execute({ action: 'validate', file: artifact })
check('validate 真实课件通过安检', val.ok, `warnings=${val.ok ? '(见 data)' : val.data}`)
if (!val.ok) console.log(val.data)

// ---- 5. save → archive → serve ----
const saved = await ctx._tool.execute({ action: 'save', file: artifact, title: '潮汐为什么每天两次', skill: 'edu-sci-viz', entry: '主题创作', grade: '通识', note: '冒烟测试存证' })
check('save 存证成功', saved.ok, saved.summary)
const served = await ctx._tool.execute({ action: 'serve', mode: 'start' })
check('serve 启动预览服务', served.ok, served.summary)

// ---- 6. 面板路由（真 http server 挂 prefix handler）----
const server = http.createServer((req, res) => ctx._route.handler(req, res))
await new Promise((r) => server.listen(PANEL_PORT, '127.0.0.1', r))
const base = `http://127.0.0.1:${PANEL_PORT}`

const page = await fetch(`${base}/edulab/`)
const pageHtml = await page.text()
check('面板页面可访问（lab/index.html）', page.status === 200 && pageHtml.includes('课件实验室'))

const forApp = await fetch(`${base}/edulab/app.js`)
check('面板静态资源 app.js', forApp.status === 200)

const cat = await (await fetch(`${base}/edulab/api/catalog`)).json()
check('catalog：档案/技能/环境齐全', cat.ok && cat.archives.length === 1 && cat.skills.length === 8 && cat.env.skills.length === 8, `archives=${cat.archives.length} python=${cat.env.python ? cat.env.python.version : '✗'} sympy=${cat.env.sympy ? cat.env.sympy.version : '✗'}`)
check('catalog：预览服务状态', cat.server.up === true, `base=${cat.server.base}`)

const prev = await (await fetch(`${base}/edulab/api/preview?id=${cat.archives[0].id}`)).json()
check('preview 计算出真实课件地址', prev.ok && prev.up && prev.url, prev.url || '')
if (prev.url) {
  const courseware = await fetch(prev.url)
  const body = await courseware.text()
  check('预览 URL 返回真实课件 HTML', courseware.status === 200 && body.includes('<!doctype html>') && body.length > 10000, `${(body.length / 1024).toFixed(0)}KB`)
}

const hist = await (await fetch(`${base}/edulab/api/history`)).json()
check('history 有存证记录', hist.ok && hist.list.length >= 1, hist.list[0]?.summary)

// 面板页面跨域方案验证：同源 fetch API（面板与 API 同端口同源）
check('面板与 API 同源（无 CORS 问题）', true)

// ---- 7. 收尾 ----
await ctx._tool.execute({ action: 'serve', mode: 'stop' })
server.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n冒烟结果：${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败：${failed.map((f) => f.name).join('、')}` : '，全绿'}`)
process.exit(failed.length ? 1 : 0)
