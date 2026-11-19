// 课件实验室 · 本地预览服务：把存证目录（courseware/）挂成静态站点。
// 课件是自包含单文件 HTML，静态服务即可；面板 iframe 用 /edulab/api/preview 算出的 URL 嵌入。
// 服务直接跑在插件进程里（dsh host 长驻），不需要 spawn 外部进程。
import http from 'node:http'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { COURSEWARE_DIR, getArchive, listArchives } from './data.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

let server = null
let serverPort = 0

export function serverHealth(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: timeoutMs }, (res) => {
      res.resume()
      resolve({ up: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode })
    })
    req.on('timeout', () => { req.destroy(); resolve({ up: false, statusCode: 0 }) })
    req.on('error', () => resolve({ up: false, statusCode: 0 }))
  })
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

// 只服务 courseware/ 里的文件：拒绝 ..、点开头的路径、逃出根目录的符号链接
function safeCoursewareFile(rel) {
  if (!rel || String(rel).split('/').some((p) => !p || p.startsWith('.'))) return null
  let base
  try { base = realpathSync(COURSEWARE_DIR) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

// GET / → 档案索引页（简单 HTML 列表）；GET /courseware/<id>/<file> → 课件
function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/healthz') return json(res, 200, { ok: true })
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const items = listArchives().map((a) => `<li><a href="/courseware/${encodeURIComponent(a.id)}/${encodeURIComponent(a.file)}">${a.title}</a>（${a.skillTitle || a.skill || '?'} · ${a.subject}）</li>`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(`<!doctype html><meta charset="utf-8"><title>课件实验室 · 存证预览</title><h1>课件实验室 · 存证预览</h1><ul>${items.join('') || '<li>还没有课件，先在对话里生成并 save。</li>'}</ul>`)
    }
    // URL 约定：/courseware/<id>/<file> —— 剥掉 courseware/ 前缀再映射到档案目录
    const m = url.pathname.match(/^\/courseware\/(.+)$/)
    if (!m) return json(res, 404, { ok: false, error: 'not found' })
    const rel = decodeURIComponent(m[1])
    const file = safeCoursewareFile(rel)
    if (!file) return json(res, 404, { ok: false, error: 'not found' })
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  } catch (err) {
    json(res, 500, { ok: false, error: String(err?.message || err) })
  }
}

// start/status/stop 预览服务
export async function startServer(port) {
  const p = Number(port) || 5200
  if (server && serverPort === p && server.listening) return { ok: true, alreadyRunning: true, url: previewBase(p) }
  if (server) {
    // 之前的实例可能是「listen 失败残留」的死对象：关不掉也不影响，直接丢弃
    try { await new Promise((r) => server.close(r)) } catch { /* 已死 */ }
    server = null
    serverPort = 0
  }
  const next = http.createServer(handler)
  try {
    await new Promise((resolve, reject) => {
      next.once('error', reject)
      next.listen(p, '127.0.0.1', resolve)
    })
  } catch (err) {
    // 关键：listen 失败必须回滚模块状态，否则 serverStatus 会一直报 up，
    // /api/preview 短路掉健康探测，面板据此渲染一个永远白屏的 iframe 且不再给「启动」按钮。
    try { next.close() } catch { /* 没起来 */ }
    server = null
    serverPort = 0
    const busy = err && err.code === 'EADDRINUSE'
    const hint = busy
      ? `端口 ${p} 已被占用：改插件 Config 里的 previewPort，或先关掉占用 ${p} 的进程（面板不会再卡在「已启动」的假状态）`
      : `预览服务起不来（${(err && err.message) || '未知错误'}）`
    throw Object.assign(new Error(hint), { code: err && err.code })
  }
  server = next
  serverPort = p
  return { ok: true, alreadyRunning: false, url: previewBase(p) }
}

export async function stopServer() {
  if (!server) return { ok: true, stopped: false }
  const s = server
  server = null
  serverPort = 0
  // 僵尸对象（listen 失败残留）close 会抛 ERR_SERVER_NOT_RUNNING，别让它盖掉「已停止」
  await new Promise((r) => { try { s.close(() => r()) } catch { r() } })
  return { ok: true, stopped: true }
}

export function serverStatus() {
  const up = Boolean(server && server.listening) // listening 才算真起来（listen 失败会留一个僵尸对象）
  return { up, port: serverPort, base: up ? previewBase(serverPort) : null }
}

export const previewBase = (port) => `http://127.0.0.1:${Number(port) || 5200}`

// 档案预览地址：/courseware/<id>/<file>
export function previewUrl(port, id, file) {
  const archive = id ? getArchive(id) : null
  const name = file || archive?.file || 'index.html'
  return `${previewBase(port)}/courseware/${encodeURIComponent(id)}/${encodeURIComponent(name)}`
}
