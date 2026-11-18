// 课件实验室 · 面板前端。hash 路由视图：概览 / 发起制作 / 课件档案 / 预览 / 历史。
// 数据一律走 /edulab/api/*；「发起制作」postMessage 给宿主 client.js 开新对话。
const $ = (sel) => document.querySelector(sel)
const app = $('#app')

let catalog = null // /api/catalog 缓存
let startDraft = { skill: '', topic: '' }

async function api(path, opts) {
  let res
  try {
    res = await fetch(`/edulab${path}`, opts)
  } catch {
    // 网络层失败（服务不在/连接拒绝）：fetch 抛 TypeError，给一句人话
    throw new Error('面板服务没在跑——数据接口连不上，重启 dsh 或插件预览服务后重试')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function toast(msg, ms = 2600) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('show'), ms)
}

const fmtTime = (iso) => (iso ? String(iso).slice(5, 16).replace('T', ' ') : '—')
const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round((n || 0) / 1024))}KB`)

async function loadCatalog(force = false) {
  if (!catalog || force) catalog = await api('/api/catalog')
  return catalog
}

function renderRailFoot() {
  if (!catalog) return
  const s = catalog.stats || {}
  const env = catalog.env || {}
  $('#rail-foot').innerHTML = `
    <div class="v-head">课件实验室 v${esc(catalog.version || '?')}</div>
    <div class="v-row"><span>课件</span><span>${s.archives || 0}</span></div>
    <div class="v-row"><span>Python</span><span>${env.python ? esc(env.python.version) : '✗'}</span></div>
    <div class="v-row"><span>sympy</span><span>${env.sympy ? esc(env.sympy.version) : '✗'}</span></div>
    <div class="v-row"><span>预览</span><span>${catalog.server?.up ? `:${catalog.server.port}` : '停'}</span></div>`
}

function setNav(view) {
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view))
}

// ---------- 概览 ----------
async function viewHome() {
  setNav('home')
  const c = await loadCatalog(true)
  renderRailFoot()
  const s = c.stats || {}
  const skillsOk = (c.env?.skills || []).filter((x) => x.available).length
  const skillsTotal = (c.env?.skills || []).length
  app.innerHTML = `
    <div class="page-head">
      <div class="page-title">课件实验室</div>
      <div class="page-sub">学科题目 → 单文件交互课件（Three.js / Canvas / KaTeX）</div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="k">课件档案</div><div class="v">${s.archives || 0}<small> 份</small></div></div>
      <div class="stat amber"><div class="k">安检通过</div><div class="v">${s.validateOk || 0}<small> / ${s.archives || 0}</small></div></div>
      <div class="stat"><div class="k">可用技能</div><div class="v">${skillsOk}<small> / ${skillsTotal}</small></div></div>
      <div class="stat"><div class="k">最近动态</div><div class="v" style="font-size:15px;line-height:1.5">${s.lastEventAt ? fmtTime(s.lastEventAt) : '—'}</div></div>
    </div>
    <div style="display:flex;gap:var(--sp-3);margin-bottom:var(--sp-4)">
      <a class="btn primary" href="#/start">✦ 发起制作</a>
      ${c.server?.up ? '' : `<button class="btn ghost" id="btn-serve">启动预览服务</button>`}
    </div>
    <div class="section-title">学科技能（${skillsTotal}）</div>
    <div class="skills-grid">
      ${(c.env?.skills || []).map((sk) => {
        const meta = (c.skills || []).find((m) => m.name === sk.name) || {}
        return `
        <div class="skill-card">
          <div class="head"><span class="name">${esc(meta.title || sk.name)}</span><span class="tag ${sk.available ? 'ok' : 'warn'}">${sk.available ? '可用' : '缺依赖'}</span></div>
          <div class="meta"><span class="tag">${esc(meta.subject || '')}</span><span class="tag">${esc(sk.deps)}</span></div>
          <div class="desc">${esc(meta.summary || '')}</div>
          <div class="triggers">触发词：${esc(meta.triggers || '—')}</div>
          <div class="foot"><a class="btn small primary" href="#/start?skill=${encodeURIComponent(sk.name)}">发起制作</a><span class="mono" style="color:var(--text-helper)">${esc(sk.name)}</span></div>
        </div>`
      }).join('')}
    </div>
    <div class="section-title">最近动态</div>
    ${histList((c.history || []).slice(0, 6))}
    <div style="margin-top:var(--sp-4)"><a class="btn ghost small" href="#/history">查看全部 →</a></div>`
  const serveBtn = $('#btn-serve')
  if (serveBtn) serveBtn.onclick = () => startServe()
}

function histList(events) {
  if (!events.length) return `<div class="empty">还没有动态。发起制作 → 生成课件 → save 存证后，这里会留记录。</div>`
  return `<div>${events.map((e) => `
    <div class="hist-item">
      <span class="at">${esc(fmtTime(e.at))}</span>
      <span class="kind ${esc(e.kind)}">${esc(catalog?.kinds?.[e.kind] || e.kind)}</span>
      <span class="sum">${esc(e.title)}｜${esc(e.summary || '')}</span>
    </div>`).join('')}</div>`
}

async function startServe() {
  try {
    await api('/api/serve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    toast('预览服务已启动')
    await loadCatalog(true)
    render(viewNow())
  } catch (err) { toast(`预览服务没起来：${err.message}`) }
}

// ---------- 发起制作 ----------
async function viewStart(params) {
  setNav('start')
  const c = await loadCatalog()
  renderRailFoot()
  if (params.get('skill')) startDraft.skill = params.get('skill')
  if (!startDraft.skill && (c.skills || [])[0]) startDraft.skill = c.skills[0].name
  const skillNames = (c.skills || []).map((m) => m.name)
  if (startDraft.skill && !skillNames.includes(startDraft.skill)) startDraft.skill = skillNames[0] || ''
  app.innerHTML = `
    <div class="page-head">
      <div class="page-title">发起制作</div>
      <div class="page-sub">选学科 → 给主题 → 开新对话生成课件</div>
    </div>
    <div class="form">
      <div class="field">
        <label>学科</label>
        <select id="f-skill">
          ${(c.skills || []).map((m) => `<option value="${esc(m.name)}" ${m.name === startDraft.skill ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}
        </select>
        <div class="form-note" id="skill-note" style="margin-top:var(--sp-2)"></div>
      </div>
      <div class="field">
        <label>主题 / 题目</label>
        <textarea id="f-topic" placeholder="例：正四棱锥 P-ABCD 中，PA=2，其余棱长均为 √2，求二面角 A-PB-C 的余弦值&#10;或：日食为什么总是发生在农历初一？">${esc(startDraft.topic)}</textarea>
      </div>
      <div style="display:flex;gap:var(--sp-3);align-items:center">
        <button class="btn primary" id="btn-launch">✦ 开新对话制作课件</button>
        <div class="form-note" style="margin:0">主题留空 = 让 agent 自己出典型题。依赖不足时它会先自检并告诉你怎么装。</div>
      </div>
    </div>`

  const skillNote = () => {
    const sk = (c.env?.skills || []).find((x) => x.name === $('#f-skill').value)
    const meta = (c.skills || []).find((m) => m.name === $('#f-skill').value)
    $('#skill-note').innerHTML = `${sk && !sk.available ? `<span class="tag warn">缺依赖：${esc(sk.deps)}</span> ` : ''}${esc(meta?.summary || '')}`
  }
  skillNote()
  $('#f-skill').onchange = (e) => { startDraft.skill = e.target.value; skillNote() }
  $('#f-topic').oninput = (e) => { startDraft.topic = e.target.value }
  $('#btn-launch').onclick = () => {
    startDraft.topic = $('#f-topic').value
    const prompt = buildPrompt()
    if (!prompt) return toast('先选学科')
    parent.postMessage({ type: 'edulab:start', prompt }, location.origin)
  }
  // 幂等注册：viewStart 每次进入都会执行，重复 add 会叠加监听器
  removeEventListener('message', onLaunchAck)
  addEventListener('message', onLaunchAck)
}

function buildPrompt() {
  const c = catalog
  const meta = (c.skills || []).find((m) => m.name === startDraft.skill)
  if (!meta) return ''
  const topic = String(startDraft.topic || '').trim()
  return [
    `请用「${meta.title}」技能（${meta.name}）制作一份交互课件。`,
    topic ? `\n主题/题目：\n${topic}` : '\n主题：请出一道该技能最典型的题目（中档偏上难度，过程有教学价值）。',
    '\n按技能 SKILL.md 流程生成单文件 HTML 到当前工作区；完成后依次跑 edulab validate → save → serve start，然后告诉我去侧栏「课件实验室」面板回看。',
  ].join('\n')
}

function onLaunchAck(e) {
  if (e.origin !== location.origin) return
  if (e.data?.type === 'edulab:start-ok') toast('已开新对话，指令已填入，回车发送即可')
  else if (e.data?.type === 'edulab:start-failed') toast(`发起失败：${e.data.message || '未知错误'}`)
}

// ---------- 档案 ----------
async function viewArchives() {
  setNav('archives')
  const c = await loadCatalog(true)
  renderRailFoot()
  const archives = c.archives || []
  $('#nav-archives-count').textContent = archives.length || ''
  app.innerHTML = `
    <div class="page-head">
      <div class="page-title">课件档案</div>
      <div class="page-sub">${archives.length} 份 · 存证于 ~/.dsh/dsh-edulab/courseware/</div>
      <div class="spacer"></div>
      ${c.server?.up ? `<a class="btn ghost small" href="${esc(c.server.base)}/" target="_blank" rel="noopener">存证索引页 ↗</a>` : `<button class="btn ghost small" id="btn-serve2">启动预览服务</button>`}
    </div>
    ${archives.length ? `<div class="grid">${archives.map((a) => `
      <div class="archive-item">
        <div>
          <div class="title">${esc(a.title)}</div>
          <div class="meta">
            <span class="tag">${esc(a.skillTitle || a.skill)}</span>
            <span class="tag">${esc(a.subject)}</span>
            ${a.grade ? `<span class="tag">${esc(a.grade)}</span>` : ''}
            ${a.entry ? `<span class="tag">${esc(a.entry)}</span>` : ''}
            <span class="tag ${a.validateOk ? 'ok' : 'warn'}">安检${a.validateOk ? '✓' : '✗'}</span>
            <span class="tag">${fmtSize(a.size)}${a.revisions ? ` · ${a.revisions + 1} 版` : ''}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn small primary" data-preview="${esc(a.id)}" ${c.server?.up ? '' : 'disabled'}>预览</button>
          <button class="btn small ghost" data-src="${esc(a.id)}">源码</button>
          <button class="btn small ghost" data-del="${esc(a.id)}">删除</button>
        </div>
      </div>`).join('')}</div>`
      : `<div class="empty">还没有课件档案。发起制作 → 生成 → save 存证后，这里就能回看。</div>`}`
  $('#btn-serve2')?.addEventListener('click', startServe)
  app.querySelectorAll('[data-preview]').forEach((b) => { b.onclick = () => { location.hash = `#/preview?id=${b.dataset.preview}` } })
  app.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => viewSource(b.dataset.src) })
  app.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
    if (!confirm('删除这份课件档案？（历史里留快照，可恢复）')) return
    try {
      await api('/api/archive/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.del }) })
      toast('已删除（可在历史里恢复）')
      await loadCatalog(true)
      render(viewNow())
    } catch (err) { toast(`删除失败：${err.message}`) }
  } })
}

async function viewPreview(params) {
  setNav('archives')
  const id = params.get('id')
  let data
  try { data = await api(`/api/preview?id=${encodeURIComponent(id)}`) } catch (err) { return viewError(err.message) }
  const archive = (await api(`/api/archive?id=${encodeURIComponent(id)}`)).archive
  app.innerHTML = `
    <div class="viewer-bar">
      <a class="btn small ghost" style="border-color:rgba(255,255,255,.3);color:#dfe6ee" href="#/archives">← 档案</a>
      <span class="title">${esc(archive.title)}</span>
      <span class="mono" style="color:#8fa0b5">${esc(archive.skillTitle || '')} · ${fmtSize(archive.size)}</span>
      <div class="spacer"></div>
      ${data.up ? '' : `<button class="btn small primary" id="btn-serve3">启动预览服务</button>`}
    </div>
    ${data.up && data.url
      ? `<iframe class="viewer-frame" src="${esc(data.url)}" title="课件预览"></iframe>`
      : `<div class="empty" style="margin:var(--sp-8)">预览服务没在跑。启动后即可在这里直接看到真实课件。<br><br><button class="btn primary" id="btn-serve4">启动预览服务</button></div>`}`
  const start = async () => {
    try {
      await api('/api/serve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      await new Promise((r) => setTimeout(r, 300))
      render(viewNow())
    } catch (err) { toast(`预览服务没起来：${err.message}`) }
  }
  $('#btn-serve3')?.addEventListener('click', start)
  $('#btn-serve4')?.addEventListener('click', start)
}

async function viewSource(id) {
  let data
  try { data = await api(`/api/archive/source?id=${encodeURIComponent(id)}`) } catch (err) { return toast(`读不了源码：${err.message}`) }
  setNav('archives')
  app.innerHTML = `
    <div class="viewer-bar">
      <a class="btn small ghost" style="border-color:rgba(255,255,255,.3);color:#dfe6ee" href="#/archives">← 档案</a>
      <span class="title">源码 · ${esc(data.file)}</span>
    </div>
    <pre class="src-pre">${esc(data.body)}</pre>`
}

// ---------- 历史 ----------
async function viewHistory() {
  setNav('history')
  const c = await loadCatalog(true)
  renderRailFoot()
  app.innerHTML = `
    <div class="page-head">
      <div class="page-title">动态历史</div>
      <div class="page-sub">save / 删除 / 恢复全程留痕</div>
      <div class="spacer"></div>
      <button class="btn ghost small" id="btn-clear">清空历史</button>
    </div>
    ${histList(c.history || [])}`
  $('#btn-clear').onclick = async () => {
    if (!confirm('清空全部历史记录？（课件档案不受影响）')) return
    try {
      await api('/api/history/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      await loadCatalog(true)
      render(viewNow())
    } catch (err) { toast(`清空失败：${err.message}`) }
  }
}

function viewError(msg) {
  app.innerHTML = `<div class="empty" style="margin:var(--sp-8)">⚠ ${esc(msg)}<br><br>
    <button class="btn primary" id="btn-retry">重试</button>
    <a class="btn ghost" href="#/">← 回概览</a></div>`
  $('#btn-retry').onclick = () => { catalog = null; render(viewNow()) }
}

// ---------- 路由 ----------
function viewNow() {
  const hash = location.hash || '#/'
  const [path, qs] = hash.slice(1).split('?')
  const params = new URLSearchParams(qs || '')
  const view = (path || '/').replace(/\/+$/, '') || '/'
  if (view === '/') return viewHome()
  if (view === '/start') return viewStart(params)
  if (view === '/archives') return viewArchives()
  if (view === '/preview') return viewPreview(params)
  if (view === '/history') return viewHistory()
  return viewHome()
}
function render(promise) { Promise.resolve(promise).catch((err) => viewError(err.message)) }

addEventListener('hashchange', () => render(viewNow()))
render(viewNow())
