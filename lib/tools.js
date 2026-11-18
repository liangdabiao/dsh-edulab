// 课件实验室 · edulab 工具（单工具 action 分派）。
// 职责：环境自检 / 技能盘点 / 成品安检 / 课件存证 / 预览服务 / 档案管理。
// 创作本身由 agent 按技能完成（写 JSON 数据岛注入模板或直接创作页面）；
// 程序只拦机械事故（占位符残留、坏 JSON 数据岛、截断），不判创作内容。
import { resolve } from 'node:path'
import { auditFile } from './audit.js'
import {
  ENTRIES, GRADES, KIND_LABEL, SUBJECTS, archiveSummary, deleteArchive, getArchive,
  listArchiveHistory, listArchives, newArchiveId, restoreFromHistory, saveArchive, stats,
} from './data.js'
import { probeEnv } from './env.js'
import { FAMILY_DEPS, SKILL_META, skillByName } from './skills-meta.js'
import { previewUrl, serverHealth, serverStatus, startServer, stopServer } from './serve.js'

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：详情正文' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`edulab 参数有误：${problems.join('；')}。`)
}

export function createEdulabTool({ port } = {}) {
  const cfgPort = () => Number(port) || 5200

  return {
    name: 'edulab',
    description:
      '课件实验室工具（配合 edu-* 学科技能使用）：' +
      'check 环境自检（python3/sympy 探测 + 每个技能可用性，首次用某个技能前先跑）、' +
      'list 盘点 8 个学科技能（选哪个技能做哪个题目）、' +
      'validate 成品课件安检（拦占位符残留/坏 JSON 数据岛/文件截断等机械事故，写完必须跑）、' +
      'save 课件存证（复制成品 HTML 入档案库，用户在侧栏「课件实验室」看板回看）、' +
      'serve 启动本地预览服务（面板 iframe 嵌真实课件）、' +
      'archive/get-archive/delete/history/restore 档案管理。' +
      '标准闭环：选技能（list）→ 按 SKILL.md 生成 HTML 到工作区 → validate（error 必须修）→ save → serve + 告知用户去面板预览。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: str('check 环境自检；list 技能盘点；validate 成品安检；save 存证；serve 预览服务（配 mode）；archive 档案列表；get-archive 档案详情；delete 删除档案；history 历史；restore 恢复',
          { enum: ['check', 'list', 'validate', 'save', 'serve', 'archive', 'get-archive', 'delete', 'history', 'restore'] }),
        file: str('validate/save：工作区里成品课件的 HTML 路径（必填）。相对路径按当前工作区解析'),
        skill: str('save：技能名（edu-solid-geometry / edu-analytic-geometry / edu-chem-reaction / edu-chem-tutorial / edu-physics / edu-physics-3d / edu-plane-geometry / edu-sci-viz）'),
        title: str('save：课件标题（必填，档案卡片显示）'),
        subject: str(`save：学科（${SUBJECTS.join('/')}），默认按技能推断`),
        grade: str(`save：学段（${GRADES.join('/')}）`),
        entry: str(`save：制作入口（${ENTRIES.join('/')}）`),
        goal: str('save：教学目标一句话（面板档案卡片显示）'),
        note: str('save：这一版做了什么（写进历史，方便回看）；history：关键词'),
        validateOk: str('save：validate 是否已通过（先 validate 再 save，通过传 "true"；未校验会如实标记）', { enum: ['true', 'false'] }),
        mode: str('serve：start 启动 / stop 停止 / status 查状态，默认 status', { enum: ['start', 'stop', 'status'] }),
        id: str('get-archive/delete：档案 id（archive 里能看到）'),
        confirm: str('delete 必须传 "yes"', { enum: ['yes'] }),
        kind: str('history：只看某一类事件', { enum: ['all', 'create', 'update', 'delete', 'restore'] }),
        limit: num('history/archive：最多几条，默认 20'),
        eventId: str('restore：历史事件 id（history 里能看到）'),
      },
    },
    output: OUTPUT,
    async execute(args) {
      check(args, this.parameters)

      if (args.action === 'check') {
        const env = await probeEnv()
        const py = env.python.ok ? `✓ ${env.python.cmd}（Python ${env.python.version}）` : '✗ 没找到 python3/python/py -3'
        const sp = env.sympy.ok ? `✓ sympy ${env.sympy.version}` : (env.python.ok ? '✗ 没有 sympy（解题三技能需要：python -m pip install sympy）' : '—（python 缺失，无法探测）')
        const lines = [
          `Node：${env.node.version}`,
          `Python：${py}`,
          `sympy：${sp}`,
          '',
          ...env.skills.map((s) => `${s.available ? '✓' : '✗'} ${s.name}｜${s.title}｜${s.depsLabel}`),
        ]
        const degraded = !env.allGood
        return result(true, `环境自检完成。${degraded ? '部分技能不可用（按上面标注选可用技能，或装依赖后重试）。' : '全部技能可用。'}`, lines.join('\n'))
      }

      if (args.action === 'list') {
        const lines = SKILL_META.map((s, i) =>
          `${i + 1}. ${s.name}｜${s.title}｜${s.subject}｜${s.deps}｜成品：${s.output}`)
        return result(true, `课件实验室共 ${SKILL_META.length} 个学科技能（括号内是触发词，按题面选技能）：`,
          lines.join('\n') + '\n\n' + SKILL_META.map((s) => `- ${s.name}：${s.triggers}`).join('\n'))
      }

      if (args.action === 'validate') {
        if (!args.file) throw new Error('validate 需要 file（工作区里成品 HTML 的路径）。')
        const file = resolve(String(args.file))
        const report = auditFile(file)
        const lines = [
          `文件：${file}`,
          `标题：${report.meta?.title || '（无 <title>）'}`,
          `大小：${report.meta?.size || 0} 字节｜JSON 数据岛：${report.meta?.dataIslandsParsed ?? 0}/${report.meta?.dataIslands ?? 0} 可解析｜外链：${report.meta?.externals ?? 0} 个`,
          '',
          ...report.errors.map((e) => `✗ ${e}`),
          ...report.warnings.map((w) => `⚠ ${w}`),
        ]
        return report.ok
          ? result(true, '安检通过：占位符注入完成、JSON 数据岛可解析、文件完整。接下来 save 存证。', report.warnings.length ? lines.join('\n') : '')
          : result(false, `安检没通过：${report.errors.length} 个机械事故，必须修完再交付（error 会白屏/报错，warnings 只是提示可不管）。`, lines.join('\n'))
      }

      if (args.action === 'save') {
        if (!args.file) throw new Error('save 需要 file（工作区里成品 HTML 的路径）。')
        if (!args.title) throw new Error('save 需要 title（课件标题）。')
        const meta = args.skill ? skillByName(args.skill) : null
        if (args.skill && !meta) {
          return result(false, `不认识技能 ${args.skill}。先 list 查看技能清单。`)
        }
        if (!args.skill) {
          return result(false, 'save 需要 skill（这次课件用的学科技能名，list 里能看到）。')
        }
        const file = resolve(String(args.file))
        // save 前再自动安检一次：不让坏课件静默入库
        const report = auditFile(file)
        if (!report.ok) {
          return result(false, 'save 拦下了：这份成品没通过安检（机械事故必须先修）。',
            report.errors.map((e) => `✗ ${e}`).join('\n') + '\n\n修完先 validate 再 save。')
        }
        // save 前已自动 audit 且 ok 才走到这里，安检状态如实记录为通过
        const sameSkill = listArchives().find((a) => a.skill === args.skill && a.title === String(args.title).trim())
        const id = sameSkill?.id || newArchiveId()
        const { archive: a, created } = saveArchive({
          id,
          title: args.title,
          skill: meta.name,
          skillTitle: meta.title,
          subject: args.subject || meta.subject,
          grade: args.grade,
          entry: args.entry,
          goal: args.goal,
          note: args.note,
          htmlPath: file,
          validateOk: true,
          warnings: report.warnings.length,
        })
        return result(true,
          `课件「${a.title}」已${created ? '存证' : `更新（第 ${a.revisions.length} 版）`}（id=${a.id}，${a.skillTitle}，${(a.size / 1024).toFixed(0)}KB，安检通过${a.warnings ? `，${a.warnings} 条提示` : ''}）。` +
          `用户可在侧栏「课件实验室」→ 课件档案回看；serve 启动预览后面板里能直接看到真实课件。` +
          (report.warnings.length ? `\n提示：${report.warnings.join('；')}` : ''),
          report.warnings.length ? '' : '')
      }

      if (args.action === 'serve') {
        const mode = args.mode || 'status'
        if (mode === 'stop') {
          const r = await stopServer()
          return result(true, r.stopped ? '预览服务已停止。' : '预览服务本来就没在跑。')
        }
        if (mode === 'status') {
          const st = serverStatus()
          return result(true, st.up ? `预览服务在跑：${st.base}（端口 ${st.port}）` : `预览服务没在跑（start 启动，端口 ${cfgPort()}）。`)
        }
        const outcome = await startServer(cfgPort())
        let line = outcome.ok
          ? (outcome.alreadyRunning ? `预览服务已在跑：${outcome.url}` : `预览服务已启动：${outcome.url}`)
          : `预览服务没起来：${outcome.error}`
        if (args.id && outcome.ok) {
          const archive = getArchive(args.id)
          if (archive) line += `\n「${archive.title}」预览地址：${previewUrl(cfgPort(), archive.id)}（面板 iframe 会加载它）`
        }
        return result(Boolean(outcome.ok), line, outcome.ok ? '' : outcome.error || '')
      }

      if (args.action === 'archive') {
        const archives = listArchives()
        if (!archives.length) return result(true, '还没有课件档案。save 一份即可。')
        const limit = Math.min(100, Number(args.limit) || 20)
        return result(true, `共 ${archives.length} 份课件档案：`,
          archives.slice(0, limit).map((a) => {
            const s = archiveSummary(a)
            return `- ${s.title}（${s.skillTitle}｜${s.subject}·${s.grade}｜${(s.size / 1024).toFixed(0)}KB｜安检${s.validateOk ? '✓' : '✗'}｜id=${s.id}）`
          }).join('\n'))
      }

      if (args.action === 'get-archive') {
        const archive = args.id ? getArchive(args.id) : null
        if (!archive) return result(false, `没有课件档案 ${args.id || ''}（先 archive 列表找 id）。`)
        const s = archiveSummary(archive)
        return result(true, `课件档案「${s.title}」（${s.skillTitle} · ${s.subject} · ${s.grade}）：`,
          `入口：${s.entry || '—'}\n教学目标：${s.goal || '—'}\n成品：${s.file}（${(s.size / 1024).toFixed(0)}KB）\n安检：${s.validateOk ? '通过' : '未通过/未校验'}（${s.warnings} 条提示）\n版本：${s.revisions} 版\n预览：${serverStatus().up ? previewUrl(cfgPort(), s.id) : '（预览服务没起，serve start 后面板可看）'}`)
      }

      if (args.action === 'history') {
        const events = listArchiveHistory({ kind: args.kind || 'all', q: args.note, limit: Math.min(100, Number(args.limit) || 20) })
        if (!events.length) return result(true, '还没有历史记录', 'save / delete 之后这里会留记录。')
        return result(true, `最近 ${events.length} 条课件历史：`,
          events.map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} ${KIND_LABEL[e.kind] || e.kind}｜${e.title}｜${e.summary}｜event=${e.id}`).join('\n'))
      }

      if (args.action === 'restore') {
        const event = args.eventId ? listArchiveHistory({ limit: 300 }).find((e) => e.id === args.eventId) : null
        const target = event && event.kind === 'delete' ? restoreFromHistory(args.eventId) : null
        if (!target) {
          const hint = event ? '这条历史不是删除记录（只有删除才有快照可恢复）。' : '要传 eventId（history 里能看到，形如 ev-xxx）。'
          return result(false, '没有可恢复的快照', hint)
        }
        return result(true, `已恢复课件档案「${target.title}」（id=${target.id}）`, `技能：${target.skillTitle || target.skill}`)
      }

      // delete
      if (!args.id) throw new Error('delete 需要 id（先 archive 找到）。')
      if (args.confirm !== 'yes') return result(false, '删除课件档案请用 confirm:"yes"。')
      const removed = deleteArchive(args.id)
      return removed
        ? result(true, `课件档案「${removed.title}」已删除（历史里留了快照，可用 restore 恢复）。`)
        : result(false, `没有课件档案 ${args.id}。`)
    },
  }
}
