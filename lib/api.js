// 课件实验室 · 看板数据面：/edulab 前缀路由。
//   GET  /                        工作台页面（lab/ 静态资源）
//   GET  /api/ping|health         存活探测
//   GET  /api/catalog             档案列表 + 历史 + 统计 + 技能目录 + 环境 + 服务状态（面板首屏一次拉全量）
//   GET  /api/status              服务状态（轮询用）
//   GET  /api/archive?id=         档案详情
//   GET  /api/archive/source?id=  读回存证成品 HTML 源码
//   GET  /api/history?kind=&q=    档案历史
//   GET  /api/preview?id=         计算预览地址（面板 iframe 用，serve 没起时返回 null）
//   POST /api/archive/remove      删档案（留删除快照）
//   POST /api/archive/restore     从删除快照恢复
//   POST /api/history/clear       清空历史
//   POST /api/serve               启动本地预览服务
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import {
  ENTRIES, GRADES, KIND_LABEL, SUBJECTS, archiveSummary, clearHistory, deleteArchive,
  getArchive, listArchives, listArchiveHistory, readArchivedFile, restoreFromHistory, stats,
} from './data.js'
import { probeEnv } from './env.js'
import { SKILL_META } from './skills-meta.js'
import { previewUrl, serverHealth, serverStatus, startServer } from './serve.js'

const BASE = '/edulab'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权，服务缺席时放行（fail-closed 会把面板永久 403）
  return connection.requestRejection({ headers: req.headers })
}

// 只放行 lab/ 里的文件：拒绝 ..、点开头的路径和指到目录外的符号链接
function safeLabFile(rel) {
  if (!rel || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(LAB) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serve(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

// 只接受同源页面发来的 JSON
function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('需要 JSON'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf8')
      size += buf.length
      if (size > max) req.destroy(); else chunks.push(buf)
    })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

export function registerApi(ctx, { configRef }) {
  const getCfg = () => {
    const cfg = configRef.config || {}
    return { port: Number(cfg.previewPort) || 5200, version: cfg._version }
  }

  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      const cfg = getCfg()
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        // ---- API ----
        if (path === '/api/ping' && req.method === 'GET') return json(res, 200, { ok: true, version: cfg.version })
        if ((path === '/api/health' || path === '/health') && req.method === 'GET') return json(res, 200, { ok: true, version: cfg.version })

        if (path === '/api/status' && req.method === 'GET') {
          const health = await serverHealth(cfg.port)
          const st = serverStatus()
          return json(res, 200, { ok: true, server: { port: cfg.port, up: health.up || st.up, base: st.base || `http://127.0.0.1:${cfg.port}` } })
        }

        if (path === '/api/catalog' && req.method === 'GET') {
          const health = await serverHealth(cfg.port)
          const st = serverStatus()
          const env = await probeEnv()
          return json(res, 200, {
            ok: true,
            version: cfg.version,
            server: { port: cfg.port, up: health.up || st.up, base: st.base || `http://127.0.0.1:${cfg.port}` },
            env: {
              python: env.python.ok ? { cmd: env.python.cmd, version: env.python.version } : null,
              sympy: env.sympy.ok ? { version: env.sympy.version } : null,
              skills: env.skills,
            },
            archives: listArchives().map(archiveSummary),
            history: listArchiveHistory({ limit: 60 }),
            stats: stats(),
            kinds: KIND_LABEL,
            subjects: SUBJECTS,
            grades: GRADES,
            entries: ENTRIES,
            skills: SKILL_META.map((s) => ({
              name: s.name, title: s.title, family: s.family, subject: s.subject,
              deps: s.deps, summary: s.summary, triggers: s.triggers, output: s.output,
            })),
          })
        }

        if (path === '/api/archive' && req.method === 'GET') {
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          const st = serverStatus()
          return json(res, 200, {
            ok: true, archive: archiveSummary(archive),
            preview: st.up && st.base ? previewUrl(cfg.port, archive.id) : null,
          })
        }

        if (path === '/api/archive/source' && req.method === 'GET') {
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          const body = readArchivedFile(archive, url.searchParams.get('file') || '')
          if (body === null) return json(res, 404, { ok: false, error: '成品源码不在存档里' })
          return json(res, 200, { ok: true, file: archive.file, body })
        }

        if (path === '/api/history' && req.method === 'GET') {
          const list = listArchiveHistory({
            kind: url.searchParams.get('kind') || 'all',
            q: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || 100,
          })
          return json(res, 200, { ok: true, list, kinds: KIND_LABEL })
        }

        if (path === '/api/archive/remove' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const removed = deleteArchive(String(body.id || ''))
          return json(res, removed ? 200 : 404, { ok: Boolean(removed), id: body.id, error: removed ? undefined : '没有这份课件档案' })
        }

        if (path === '/api/archive/restore' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const archive = restoreFromHistory(String(body.eventId || ''))
          if (!archive) return json(res, 400, { ok: false, error: '这条记录没有可恢复的快照' })
          return json(res, 200, { ok: true, archive: archiveSummary(archive), summary: `已恢复「${archive.title}」` })
        }

        if (path === '/api/history/clear' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          clearHistory()
          return json(res, 200, { ok: true })
        }

        if (path === '/api/serve' && req.method === 'POST') {
          const body = await readJson(req).catch((err) => err)
          if (body instanceof Error) return json(res, body.status || 400, { ok: false, error: body.message })
          const outcome = await startServer(cfg.port)
          return json(res, 200, { ...outcome, ok: Boolean(outcome.ok) })
        }

        if (path === '/api/preview' && req.method === 'GET') {
          const archive = getArchive(url.searchParams.get('id') || '')
          if (!archive) return json(res, 404, { ok: false, error: '没有这份课件档案' })
          const st = serverStatus()
          const up = (st.up && Boolean(st.base)) || (await serverHealth(cfg.port)).up
          return json(res, 200, { ok: true, up, url: up ? previewUrl(cfg.port, archive.id) : null })
        }

        if (path.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not found' })

        // ---- 静态页面 ----
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method' })
        const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
        const file = safeLabFile(rel)
        return file ? serve(req, res, file) : json(res, 404, { ok: false, error: 'not found' })
      } catch (err) {
        return json(res, 500, { ok: false, error: String(err?.message || '内部错误') })
      }
    },
  })
}
