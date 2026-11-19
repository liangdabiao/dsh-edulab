// ============================================================================
// 课件实验室 · 浏览器半边
//   - 侧栏加「课件实验室」入口，主区域是插件页面（/edulab/，iframe）
//   - 页面里点「发起制作」：页面 postMessage 一段草稿，这里开新对话并填进输入框
//   - 明暗跟随 dsh 主题，切换时把配色发给页面
//
// 注意：这里**不要**自己写 window.__ModuleLoader__.load(...)。
// scripts/build.mjs 的 banner 已经包了一层注册，再包一次会让同一个 id 注册两次，
// 宿主 client-modules 会以 duplicate factory registration 抛错并让整个 web boot 失败。
// ============================================================================
const React = require('react')
const h = React.createElement

const PANEL = 'edulab'
const SRC = '/edulab/'

// 侧栏图标：烧瓶 + 原子轨道（与 icon.svg 同款意象）
function PanelIcon(props) {
  const s = (props && props.size) || 18
  return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'M9.5 3h5v5.2l4.2 8.4A2.6 2.6 0 0 1 16.4 20.5H7.6a2.6 2.6 0 0 1-2.3-3.9L9.5 8.2V3z' }),
    h('path', { d: 'M7.2 14.5h9.6' }),
    h('ellipse', { cx: 12, cy: 17, rx: 4.2, ry: 1.7, transform: 'rotate(-18 12 17)' }),
    h('circle', { cx: 12, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' }),
    h('path', { d: 'M8.5 3h7' }))
}

function apply(ctx) {
  const frames = new Set()
  let scheme = null
  const post = (frame) => {
    try { if (scheme && frame.contentWindow) frame.contentWindow.postMessage({ type: 'edulab:scheme', scheme }, location.origin) } catch {}
  }
  ctx.inject(['theme'], (c) => {
    const push = (snap) => { scheme = snap.active.colorScheme; frames.forEach(post) }
    try { push(c.theme.getTheme()) } catch {}
    c.on('theme/change', push)
  })

  function LabPanel() {
    const ref = React.useRef(null)
    React.useEffect(() => {
      const self = ref.current
      if (self) frames.add(self)
      function onMessage(e) {
        const frame = ref.current
        if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return
        const m = e.data
        if (!m || m.type !== 'edulab:start' || typeof m.prompt !== 'string') return
        // 回执要等 startSession 真的落地：同步抛错、异步 reject 都算失败，
        // 否则面板先弹「已开新对话」再什么都没发生（假成功）。
        const ack = (ok, err) => {
          try {
            frame.contentWindow.postMessage(
              ok ? { type: 'edulab:start-ok' } : { type: 'edulab:start-failed', message: String((err && err.message) || err) },
              location.origin,
            )
          } catch { /* 面板已卸载 */ }
        }
        try {
          const started = ctx.uiWorkspace.startSession(undefined, { prompt: m.prompt, whenDraftExists: 'replace' })
          Promise.resolve(started).then(() => ack(true), (err) => { console.error('[edulab] 开新对话失败', err); ack(false, err) })
        } catch (err) {
          console.error('[edulab] 开新对话失败', err)
          ack(false, err)
        }
      }
      addEventListener('message', onMessage)
      return () => { removeEventListener('message', onMessage); frames.delete(self) }
    }, [])
    return h('iframe', {
      ref,
      src: SRC,
      title: '课件实验室',
      allow: 'fullscreen',
      onLoad: (e) => post(e.currentTarget),
      style: { width: '100%', height: '100%', border: 0, display: 'block' },
    })
  }

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 14, label: () => '课件实验室' }, PanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, LabPanel))
}

exports.isPlugin = true
exports.inject = ['slots', 'uiWorkspace']
exports.apply = apply
