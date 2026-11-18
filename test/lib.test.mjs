// 课件实验室 · lib 层单测。
// 运行：npm test（node --test test/）
// 注意：DSH_HOME 必须在 import lib/data.js 之前设置（DATA_DIR 在模块加载时求值）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { Writable, Readable } from 'node:stream'

const TMP = mkdtempSync(join(tmpdir(), 'dsh-edulab-test-'))
process.env.DSH_HOME = join(TMP, 'home')

const { auditHtml, auditFile, PLACEHOLDERS } = await import('../lib/audit.js')
const {
  saveArchive, getArchive, listArchives, deleteArchive, restoreFromHistory,
  listArchiveHistory, clearHistory, stats, archiveDirFor, readArchivedFile, newArchiveId,
} = await import('../lib/data.js')
const { SKILL_META, skillByName, FAMILY_DEPS } = await import('../lib/skills-meta.js')
const { readDir, addendum, createSkillProvider } = await import('../lib/skills.js')
const { createEdulabTool } = await import('../lib/tools.js')
const { startServer, stopServer, serverStatus, previewUrl, serverHealth } = await import('../lib/serve.js')

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(ROOT, 'skills')

// ---- 测试素材 ----------------------------------------------------------------

// 完好课件样本：有数据岛 + 收尾完整 + 只有 CDN 外链
function goodHtml(island = true) {
  const islandHtml = island
    ? `<script id="lesson-data" type="application/json">{"title":"测试课件","steps":[1,2]}</script>`
    : ''
  return `<!doctype html><html><head><title>测试课件</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/kaTeX/0.16.8/katex.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap" rel="stylesheet">
</head><body>${islandHtml}<div>正四棱锥演示</div></body></html>`
}

async function writeTmp(name, content) {
  const dir = join(TMP, 'workspace')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

// mock http res：真 Writable（踩坑经验：mock 要用真流，res.writeHead/end 才有地方落）
function mockRes() {
  const chunks = []
  const res = new Writable({
    write(c, _enc, cb) { chunks.push(c); cb() },
  })
  res.statusCode = 0
  res.headers = {}
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers || {}) }
  res.end = (data) => { if (data) chunks.push(Buffer.from(data)); res.finished = true }
  res.body = () => Buffer.concat(chunks).toString('utf8')
  res.json = () => JSON.parse(res.body() || '{}')
  return res
}

function mockReq({ method = 'GET', url = '/', headers = {} } = {}) {
  return { method, url, headers }
}

// ---- audit -------------------------------------------------------------------

test('audit: 完好课件通过', () => {
  const r = auditHtml(goodHtml())
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.meta.dataIslandsParsed, 1)
  assert.equal(r.meta.title, '测试课件')
})

test('audit: 三种占位符残留全部拦截', () => {
  for (const p of PLACEHOLDERS) {
    const r = auditHtml(goodHtml(false).replace('<div>正四棱锥演示</div>', `<script id="d" type="application/json">${p}</script>`))
    assert.equal(r.ok, false, `${p} 残留应拦截`)
    assert.ok(r.errors.some((e) => e.includes(p)))
  }
})

test('audit: 坏 JSON 数据岛拦截', () => {
  const r = auditHtml(goodHtml().replace('{"title":"测试课件","steps":[1,2]}', '{"title": 没闭合'))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('JSON 数据岛解析失败')))
})

test('audit: 截断文件（缺 </html>）拦截', () => {
  const r = auditHtml(goodHtml().slice(0, goodHtml().length - 20))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('</html>')))
})

test('audit: 空文件拦截', () => {
  const r = auditHtml('   ')
  assert.equal(r.ok, false)
})

test('audit: 域外外链只 warn 不阻塞', () => {
  const r = auditHtml(goodHtml().replace('cdnjs.cloudflare.com/ajax/libs/kaTeX', 'evil.example.com/kaTeX'))
  assert.equal(r.ok, true, '域外外链是 warn 不是 error')
  assert.ok(r.warnings.some((w) => w.includes('CDN')))
})

test('audit: 创作内容零检查（换词不报错）', () => {
  const r = auditHtml(goodHtml().replace('正四棱锥演示', '随便什么内容，风格文字配色都不管'))
  assert.equal(r.ok, true)
})

test('audit: auditFile 读文件', async () => {
  const file = await writeTmp('good.html', goodHtml())
  const r = auditFile(file)
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  const bad = await writeTmp('bad.html', goodHtml(false).replace('<div>', `<script type="application/json">__LESSON_DATA__</script><div>`))
  assert.equal(auditFile(bad).ok, false)
  assert.equal(auditFile(join(TMP, '不存在.html')).ok, false)
})

// ---- data（存证）--------------------------------------------------------------

test('data: saveArchive 创建 + 更新多版本', async () => {
  const file = await writeTmp('cw.html', goodHtml())
  const id = newArchiveId()
  const { archive: a, created } = saveArchive({
    id, title: '二面角经典题', skill: 'edu-solid-geometry', skillTitle: '立体几何解题',
    subject: '数学', grade: '高中', entry: '文字题目', goal: '掌握向量法', htmlPath: file,
    validateOk: true, warnings: 0,
  })
  assert.equal(created, true)
  assert.equal(a.id, id)
  assert.ok(existsSync(join(archiveDirFor(id), 'cw.html')), '成品应复制进档案库')
  const { archive: a2, created: created2 } = saveArchive({
    id, title: '二面角经典题', skill: 'edu-solid-geometry', skillTitle: '立体几何解题',
    htmlPath: file, note: '改了答案卡',
  })
  assert.equal(created2, false)
  assert.equal(a2.revisions.length, 1, '覆盖更新应多一版')
  assert.equal(listArchives().length, 1)
})

test('data: saveArchive 校验必填', async () => {
  assert.throws(() => saveArchive({ title: '', htmlPath: 'x' }), /title/)
  assert.throws(() => saveArchive({ title: 't', htmlPath: join(TMP, '没有.html') }), /不存在/)
})

test('data: delete 留快照 + restore 恢复', async () => {
  const file = await writeTmp('cw2.html', goodHtml())
  const { archive: a } = saveArchive({ title: '待删课件', skill: 'edu-sci-viz', skillTitle: '科普可视化', htmlPath: file })
  const removed = deleteArchive(a.id)
  assert.ok(removed)
  assert.equal(getArchive(a.id), null)
  const events = listArchiveHistory({ kind: 'delete' })
  const restored = restoreFromHistory(events[0].id)
  assert.ok(restored)
  assert.ok(getArchive(a.id))
})

test('data: readArchivedFile 白名单', async () => {
  const a = listArchives()[0]
  assert.ok(readArchivedFile(a, a.file)?.includes('<!doctype html>'))
  assert.equal(readArchivedFile(a, '../../etc/passwd'), null)
  assert.equal(readArchivedFile(a, '别的文件.html'), null)
})

test('data: stats 统计', () => {
  const s = stats()
  assert.ok(s.archives >= 2)
  assert.ok(s.subjects.数学 >= 1)
  assert.ok(s.events >= 3)
})

test('data: history 关键词过滤', () => {
  const events = listArchiveHistory({ q: '二面角' })
  assert.ok(events.length >= 1)
  assert.ok(events.every((e) => `${e.title}${e.summary}`.includes('二面角') || e.archiveId))
})

// ---- skills-meta / skills（真实技能目录）--------------------------------------

test('skills-meta: 8 个技能元数据完整', () => {
  assert.equal(SKILL_META.length, 8)
  for (const s of SKILL_META) {
    assert.ok(s.name && s.title && s.subject && s.deps && s.summary && s.triggers, `${s.name} 元数据缺失`)
    assert.ok(FAMILY_DEPS[s.family], `${s.name} family 非法`)
    if (s.family !== 'sciviz') assert.ok(s.placeholder, `${s.name} 应有占位符`)
  }
  assert.ok(skillByName('edu-solid-geometry'))
  assert.equal(skillByName('没有这个'), undefined)
})

test('skills: 真实技能目录 8 个 SKILL.md 可解析', () => {
  const skills = readDir(SKILLS_DIR)
  assert.equal(skills.length, 8, `应解析出 8 个技能，实际 ${skills.length}`)
  for (const s of skills) {
    assert.ok(s.description.length > 20, `${s.name} description 太短`)
    assert.ok(s.body.length > 1000, `${s.name} 正文太短`)
  }
})

test('skills: addendum 注入 DSH 环境说明', () => {
  const [s] = readDir(SKILLS_DIR)
  const add = addendum(s)
  assert.ok(add.includes('cp -r'), '应有 cp 命令')
  assert.ok(add.includes('edulab'), '应提到工具闭环')
  assert.ok(add.includes('validate'))
})

test('skills: provider list/get', async () => {
  const provider = createSkillProvider([SKILLS_DIR])
  const list = await provider.list()
  assert.equal(list.length, 8)
  assert.equal(provider.name, 'dsh-edulab')
  const got = await provider.get(list[0])
  assert.ok(got.content.includes('## 在 DSH 插件里使用'))
  assert.equal(await provider.get({ locator: '/没有', name: 'x' }), undefined)
})

// ---- tools（edulab 工具）------------------------------------------------------

function fakeCtx() { return {} }

test('tools: list 盘点 8 技能', async () => {
  const tool = createEdulabTool({ port: 5299 })
  assert.equal(tool.name, 'edulab')
  const out = await tool.execute({ action: 'list' })
  assert.equal(out.ok, true)
  assert.ok(out.data.includes('edu-solid-geometry'))
  assert.ok(out.data.includes('edu-sci-viz'))
})

test('tools: check 返回环境矩阵（真实探测，只断言结构）', async () => {
  const tool = createEdulabTool({})
  const out = await tool.execute({ action: 'check' })
  assert.equal(out.ok, true)
  // 技能矩阵 8 行、可用性为布尔
  const rows = out.data.split('\n').filter((l) => l.startsWith('✓') || l.startsWith('✗'))
  assert.equal(rows.length, 8)
  // 真实环境里 python 可用与否都应给出明确行
  assert.ok(out.data.includes('Python：'))
})

test('tools: validate 拦占位符残留', async () => {
  const tool = createEdulabTool({})
  const bad = await writeTmp('bad2.html', goodHtml(false).replace('<div>', `<script type="application/json">__REACTION_DATA__</script><div>`))
  const out = await tool.execute({ action: 'validate', file: bad })
  assert.equal(out.ok, false)
  assert.ok(out.data.includes('__REACTION_DATA__'))
  const good = await writeTmp('good2.html', goodHtml())
  const out2 = await tool.execute({ action: 'validate', file: good })
  assert.equal(out2.ok, true)
})

test('tools: validate/save 参数校验', async () => {
  const tool = createEdulabTool({})
  await assert.rejects(() => tool.execute({ action: 'validate' }), /file/)
  await assert.rejects(() => tool.execute({ action: 'save', file: 'x' }), /title/)
  const out = await tool.execute({ action: 'save', file: 'x', title: 't', skill: '不存在的技能' })
  assert.equal(out.ok, false)
})

test('tools: save 安检拦截坏课件（不让静默入库）', async () => {
  const before = listArchives().length
  const tool = createEdulabTool({})
  const bad = await writeTmp('bad3.html', goodHtml(false).replace('<div>', `<script type="application/json">__TUTORIAL_DATA__</script><div>`))
  const out = await tool.execute({ action: 'save', file: bad, title: '坏课件', skill: 'edu-chem-tutorial' })
  assert.equal(out.ok, false)
  assert.ok(out.summary.includes('没通过安检'))
  assert.equal(listArchives().length, before, '坏课件不应入库')
})

test('tools: save → archive → get-archive → delete → restore 全链', async () => {
  const tool = createEdulabTool({})
  const good = await writeTmp('good3.html', goodHtml())
  const out = await tool.execute({ action: 'save', file: good, title: '全链课件', skill: 'edu-physics', entry: '随机出题' })
  assert.equal(out.ok, true, out.summary)
  const id = listArchives()[0].id
  const got = await tool.execute({ action: 'get-archive', id })
  assert.equal(got.ok, true)
  const listed = await tool.execute({ action: 'archive' })
  assert.ok(listed.data.includes('全链课件'))
  const del = await tool.execute({ action: 'delete', id })
  assert.equal(del.ok, false, '没 confirm 应拒绝')
  const del2 = await tool.execute({ action: 'delete', id, confirm: 'yes' })
  assert.equal(del2.ok, true)
  const hist = await tool.execute({ action: 'history', kind: 'delete' })
  const eventId = hist.data.match(/event=(\S+)/)?.[1]
  const restored = await tool.execute({ action: 'restore', eventId })
  assert.equal(restored.ok, true)
})

test('tools: 未知参数拒绝', async () => {
  const tool = createEdulabTool({})
  await assert.rejects(() => tool.execute({ action: 'list', hack: 1 }), /未知参数/)
})

// ---- serve（预览服务）----------------------------------------------------------

test('serve: start/status/stop + 路径穿越拒绝', async () => {
  const PORT = 5296
  const started = await startServer(PORT)
  assert.equal(started.ok, true)
  const st = serverStatus()
  assert.equal(st.up, true)
  assert.equal(st.port, PORT)
  // health 探测
  const health = await serverHealth(PORT)
  assert.equal(health.up, true)
  // 预览一个真实存证课件
  const a = listArchives()[0]
  const url = previewUrl(PORT, a.id)
  assert.ok(url.includes(`/courseware/${a.id}/`))
  const res = await fetch(url)
  assert.equal(res.status, 200)
  const body = await res.text()
  assert.ok(body.includes('<!doctype html>'))
  // 路径穿越 404
  const bad = await fetch(`http://127.0.0.1:${PORT}/courseware/..%2f..%2farchives.json`)
  assert.equal(bad.status, 404)
  const bad2 = await fetch(`http://127.0.0.1:${PORT}/courseware/不存在.html`)
  assert.equal(bad2.status, 404)
  // 索引页
  const index = await fetch(`http://127.0.0.1:${PORT}/`)
  assert.ok((await index.text()).includes('课件实验室'))
  const stopped = await stopServer()
  assert.equal(stopped.ok, true)
  assert.equal(serverStatus().up, false)
})

// ---- api（面板路由）------------------------------------------------------------

test('api: registerApi 路由 ping/catalog/archive/history/remove', async () => {
  const { registerApi } = await import('../lib/api.js')
  const registered = []
  const ctx = {
    get: () => undefined, // connection 服务缺席 → requestRejection 放行（fail-closed 会 403 全部 API）
    webServer: { register: (def) => { registered.push(def); return def } },
  }
  const configRef = { config: { previewPort: 5297, _version: 'test' } }
  registerApi(ctx, { configRef })
  assert.equal(registered.length, 1)
  const route = registered[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/edulab')

  const ping = mockRes()
  await route.handler(mockReq({ url: '/edulab/api/ping' }), ping)
  assert.equal(ping.statusCode, 200)
  assert.equal(ping.json().ok, true)

  const notFound = mockRes()
  await route.handler(mockReq({ url: '/edulab/api/没有' }), notFound)
  assert.equal(notFound.statusCode, 404)

  const catalog = mockRes()
  await route.handler(mockReq({ url: '/edulab/api/catalog' }), catalog)
  assert.equal(catalog.statusCode, 200)
  const cat = catalog.json()
  assert.equal(cat.ok, true)
  assert.equal(cat.skills.length, 8)
  assert.ok(cat.env.skills.length === 8)
  assert.ok(Array.isArray(cat.archives))

  const a = listArchives()[0]
  const archive = mockRes()
  await route.handler(mockReq({ url: `/edulab/api/archive?id=${a.id}` }), archive)
  assert.equal(archive.statusCode, 200)
  assert.equal(archive.json().archive.title, a.title)

  const archive404 = mockRes()
  await route.handler(mockReq({ url: '/edulab/api/archive?id=没有' }), archive404)
  assert.equal(archive404.statusCode, 404)

  const source = mockRes()
  await route.handler(mockReq({ url: `/edulab/api/archive/source?id=${a.id}` }), source)
  assert.equal(source.statusCode, 200)
  assert.ok(source.json().body.includes('<!doctype html>'))

  const history = mockRes()
  await route.handler(mockReq({ url: '/edulab/api/history?kind=delete' }), history)
  assert.equal(history.json().ok, true)

  // POST JSON：remove（带 body 的流）
  const postReq = Object.assign(Readable.from([JSON.stringify({ id: a.id })]), {
    method: 'POST', url: '/edulab/api/archive/remove', headers: { 'content-type': 'application/json', host: 'x' },
  })
  const remove2 = mockRes()
  await route.handler(postReq, remove2)
  assert.equal(remove2.statusCode, 200)
  assert.equal(remove2.json().ok, true)
  assert.equal(getArchive(a.id), null)

  const preview404 = mockRes()
  await route.handler(mockReq({ url: `/edulab/api/preview?id=${a.id}` }), preview404)
  assert.equal(preview404.statusCode, 404)
})

// ---- 清场 ----------------------------------------------------------------------

after(() => {
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /* */ }
})
