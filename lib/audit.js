// 课件实验室 · 成品课件机械事故安检（audit）。
//
// 只拦机械事故，不判创作内容（dsh 创作边界铁律：创作归 agent，程序只拦注入没完成、
// 数据岛写坏这类"一跑就露馅"的问题；风格/文字/配色零检查，宁可漏报不可误报）。
import { readFileSync, statSync } from 'node:fs'

// 模板数据岛占位符（8 个模板共 3 种；残留任一 = 注入没完成，error）
export const PLACEHOLDERS = ['__LESSON_DATA__', '__REACTION_DATA__', '__TUTORIAL_DATA__']

// 成品允许外链的 CDN 域（模板原本就走 CDN，不在名单上的外链给 warn 不给 error）
export const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'code.jquery.com',
  'cdn.bootcdn.net',
  'lf3-cdn-tos.bytecdnapi.com',
  'lf26-cdn-tos.bytecdnapi.com',
]

function extractScriptSrcs(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1])
}

function extractLinkHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((m) => m[1])
    .filter((href) => /^https?:\/\//i.test(href))
}

// 提取 <script type="application/json"> 数据岛并逐个 JSON.parse
function checkDataIslands(html, errors) {
  const islands = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  let parsed = 0
  for (const m of islands) {
    const body = m[1].trim()
    if (!body) continue
    try {
      JSON.parse(body)
      parsed += 1
    } catch (err) {
      errors.push(`JSON 数据岛解析失败（${body.length} 字符）：${err.message}——注入的内容不是合法 JSON。`)
    }
  }
  return { islands: islands.length, parsed }
}

// 纯函数安检：输入 HTML 字符串，输出 { ok, errors[], warnings[], meta }
export function auditHtml(html) {
  const errors = []
  const warnings = []
  const text = String(html ?? '')

  if (!text.trim()) {
    return { ok: false, errors: ['文件是空的'], warnings, meta: { size: 0 } }
  }
  const size = Buffer.byteLength(text, 'utf8')
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || ''

  // 1) 占位符残留 = 注入没完成
  const left = PLACEHOLDERS.filter((p) => text.includes(p))
  if (left.length) errors.push(`占位符残留：${left.join('、')} 还在成品里——模板注入没完成，页面会白屏。`)

  // 2) JSON 数据岛可解析
  const islands = checkDataIslands(text, errors)

  // 3) HTML 基本完整
  if (!/<\/html\s*>/i.test(text)) errors.push('缺少 </html> 收尾——文件像被截断了。')
  // 3b) <style>/<script> 必须闭合：漏一个 </style> 会把整个 body 当 CSS 吞掉，
  //     页面只剩 <title>、整片白屏，而且浏览器控制台一个错都不报（最难查的那类事故）。
  const noComment = text.replace(/<!--[\s\S]*?-->/g, '')
  const openStyle = (noComment.match(/<style\b/gi) || []).length
  const closeStyle = (noComment.match(/<\/style\s*>/gi) || []).length
  if (openStyle > closeStyle) {
    errors.push(`有 ${openStyle - closeStyle} 个 <style> 没闭合（开 ${openStyle} / 闭 ${closeStyle}）：整个 <body> 会被当成 CSS 文本吞掉，打开只有标题、整页白屏。补上 </style> 再 validate。`)
  }
  const openScript = (noComment.match(/<script\b/gi) || []).length
  const closeScript = (noComment.match(/<\/script\s*>/gi) || []).length
  if (openScript > closeScript) {
    errors.push(`有 ${openScript - closeScript} 个 <script> 没闭合（开 ${openScript} / 闭 ${closeScript}）：后面的 HTML 会被当脚本吞掉，页面残缺或白屏。`)
  }
  if (size < 2000) warnings.push(`文件只有 ${size} 字节，比最模板（约 20KB+）小得多，确认生成完整了。`)

  // 4) 外链域白名单（域外 warn，不阻塞——可能是用户自己加的合法资源）
  const externals = [...extractScriptSrcs(text), ...extractLinkHrefs(text)].filter((u) => /^https?:\/\//i.test(u))
  const offCdn = externals.filter((u) => {
    try { return !CDN_HOSTS.includes(new URL(u).hostname) } catch { return true }
  })
  if (offCdn.length) warnings.push(`有 ${offCdn.length} 个外链不在常见 CDN 白名单里（离线打开会加载失败）：${offCdn.slice(0, 3).join(' , ')}${offCdn.length > 3 ? ' …' : ''}`)

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    meta: {
      title,
      size,
      dataIslands: islands.islands,
      dataIslandsParsed: islands.parsed,
      externals: externals.length,
    },
  }
}

// 读文件版：validate 动作入口
export function auditFile(file) {
  let stat
  try {
    stat = statSync(file)
  } catch {
    return { ok: false, errors: [`文件不存在：${file}`], warnings: [], meta: {} }
  }
  if (!stat.isFile()) return { ok: false, errors: [`不是文件：${file}`], warnings: [], meta: {} }
  let html
  try {
    html = readFileSync(file, 'utf8')
  } catch (err) {
    return { ok: false, errors: [`读不了文件：${err.message}`], warnings: [], meta: {} }
  }
  const report = auditHtml(html)
  report.file = file
  return report
}
