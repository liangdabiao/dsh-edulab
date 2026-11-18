// 课件实验室 · 课件档案 + 历史持久化（$DSH_HOME/dsh-edulab/）。
//
//   archives.json  [{ id, title, skill, skillTitle, subject, grade, entry, goal, note,
//                     file, dir, size, validateOk, warnings, createdAt, updatedAt,
//                     revisions: [{ rev, at, kind, note }] }]
//   history.json   [{ id, at, kind: create|update|delete|restore, archiveId, title,
//                     skill, size, rev, summary, snapshot? }]
//
// 每份档案是 courseware/<id>/<成品.html>（单文件课件）+ 元数据；工具 edulab 的
// save/archive/history 与面板「课件档案」读写同一份数据。
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-edulab')
export const COURSEWARE_DIR = join(DATA_DIR, 'courseware')
const ARCHIVE_FILE = join(DATA_DIR, 'archives.json')
const HIST_FILE = join(DATA_DIR, 'history.json')
const MAX_ARCHIVES = 100
const MAX_REVISIONS = 20
const MAX_HISTORY = 300

export const KIND_LABEL = { create: '新建', update: '更新', delete: '删除', restore: '恢复' }
export const SUBJECTS = ['数学', '物理', '化学', '生物', '信息科技', '科普', '其他']
export const GRADES = ['小学', '初中', '高中', '大学', '通识']
export const ENTRIES = ['文字题目', '随机出题', '图片识别', '主题创作']

export function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(COURSEWARE_DIR)) mkdirSync(COURSEWARE_DIR, { recursive: true })
}

// 原子写：先 .tmp 再 rename，页面轮询时不会读到半截 JSON。
function writeJson(file, value) {
  ensureDirs()
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(tmp, file)
  } catch (err) {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    throw err
  }
}

function readJson(file, fallback) {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return raw ?? fallback
  } catch {
    return fallback
  }
}

const load = () => {
  const raw = readJson(ARCHIVE_FILE, [])
  return Array.isArray(raw) ? raw : []
}
const save = (list) => writeJson(ARCHIVE_FILE, list.slice(0, MAX_ARCHIVES))

const loadHistory = () => {
  const raw = readJson(HIST_FILE, [])
  return Array.isArray(raw) ? raw : []
}
function pushHistory(event) {
  const list = loadHistory()
  list.unshift(event)
  writeJson(HIST_FILE, list.slice(0, MAX_HISTORY))
}

const now = () => new Date().toISOString()
const id4 = () => Math.random().toString(36).slice(2, 6)

export function newArchiveId() {
  return `cw-${now().slice(0, 10).replace(/-/g, '')}-${id4()}`
}

export function archiveDirFor(id) {
  return join(COURSEWARE_DIR, id)
}

// ---------------------------------------------------------------- 档案

export function archiveSummary(a) {
  return {
    id: a.id, title: a.title,
    skill: a.skill, skillTitle: a.skillTitle,
    subject: a.subject, grade: a.grade, entry: a.entry || '',
    goal: a.goal || '', note: a.note || '',
    file: a.file, size: a.size || 0,
    validateOk: Boolean(a.validateOk), warnings: a.warnings || 0,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
    revisions: (a.revisions || []).length,
  }
}

// 保存课件档案（id 相同 = 覆盖更新，多一版 revision）。
// htmlPath 是工作区里已经过 audit 的成品文件；这里复制进档案库。
// 更新时只覆盖传入的字段（undefined = 保留旧值），title/file/size/updatedAt 总是覆盖。
export function saveArchive({ id, title, skill, skillTitle, subject, grade, entry, goal, note, htmlPath, validateOk, warnings }) {
  if (!title || !String(title).trim()) throw new Error('课件标题（title）不能为空。')
  if (!htmlPath) throw new Error('成品 HTML 路径（file）不能为空——先按技能生成课件再 save。')
  if (!existsSync(htmlPath)) throw new Error(`成品 HTML 不存在：${htmlPath}（先按技能生成课件再 save）。`)
  // skill 是否合法由工具层校验，这里只记录
  const list = load()
  const size = statSync(htmlPath).size
  const fileName = basename(htmlPath)
  const recordId = id || newArchiveId()
  // 规范化：undefined = 没传（更新时保留旧值）；传了非法值归到默认项
  const norm = (v, table, dflt) => (v === undefined ? undefined : (table.includes(v) ? v : dflt))
  const subjectNorm = norm(subject, SUBJECTS, '其他')
  const gradeNorm = norm(grade, GRADES, '通识')
  const entryNorm = norm(entry, ENTRIES, '')
  const record = {
    id: recordId,
    title: String(title).trim(),
    skill: skill === undefined ? undefined : String(skill).trim(),
    skillTitle: skillTitle === undefined ? undefined : String(skillTitle).trim(),
    subject: subjectNorm ?? '其他',
    grade: gradeNorm ?? '通识',
    entry: entryNorm ?? '',
    goal: goal === undefined ? '' : String(goal).trim(),
    note: note === undefined ? '' : String(note).trim(),
    file: fileName,
    size,
    validateOk: Boolean(validateOk),
    warnings: Number.isFinite(Number(warnings)) ? Number(warnings) : 0,
    dir: archiveDirFor(recordId),
    createdAt: now(), updatedAt: now(),
    revisions: [],
  }
  const existing = id ? list.find((a) => a.id === id) : null
  if (existing) {
    record.id = existing.id
    record.dir = existing.dir || record.dir
    record.createdAt = existing.createdAt
    record.revisions = [...(existing.revisions || []), {
      rev: (existing.revisions || []).length + 1, at: now(), kind: 'update',
      note: record.note || '覆盖更新',
    }].slice(-MAX_REVISIONS)
    ensureDirs()
    if (existsSync(htmlPath)) copyFileSync(htmlPath, join(record.dir, fileName))
    // 未传入的可选字段保留旧值；title/file/size/updatedAt 总是覆盖
    const incoming = { skill, skillTitle, subject: subjectNorm, grade: gradeNorm, entry: entryNorm, goal, note, validateOk, warnings }
    const merged = { ...existing }
    for (const [k, v] of Object.entries(incoming)) {
      if (v !== undefined) merged[k] = record[k]
    }
    Object.assign(merged, { title: record.title, file: fileName, size, updatedAt: record.updatedAt, revisions: record.revisions })
    Object.assign(existing, merged)
    save(list)
    pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'update', archiveId: existing.id, title: existing.title, skill: existing.skill, size: record.size, rev: record.revisions.length, summary: record.note || '更新课件' })
    return { archive: existing, created: false }
  }
  ensureDirs()
  mkdirSync(record.dir, { recursive: true })
  if (existsSync(htmlPath)) copyFileSync(htmlPath, join(record.dir, fileName))
  list.unshift(record)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'create', archiveId: record.id, title: record.title, skill: record.skill, size: record.size, rev: 0, summary: `新建课件（${record.skillTitle || record.skill || '未知技能'} · ${record.subject} · ${record.grade}）` })
  return { archive: record, created: true }
}

export function listArchives() {
  return load()
}

export function getArchive(id) {
  return load().find((a) => a.id === id) || null
}

export function deleteArchive(id) {
  const list = load()
  const index = list.findIndex((a) => a.id === id)
  if (index === -1) return null
  const [removed] = list.splice(index, 1)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'delete', archiveId: removed.id, title: removed.title, skill: removed.skill, size: removed.size, rev: (removed.revisions || []).length, summary: '删除课件档案（留快照可恢复）', snapshot: removed })
  return removed
}

export function restoreFromHistory(eventId) {
  const event = loadHistory().find((e) => e.id === eventId)
  if (!event || event.kind !== 'delete' || !event.snapshot) return null
  const list = load()
  if (list.some((a) => a.id === event.snapshot.id)) return event.snapshot // 已存在就不重复插
  // 快照里的成品文件若还在档案库就顺手确认目录
  try { if (event.snapshot.dir) mkdirSync(event.snapshot.dir, { recursive: true }) } catch { /* */ }
  list.unshift(event.snapshot)
  save(list)
  pushHistory({ id: `ev-${now().replace(/\W/g, '')}-${id4()}`, at: now(), kind: 'restore', archiveId: event.snapshot.id, title: event.snapshot.title, skill: event.snapshot.skill, size: event.snapshot.size, rev: (event.snapshot.revisions || []).length, summary: '从删除快照恢复' })
  return event.snapshot
}

export function listArchiveHistory({ kind = 'all', q = '', limit = 20 } = {}) {
  let events = loadHistory()
  if (kind !== 'all') events = events.filter((e) => e.kind === kind)
  if (q) {
    const needle = String(q).toLowerCase()
    events = events.filter((e) => `${e.title} ${e.summary} ${e.archiveId} ${e.skill || ''}`.toLowerCase().includes(needle))
  }
  return events.slice(0, Math.min(100, Number(limit) || 20))
}

export function clearHistory() {
  writeJson(HIST_FILE, [])
}

export function stats() {
  const list = load()
  const events = loadHistory()
  const subjects = {}
  const skills = {}
  for (const a of list) {
    subjects[a.subject] = (subjects[a.subject] || 0) + 1
    const key = a.skillTitle || a.skill || '其他'
    skills[key] = (skills[key] || 0) + 1
  }
  return {
    archives: list.length,
    validateOk: list.filter((a) => a.validateOk).length,
    events: events.length,
    lastEventAt: events[0]?.at || null,
    subjects, skills,
  }
}

// 读回档案里的成品 HTML 文本（面板「查看源码」用，file 白名单 = 只准读 archive.file）
export function readArchivedFile(archive, file) {
  const name = String(file || archive.file || '')
  if (name !== archive.file) return null // 只准读存证时的那个成品文件
  try {
    return readFileSync(join(archive.dir, name), 'utf8')
  } catch {
    return null
  }
}
