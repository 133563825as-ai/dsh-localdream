/**
 * dsh-localdream — 浏览器半身。
 *
 * 两个挂载点，视觉沿用同区域既有的插件：
 *   1. `sidebar.footer.action` —— 侧边栏底部的胶囊（order 3，在「导出会话日志」pill 上面）
 *   2. `shell.overlay`        —— 点开后的完整面板（出图 / 历史 / 提示词 / 设置）
 *
 * 设计令牌统一用 `--dsw-*`，胶囊尺寸与描边对齐同区域的 session-log pill。
 */
window.__ModuleLoader__.load({
  id: 'dsh-localdream',
  factory: (require) => {
    const react = require('react')
    const h = react.createElement
    const NS = 'dsh-localdream'

    const zh = {
      title: '本地生图',
      openPanel: '打开本地生图面板',
      panelAria: '打开本地生图',
      close: '关闭',
      tabDraw: '出图',
      tabGallery: '历史',
      tabPrompts: '提示词',
      tabModels: '模型',
      tabSettings: '设置',
      modelsTitle: '已下载的模型',
      modelsEmpty: '设备上还没有下载模型。先在 Local Dream 里下载一个，这里就会列出来。',
      upscalersTitle: '放大器',
      switchModel: '切换',
      switchingModel: '切换中…',
      inUse: '使用中',
      baseSize: '基准',
      defaultParams: '默认参数',
      online: '受控模式在线',
      offline: '受控模式未开',
      offlineShort: '未连接',
      addressTitle: '连接地址',
      addressAuto: '留空即自动使用 127.0.0.1 的默认端口',
      addressControl: '控制口',
      addressGenerate: '生成口',
      addressTest: '测试连接',
      addressReset: '恢复自动',
      addressTesting: '测试中…',
      addressOk: '连上了',
      addressFail: '连不上',
      offlineHint: '请在手机上打开 Local Dream → 模型列表 ⋮ → 设备互联 → 「进入受控模式」',
      generating: '出图中',
      ready: '就绪',
      noModel: '未挂载模型',
      model: '模型',
      prompt: '正面提示词',
      promptPlaceholder: '描述要画什么；角色、构图、画风关键词都写这里',
      negative: '负面提示词',
      negativePlaceholder: 'cfg = 1.0 时后端不建负分支，这里不会生效',
      template: '提示词模板',
      templateNone: '（不使用模板）',
      aspectRatio: '宽高比',
      steps: '步数',
      cfg: 'CFG',
      scheduler: '采样器',
      count: '张数',
      seed: '种子（留空随机）',
      generate: '开始出图',
      generatingButton: '出图中…',
      cancelHint: '手机 NPU 一次只能跑一个任务',
      result: '本次结果',
      gallery: '出图历史',
      galleryEmpty: '还没有出图记录',
      refresh: '刷新',
      templateList: '模板列表',
      templateEmpty: '还没有模板。填好提示词后点「存为模板」。',
      templateName: '模板名',
      saveTemplate: '存为模板',
      deleteTemplate: '删除',
      applyTemplate: '填入出图',
      settings: '使用偏好',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      reset: '恢复默认',
      resetAll: '全部恢复默认',
      loadFailed: '加载失败',
      retry: '重试',
      preview: '预览',
      busy: '已有任务在跑',
      newTask: '新任务已提交',
      selectModel: '切换',
      paths: '文件位置'
    }

    const en = {
      title: 'Local Dream',
      openPanel: 'Open local image generation panel',
      panelAria: 'Open local image generation',
      close: 'Close',
      tabDraw: 'Draw',
      tabGallery: 'History',
      tabPrompts: 'Prompts',
      tabModels: 'Models',
      tabSettings: 'Settings',
      modelsTitle: 'Downloaded models',
      modelsEmpty: 'No models on the device yet. Download one in Local Dream and it shows up here.',
      upscalersTitle: 'Upscalers',
      switchModel: 'Switch',
      switchingModel: 'Switching…',
      inUse: 'In use',
      baseSize: 'base',
      defaultParams: 'defaults',
      online: 'Controlled mode online',
      offline: 'Controlled mode offline',
      offlineShort: 'offline',
      addressTitle: 'Connection',
      addressAuto: 'Leave blank to use the default 127.0.0.1 ports',
      addressControl: 'Control',
      addressGenerate: 'Generate',
      addressTest: 'Test',
      addressReset: 'Use default',
      addressTesting: 'Testing…',
      addressOk: 'Connected',
      addressFail: 'Unreachable',
      offlineHint: 'Open Local Dream on the phone → model list ⋮ → Device link → “Enter controlled mode”',
      generating: 'Generating',
      ready: 'Ready',
      noModel: 'No model loaded',
      model: 'Model',
      prompt: 'Prompt',
      promptPlaceholder: 'Describe what to draw — character, composition, style tags',
      negative: 'Negative prompt',
      negativePlaceholder: 'Ignored when cfg = 1.0',
      template: 'Template',
      templateNone: '(no template)',
      aspectRatio: 'Aspect ratio',
      steps: 'Steps',
      cfg: 'CFG',
      scheduler: 'Scheduler',
      count: 'Batch',
      seed: 'Seed (blank = random)',
      generate: 'Generate',
      generatingButton: 'Generating…',
      cancelHint: 'The phone NPU runs one task at a time',
      result: 'Latest result',
      gallery: 'History',
      galleryEmpty: 'Nothing generated yet',
      refresh: 'Refresh',
      templateList: 'Templates',
      templateEmpty: 'No templates yet. Fill in a prompt and save it.',
      templateName: 'Template name',
      saveTemplate: 'Save as template',
      deleteTemplate: 'Delete',
      applyTemplate: 'Use in draw',
      settings: 'Preferences',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      reset: 'Reset',
      resetAll: 'Reset all',
      loadFailed: 'Failed to load',
      retry: 'Retry',
      preview: 'Preview',
      busy: 'A task is already running',
      newTask: 'Task submitted',
      selectModel: 'Switch',
      paths: 'Files'
    }

    const makeT = (t) => (key) => (t && t[key]) || zh[key] || key

    //#region HTTP
    async function fetchJson (url, init) {
      const response = await fetch(url, init)
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        const message = payload && payload.error && payload.error.message
          ? payload.error.message
          : 'HTTP ' + response.status
        const error = new Error(message)
        error.status = response.status
        throw error
      }
      return payload
    }

    const postJson = (url, body) => fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    const api = {
      status: () => fetchJson('/localdream/status'),
      gallery: (limit) => fetchJson('/localdream/gallery?limit=' + limit),
      task: () => fetchJson('/localdream/draw'),
      startDraw: (args) => postJson('/localdream/draw', args),
      selectModel: (model) => postJson('/localdream/select', { model }),
      config: () => fetchJson('/localdream/config'),
      setConfig: (key, value) => postJson('/localdream/config', { action: 'set', key, value }),
      resetConfig: (key) => postJson('/localdream/config', { action: 'reset', key }),
      prompts: () => fetchJson('/localdream/prompts'),
      savePrompt: (body) => postJson('/localdream/prompts', Object.assign({ action: 'save' }, body)),
      removePrompt: (name) => postJson('/localdream/prompts', { action: 'remove', name }),
      fileUrl: (name) => '/localdream/file?name=' + encodeURIComponent(name)
    }
    //#endregion

    //#region 共享状态
    const POLL_IDLE_MS = 12000
    const POLL_BUSY_MS = 1500

    let state = {
      status: null,
      task: null,
      loading: false,
      error: null,
      loadedOnce: false
    }
    const listeners = new Set()
    let pollTimer = null
    let pollRefs = 0

    function emit (next) {
      state = Object.assign({}, state, next)
      for (const listener of listeners) listener()
    }

    function subscribe (listener) {
      listeners.add(listener)
      pollRefs += 1
      if (pollRefs === 1) scheduleNext(0)
      return () => {
        listeners.delete(listener)
        pollRefs = Math.max(0, pollRefs - 1)
        if (pollRefs === 0 && pollTimer !== null) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
      }
    }

    const getSnapshot = () => state

    function scheduleNext (delay) {
      if (pollTimer !== null) clearTimeout(pollTimer)
      pollTimer = setTimeout(() => {
        pollTimer = null
        void refresh()
      }, delay)
    }

    async function refresh () {
      if (typeof document !== 'undefined' && document.hidden) {
        scheduleNext(POLL_IDLE_MS)
        return
      }
      try {
        const [status, task] = await Promise.all([api.status(), api.task()])
        emit({
          status,
          task: task.task,
          loading: false,
          error: null,
          loadedOnce: true
        })
        scheduleNext(task.task && task.task.busy ? POLL_BUSY_MS : POLL_IDLE_MS)
      } catch (error) {
        emit({ loading: false, error: error.message, loadedOnce: true })
        scheduleNext(POLL_IDLE_MS)
      }
    }

    /** 手动触发一次刷新，并保证立刻重排下一次轮询。 */
    function poke () {
      void refresh()
    }

    // 各标签页的旁路数据缓存。切标签时先用上次的数据渲染、再后台刷新 ——
    // 否则每次切回来都要干等一次 HTTP 往返，中间是一片空白，看起来就是在闪。
    const tabCache = {
      config: null,
      gallery: null,
      templates: null
    }

    // 面板开关：dock 与侧边栏都往这里说话，浮层订阅它。
    let panelOpen = false
    const panelListeners = new Set()
    function setPanelOpen (open) {
      panelOpen = open
      for (const listener of panelListeners) listener()
    }
    function subscribePanel (listener) {
      panelListeners.add(listener)
      return () => panelListeners.delete(listener)
    }
    const getPanelOpen = () => panelOpen
    //#endregion

    //#region 样式
    const CSS = [
      '@keyframes ld-fadein{from{opacity:0}to{opacity:1}}',
      '@keyframes ld-pop{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}',
      '@keyframes ld-pulse{0%,100%{opacity:1}50%{opacity:.35}}',

      // 侧边栏底部的胶囊。尺寸与描边刻意对齐同区域的「导出会话日志」pill
      // （height 34 / radius 12 / padding 0 12 / border-l1），这样两枚排在一起是一条线。
      '.ld-pill{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font-family:inherit;font-size:13px;line-height:20px;cursor:pointer;width:100%;min-width:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;transition:background .12s ease}',
      '.ld-pill:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}',
      '.ld-pill:active{transform:scale(.985)}',
      '.ld-pill-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ld-pill-icon{font-size:14px;line-height:0;flex:none;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#777b84)}',
      '.ld-pill-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#777b84);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}',
      '@media(max-width:520px){.ld-pill{width:100%!important;padding:0 10px!important;gap:5px!important}}',

      // 地址输入也是胶囊形，与上面那枚同一条视觉语言。
      '.ld-capsule-input{width:100%;box-sizing:border-box;height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#17181c);font:inherit;font-size:12.5px}',
      '.ld-capsule-input:focus{outline:2px solid rgba(77,107,254,.4);outline-offset:1px}',
      '.ld-capsule-row{display:flex;gap:8px;align-items:center}',
      '.ld-capsule-row>.ld-capsule-input{flex:1;min-width:0}',

      '.ld-dot{width:8px;height:8px;border-radius:50%;flex:none;background:#9aa0a6}',
      '.ld-dot-online{background:#2eb872}',
      '.ld-dot-offline{background:#e05252}',
      '.ld-dot-busy{background:#4d6bfe;animation:ld-pulse 1.1s ease-in-out infinite}',

      '[data-shell-overlay]{z-index:1400!important}',
      '.ld-backdrop{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(0,0,0,.35);animation:ld-fadein .15s ease-out;pointer-events:auto;touch-action:none}',
      '.ld-dialog{width:min(94vw,460px);max-height:min(86vh,660px);display:flex;flex-direction:column;background:var(--dsw-specific-panel-fill,#f5f6f8);color:var(--dsw-alias-label-primary,#17181c);border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;touch-action:auto;animation:ld-pop .2s cubic-bezier(.16,1,.3,1)}',
      '.ld-header{display:flex;align-items:center;justify-content:space-between;padding:16px 18px 10px;flex:none;gap:10px}',
      '.ld-title{font-size:18px;font-weight:800;margin:0;min-width:0;flex:1;letter-spacing:-.3px;color:var(--dsw-alias-label-primary,#17181c)}',
      '.ld-close{width:32px;height:32px;border-radius:10px;background:rgba(128,128,128,.08);border:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary,#777b84);cursor:pointer;flex:none;transition:background .12s ease}',
      '.ld-close:hover{background:rgba(128,128,128,.15)}',
      '.ld-close:active{transform:scale(.92)}',

      '.ld-tabs{display:flex;gap:6px;padding:0 18px 12px;flex:none;flex-wrap:wrap}',
      '.ld-tab{padding:.32rem .7rem;border-radius:9px;border:1px solid transparent;background:rgba(128,128,128,.08);color:var(--dsw-alias-label-secondary,#777b84);font:inherit;font-size:12px;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.ld-tab:hover{background:rgba(128,128,128,.16)}',
      '.ld-tab-on{background:var(--dsw-alias-label-primary,#17181c);color:var(--dsw-specific-panel-fill,#fff);font-weight:700}',

      '.ld-body{flex:1;min-height:0;overflow-y:auto;padding:0 18px 18px;display:flex;flex-direction:column;gap:12px}',
      '.ld-field{display:flex;flex-direction:column;gap:6px}',
      '.ld-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#777b84)}',
      '.ld-input,.ld-textarea,.ld-select{width:100%;box-sizing:border-box;padding:.5rem .6rem;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#17181c);font:inherit;font-size:13px}',
      '.ld-textarea{min-height:72px;resize:vertical;line-height:1.45}',
      '.ld-input:focus,.ld-textarea:focus,.ld-select:focus{outline:2px solid rgba(77,107,254,.4);outline-offset:1px}',
      '.ld-row{display:flex;gap:8px}',
      '.ld-row>*{flex:1;min-width:0}',
      '.ld-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}',

      '.ld-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.55rem .9rem;border-radius:11px;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#17181c);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s ease,box-shadow .2s ease}',
      '.ld-btn:hover{background:var(--dsw-alias-button-floating-hover,#f5f6f8)}',
      '.ld-btn:active{transform:scale(.985)}',
      '.ld-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.ld-btn-primary{background:linear-gradient(135deg,#4d6bfe,#8a5cf6);border-color:transparent;color:#fff}',
      '.ld-btn-primary:hover{filter:brightness(1.06);background:linear-gradient(135deg,#4d6bfe,#8a5cf6)}',
      '.ld-btn-sm{padding:.35rem .6rem;font-size:12px;font-weight:500;border-radius:9px}',

      '.ld-note{padding:.55rem .7rem;border-radius:10px;background:rgba(224,82,82,.1);color:#c23b3b;font-size:12px;line-height:1.5}',
      '.ld-note-info{background:rgba(77,107,254,.1);color:#3a52c9}',
      '.ld-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#777b84)}',

      '.ld-progress{height:6px;border-radius:999px;background:rgba(128,128,128,.18);overflow:hidden}',
      '.ld-progress-bar{height:100%;background:linear-gradient(90deg,#4d6bfe,#8a5cf6);transition:width .3s ease}',

      '.ld-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
      '.ld-thumb{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:rgba(128,128,128,.08);cursor:pointer;padding:0}',
      '.ld-thumb img{width:100%;height:100%;object-fit:cover;display:block}',
      '.ld-thumb-on{border-color:#4d6bfe;box-shadow:0 0 0 2px rgba(77,107,254,.3)}',
      '.ld-preview{border-radius:14px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:rgba(128,128,128,.08)}',
      '.ld-preview img{width:100%;display:block}',

      '.ld-list{display:flex;flex-direction:column;gap:8px}',
      '.ld-item{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,#e7e8ec);background:var(--dsw-alias-button-elevated-fill,#fff);text-align:left;font:inherit;color:inherit;width:100%;box-sizing:border-box}',
      'button.ld-item{cursor:pointer}',
      '.ld-item:hover{background:var(--dsw-alias-button-floating-hover,#f5f6f8)}',
      '.ld-item-actions{display:flex;gap:6px;margin-top:4px}',
      '.ld-item-on{border-color:#4d6bfe;box-shadow:0 0 0 2px rgba(77,107,254,.25)}',
      '.ld-item-title{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ld-item-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#777b84);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ld-empty{padding:22px 12px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary,#777b84)}',
      '.ld-spacer{flex:1}',
      '.ld-footer{display:flex;gap:8px;align-items:center;flex:none;padding-top:4px}'
    ].join('\n')

    function injectStyle () {
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin', 'dsh-localdream')
      tag.setAttribute('data-dsh-localdream', '')
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }
    //#endregion

    //#region 小组件
    const cls = (...names) => names.filter(Boolean).join(' ')

    /**
     * 宿主的官方图标库。取法与 dsh-web-mobile 完全一致：按候选名字找，
     * 找不到就回落到自绘 —— 任何宿主版本都不会因为缺图标而渲染崩。
     */
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives') || {}
      } catch {
        return {}
      }
    })()

    function pickIcon (names) {
      for (const name of names) {
        const found = primitives[name]
        if (found !== null && (typeof found === 'function' || typeof found === 'object')) return found
      }
      return null
    }

    const HostSparkle = pickIcon([
      'IconSparkleRegular',
      'IconSparkleMedium',
      'IconSparkleArtwork',
      'IconSparkle'
    ])

    /** 四角星兜底：宿主的图标取不到时用，形状与主题描边保持一致。 */
    function FallbackSparkle (props) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: '1em',
        height: '1em',
        'aria-hidden': 'true',
        style: { display: 'block' }
      },
      h('path', {
        d: 'M12 3.2l1.9 5.4 5.4 1.9-5.4 1.9-1.9 5.4-1.9-5.4-5.4-1.9 5.4-1.9z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinejoin: 'round'
      }),
      h('path', {
        d: 'M18.6 15.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
        fill: 'currentColor'
      }))
    }

    /** 生图的标记图标：宿主官方的优先，取不到用兜底。 */
    function SparkleIcon (props) {
      if (HostSparkle !== null) return h(HostSparkle, Object.assign({ className: 'ld-pill-icon' }, props || {}))
      return h('span', { className: 'ld-pill-icon' }, h(FallbackSparkle, props || {}))
    }

    function statusDotClass (status, task) {
      if (task && task.busy) return 'ld-dot ld-dot-busy'
      if (status && status.online) return 'ld-dot ld-dot-online'
      return 'ld-dot ld-dot-offline'
    }

    function IconImage () {
      return h('svg', {
        width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'
      },
      h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
      h('circle', { cx: 8.5, cy: 9.5, r: 1.6 }),
      h('path', { d: 'M5 17l4.5-4.5 3.5 3.5 3-3L19 16' }))
    }

    function Field (props) {
      return h('div', { className: 'ld-field' },
        props.label ? h('label', { className: 'ld-label' }, props.label) : null,
        props.children)
    }

    function Note (props) {
      return h('div', { className: cls('ld-note', props.info && 'ld-note-info') }, props.children)
    }
    //#endregion

    //#region 侧边栏胶囊
    /**
     * 侧边栏底部的胶囊。挂 `sidebar.footer.action`，order 3 ——
     * 压在「导出会话日志」pill（order 5）上面、图标行（order 0）下面。
     */
    function SidebarPill (props) {
      const t = makeT(props.t)
      const snap = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const status = snap.status
      const task = snap.task

      let sub = null
      if (task && task.busy) {
        sub = task.totalSteps > 0 ? task.step + '/' + task.totalSteps : t('generating')
      } else if (status && status.online) {
        sub = status.servingModelId || t('ready')
      } else {
        sub = t('offlineShort')
      }

      const detail = task && task.busy
        ? t('generating')
        : status && status.online
          ? t('online') + (status.servingModelId ? ' · ' + status.servingModelId : '')
          : t('offline')

      return h('button', {
        className: 'ld-pill',
        type: 'button',
        'aria-label': t('panelAria'),
        title: detail,
        onClick: () => setPanelOpen(true)
      },
      h('span', { className: statusDotClass(status, task) }),
      h(SparkleIcon, {}),
      h('span', { className: 'ld-pill-text' }, t('title')),
      sub !== null ? h('span', { className: 'ld-pill-sub' }, sub) : null)
    }
    //#endregion

    //#region 出图页
    function DrawTab (props) {
      const t = makeT(props.t)
      const snap = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const status = snap.status
      const task = snap.task
      const models = (status && status.models) || []
      const templates = props.templates || []
      const settings = (status && status.settings) || {}
      const maxBatch = (status && status.maxBatch) || 2

      const [prompt, setPrompt] = react.useState('')
      const [negative, setNegative] = react.useState('')
      const [templateName, setTemplateName] = react.useState('')
      const [model, setModel] = react.useState('')
      const [aspectRatio, setAspectRatio] = react.useState(settings.defaultAspectRatio || '1:1')
      const [steps, setSteps] = react.useState('')
      const [cfg, setCfg] = react.useState('')
      const [scheduler, setScheduler] = react.useState('')
      const [count, setCount] = react.useState(1)
      const [seed, setSeed] = react.useState('')
      const [localError, setLocalError] = react.useState('')

      // 打开面板时把默认值同步过来（用户可能刚在设置页改过）
      react.useEffect(() => {
        if (settings.defaultAspectRatio) setAspectRatio(settings.defaultAspectRatio)
        if (settings.defaultCount) setCount(Math.min(settings.defaultCount, maxBatch))
      }, [settings.defaultAspectRatio, settings.defaultCount, maxBatch])

      const busy = !!(task && task.busy)

      const applyTemplate = (name) => {
        setTemplateName(name)
        if (name === '') return
        const found = templates.find((item) => item.name === name)
        if (!found) return
        if (found.prompt) setPrompt(found.prompt)
        if (found.negativePrompt !== undefined) setNegative(found.negativePrompt)
        if (found.aspectRatio) setAspectRatio(found.aspectRatio)
        if (found.steps !== undefined) setSteps(String(found.steps))
        if (found.cfg !== undefined) setCfg(String(found.cfg))
        if (found.scheduler) setScheduler(found.scheduler)
        if (found.model) setModel(found.model)
      }

      const submit = async () => {
        setLocalError('')
        if (prompt.trim() === '' && templateName === '') {
          setLocalError(t('prompt') + ' / ' + t('template'))
          return
        }
        const args = {}
        if (prompt.trim() !== '') args.prompt = prompt
        if (templateName !== '') args.template = templateName
        if (negative.trim() !== '') args.negativePrompt = negative
        if (model !== '') args.model = model
        if (aspectRatio) args.aspectRatio = aspectRatio
        if (steps !== '') args.steps = Number(steps)
        if (cfg !== '') args.cfg = Number(cfg)
        if (scheduler !== '') args.scheduler = scheduler
        if (count) args.count = count
        if (seed !== '') args.seed = Number(seed)

        try {
          const result = await api.startDraw(args)
          props.onTask(result.task)
          poke()
        } catch (error) {
          setLocalError(error.message)
        }
      }

      const last = task && task.last
      const progress = task && task.totalSteps > 0
        ? Math.round((task.step / task.totalSteps) * 100)
        : 0

      return h('div', { className: 'ld-body' },
        status && !status.online
          ? Note({ children: [t('offlineHint'), status.hint ? h('div', { key: 'h' }, status.hint) : null] })
          : null,

        models.length > 0
          ? Field({
              label: t('model'),
              children: h('select', {
                className: 'ld-select',
                value: model,
                onChange: (event) => setModel(event.target.value)
              },
              h('option', { value: '' }, status && status.servingModelId
                ? '— ' + status.servingModelId
                : '— ' + t('noModel')),
              models.map((item) => h('option', { key: item.id, value: item.id }, item.id)))
            })
          : null,

        templates.length > 0
          ? Field({
              label: t('template'),
              children: h('select', {
                className: 'ld-select',
                value: templateName,
                onChange: (event) => applyTemplate(event.target.value)
              },
              h('option', { value: '' }, t('templateNone')),
              templates.map((item) => h('option', { key: item.name, value: item.name }, item.name)))
            })
          : null,

        Field({
          label: t('prompt'),
          children: h('textarea', {
            className: 'ld-textarea',
            value: prompt,
            placeholder: t('promptPlaceholder'),
            onChange: (event) => setPrompt(event.target.value)
          })
        }),

        Field({
          label: t('negative'),
          children: h('textarea', {
            className: 'ld-textarea',
            style: { minHeight: '52px' },
            value: negative,
            placeholder: t('negativePlaceholder'),
            onChange: (event) => setNegative(event.target.value)
          })
        }),

        h('div', { className: 'ld-grid2' },
          Field({
            label: t('aspectRatio'),
            children: h('select', {
              className: 'ld-select',
              value: aspectRatio,
              onChange: (event) => setAspectRatio(event.target.value)
            }, ['1:1', '4:3', '3:2', '16:10', '16:9', '2:1', '3:4', '9:16'].map((value) =>
              h('option', { key: value, value }, value)))
          }),
          Field({
            label: t('count'),
            children: h('select', {
              className: 'ld-select',
              value: String(count),
              onChange: (event) => setCount(Number(event.target.value))
            }, Array.from({ length: maxBatch }, (_, index) => index + 1).map((value) =>
              h('option', { key: value, value: String(value) }, String(value))))
          })),

        h('div', { className: 'ld-grid2' },
          Field({
            label: t('steps'),
            children: h('input', {
              className: 'ld-input',
              type: 'number',
              min: 1,
              max: 200,
              value: steps,
              placeholder: 'auto',
              onChange: (event) => setSteps(event.target.value)
            })
          }),
          Field({
            label: t('cfg'),
            children: h('input', {
              className: 'ld-input',
              type: 'number',
              step: 0.5,
              min: 0,
              max: 30,
              value: cfg,
              placeholder: 'auto',
              onChange: (event) => setCfg(event.target.value)
            })
          })),

        h('div', { className: 'ld-grid2' },
          Field({
            label: t('scheduler'),
            children: h('select', {
              className: 'ld-select',
              value: scheduler,
              onChange: (event) => setScheduler(event.target.value)
            },
            h('option', { value: '' }, 'auto'),
            ((status && status.schedulers) || []).map((value) =>
              h('option', { key: value, value }, value)))
          }),
          Field({
            label: t('seed'),
            children: h('input', {
              className: 'ld-input',
              type: 'number',
              value: seed,
              placeholder: '',
              onChange: (event) => setSeed(event.target.value)
            })
          })),

        localError !== '' ? Note({ children: localError }) : null,
        task && task.phase === 'error' && task.error ? Note({ children: task.error }) : null,

        busy
          ? h('div', { className: 'ld-field' },
              h('div', { className: 'ld-label' }, t('generating') + ' — ' + (task.step || 0) + '/' + (task.totalSteps || '?')),
              h('div', { className: 'ld-progress' },
                h('div', { className: 'ld-progress-bar', style: { width: (progress || 3) + '%' } })))
          : null,

        h('div', { className: 'ld-footer' },
          h('button', {
            className: 'ld-btn ld-btn-primary',
            type: 'button',
            disabled: busy || !(status && status.online),
            onClick: submit
          }, busy ? t('generatingButton') : t('generate')),
          busy ? h('span', { className: 'ld-hint' }, t('cancelHint')) : null),

        last && last.files && last.files.length > 0
          ? h('div', { className: 'ld-field' },
              h('div', { className: 'ld-label' }, t('result') + ' · ' + last.modelId + ' · ' + last.size.width + '×' + last.size.height),
              last.files.map((file) => h('div', { className: 'ld-preview', key: file.name },
                h('img', { src: api.fileUrl(file.name), alt: file.name, loading: 'lazy' }))))
          : null)
    }
    //#endregion

    //#region 历史页
    function GalleryTab (props) {
      const t = makeT(props.t)
      const [images, setImages] = react.useState(tabCache.gallery || [])
      const [selected, setSelected] = react.useState('')
      const [loading, setLoading] = react.useState(false)
      const [error, setError] = react.useState('')

      const load = react.useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const payload = await api.gallery(60)
          const next = payload.images || []
          tabCache.gallery = next
          setImages(next)
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
      }, [])

      react.useEffect(() => { void load() }, [load])

      const current = selected !== ''
        ? images.find((item) => item.name === selected)
        : images[0]

      return h('div', { className: 'ld-body' },
        h('div', { className: 'ld-footer' },
          h('span', { className: 'ld-label' }, t('gallery') + ' · ' + images.length),
          h('span', { className: 'ld-spacer' }),
          h('button', { className: 'ld-btn ld-btn-sm', type: 'button', onClick: () => void load() }, t('refresh'))),

        error !== '' ? Note({ children: error }) : null,

        current
          ? h('div', { className: 'ld-preview' },
              h('img', { src: api.fileUrl(current.name), alt: current.name }),
              h('div', { className: 'ld-hint', style: { padding: '8px 10px' } },
                current.name + ' · ' + current.width + '×' + current.height + ' · ' + current.format.toUpperCase()))
          : null,

        images.length === 0
          ? h('div', { className: 'ld-empty' }, loading ? '…' : t('galleryEmpty'))
          : h('div', { className: 'ld-thumbs' },
              images.map((item) => h('button', {
                key: item.name,
                type: 'button',
                className: cls('ld-thumb', current && current.name === item.name && 'ld-thumb-on'),
                title: item.name,
                onClick: () => setSelected(item.name)
              }, h('img', { src: api.fileUrl(item.name), alt: item.name, loading: 'lazy' })))))
    }
    //#endregion

    //#region 模型页
    /**
     * 设备上已下载的模型。数据来自后端 `/models` —— 装了新模型不需要改任何配置，
     * 刷新一下这里就会列出来。
     */
    function ModelsTab (props) {
      const t = makeT(props.t)
      const snap = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const status = snap.status
      const models = (status && status.models) || []
      const upscalers = (status && status.upscalers) || []
      const current = status ? status.servingModelId : ''
      const [switching, setSwitching] = react.useState('')
      const [error, setError] = react.useState('')

      const use = async (id) => {
        if (id === current) return
        setError('')
        setSwitching(id)
        try {
          await api.selectModel(id)
          poke()
        } catch (err) {
          setError(err.message)
        } finally {
          setSwitching('')
        }
      }

      return h('div', { className: 'ld-body' },
        status && !status.online ? Note({ children: status.hint || t('offlineHint') }) : null,
        error !== '' ? Note({ children: error }) : null,

        h('div', { className: 'ld-label' }, t('modelsTitle') + ' · ' + models.length),
        models.length === 0
          ? h('div', { className: 'ld-empty' }, t('modelsEmpty'))
          : h('div', { className: 'ld-list' },
              models.map((model) => {
                const tags = [model.isSdxl ? 'SDXL' : null, model.isAnima ? 'Anima' : null].filter(Boolean).join('/')
                const defaults = model.defaults || {}
                const tuning = [
                  model.generationSize ? t('baseSize') + ' ' + model.generationSize : null,
                  defaults.steps === undefined ? null : defaults.steps + ' 步',
                  defaults.cfg === undefined ? null : 'CFG ' + defaults.cfg,
                  defaults.scheduler || null
                ].filter((item) => item !== null).join(' · ')
                const isCurrent = model.id === current

                return h('div', { key: model.id, className: cls('ld-item', isCurrent && 'ld-item-on') },
                  h('span', { className: 'ld-item-title', title: model.id }, model.id),
                  h('span', { className: 'ld-item-sub' }, [tags, tuning].filter(Boolean).join(' · ')),
                  h('div', { className: 'ld-item-actions' },
                    h('button', {
                      className: 'ld-btn ld-btn-sm',
                      type: 'button',
                      disabled: isCurrent || switching !== '',
                      onClick: () => void use(model.id)
                    }, isCurrent
                      ? t('inUse')
                      : (switching === model.id ? t('switchingModel') : t('switchModel')))))
              })),

        upscalers.length > 0
          ? h('div', { className: 'ld-field' },
              h('div', { className: 'ld-label' }, t('upscalersTitle') + ' · ' + upscalers.length),
              h('div', { className: 'ld-list' },
                upscalers.map((item) => h('div', { key: item.id, className: 'ld-item' },
                  h('span', { className: 'ld-item-title' }, item.id),
                  h('span', { className: 'ld-item-sub', title: item.path }, item.path)))))
          : null)
    }
    //#endregion

    //#region 提示词页
    function PromptsTab (props) {
      const t = makeT(props.t)
      const [templates, setTemplates] = react.useState(tabCache.templates || props.templates || [])
      const [selected, setSelected] = react.useState('')
      const [draft, setDraft] = react.useState({ name: '', prompt: '', negativePrompt: '', aspectRatio: '', steps: '', cfg: '', scheduler: '', note: '' })
      const [message, setMessage] = react.useState('')
      const [error, setError] = react.useState('')

      const reload = react.useCallback(async () => {
        try {
          const payload = await api.prompts()
          const next = payload.templates || []
          tabCache.templates = next
          setTemplates(next)
          props.onTemplates(next)
        } catch (err) {
          setError(err.message)
        }
      }, [props])

      const pick = (template) => {
        setSelected(template.name)
        setDraft({
          name: template.name,
          prompt: template.prompt || '',
          negativePrompt: template.negativePrompt || '',
          aspectRatio: template.aspectRatio || '',
          steps: template.steps === undefined ? '' : String(template.steps),
          cfg: template.cfg === undefined ? '' : String(template.cfg),
          scheduler: template.scheduler || '',
          note: template.note || ''
        })
        setMessage('')
        setError('')
      }

      const reset = () => {
        setSelected('')
        setDraft({ name: '', prompt: '', negativePrompt: '', aspectRatio: '', steps: '', cfg: '', scheduler: '', note: '' })
        setMessage('')
        setError('')
      }

      const save = async () => {
        setError('')
        setMessage('')
        if (draft.name.trim() === '') {
          setError(t('templateName'))
          return
        }
        const body = { name: draft.name.trim(), prompt: draft.prompt }
        if (draft.negativePrompt !== '') body.negativePrompt = draft.negativePrompt
        if (draft.aspectRatio !== '') body.aspectRatio = draft.aspectRatio
        if (draft.steps !== '') body.steps = Number(draft.steps)
        if (draft.cfg !== '') body.cfg = Number(draft.cfg)
        if (draft.scheduler !== '') body.scheduler = draft.scheduler
        if (draft.note !== '') body.note = draft.note
        try {
          await api.savePrompt(body)
          setMessage(t('saved'))
          await reload()
        } catch (err) {
          setError(err.message)
        }
      }

      const remove = async () => {
        if (draft.name.trim() === '') return
        setError('')
        try {
          await api.removePrompt(draft.name.trim())
          reset()
          await reload()
        } catch (err) {
          setError(err.message)
        }
      }

      const field = (key, label, extra) => Field({
        label: label,
        children: h(key === 'prompt' || key === 'negativePrompt' ? 'textarea' : 'input', Object.assign({
          className: key === 'prompt' || key === 'negativePrompt' ? 'ld-textarea' : 'ld-input',
          value: draft[key],
          onChange: (event) => setDraft(Object.assign({}, draft, { [key]: event.target.value }))
        }, extra || {}))
      })

      return h('div', { className: 'ld-body' },
        templates.length === 0
          ? h('div', { className: 'ld-empty' }, t('templateEmpty'))
          : h('div', { className: 'ld-list' },
              templates.map((template) => h('button', {
                key: template.name,
                type: 'button',
                className: cls('ld-item', selected === template.name && 'ld-item-on'),
                onClick: () => pick(template)
              },
              h('span', { className: 'ld-item-title' }, template.name),
              h('span', { className: 'ld-item-sub' }, (template.prompt || '').slice(0, 60))))),

        error !== '' ? Note({ children: error }) : null,
        message !== '' ? Note({ info: true, children: message }) : null,

        field('name', t('templateName'), { placeholder: t('templateName') }),
        field('prompt', t('prompt')),
        field('negativePrompt', t('negative'), { style: { minHeight: '48px' } }),

        h('div', { className: 'ld-grid2' },
          field('aspectRatio', t('aspectRatio'), { placeholder: '3:4' }),
          field('scheduler', t('scheduler'), { placeholder: 'dpm' })),
        h('div', { className: 'ld-grid2' },
          field('steps', t('steps'), { type: 'number' }),
          field('cfg', t('cfg'), { type: 'number', step: 0.5 })),
        field('note', 'note', { placeholder: '' }),

        h('div', { className: 'ld-footer' },
          h('button', { className: 'ld-btn ld-btn-primary', type: 'button', onClick: save }, t('saveTemplate')),
          h('button', { className: 'ld-btn ld-btn-sm', type: 'button', onClick: reset }, '＋'),
          h('span', { className: 'ld-spacer' }),
          h('button', { className: 'ld-btn ld-btn-sm', type: 'button', onClick: remove }, t('deleteTemplate'))))
    }
    //#endregion

    //#region 设置页
    const SETTING_FIELDS = [
      { key: 'defaultAspectRatio', label: 'defaultAspectRatio', type: 'text' },
      { key: 'defaultCount', label: 'defaultCount', type: 'number' },
      { key: 'maxBatch', label: 'maxBatch', type: 'number' },
      { key: 'defaultOutputFormat', label: 'defaultOutputFormat', type: 'select', options: ['png', 'jpeg'] },
      { key: 'defaultModel', label: 'defaultModel', type: 'text' },
      { key: 'defaultNegativePrompt', label: 'defaultNegativePrompt', type: 'textarea' }
    ]

    function SettingsTab (props) {
      const t = makeT(props.t)
      const [config, setConfig] = react.useState(tabCache.config)
      // 缓存命中时连草稿一起惰性初始化 —— 否则切回来会先渲染一屏空输入框、
      // 再被后台数据填上，那同样是一次可见的闪烁。
      const [draft, setDraft] = react.useState(() => (
        tabCache.config ? Object.assign({}, tabCache.config.settings) : {}
      ))
      const [message, setMessage] = react.useState('')
      const [error, setError] = react.useState('')
      const [testing, setTesting] = react.useState(false)
      const [testResult, setTestResult] = react.useState('')
      const snap = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const active = (snap.status && snap.status.address) || { controlBaseUrl: '', generateBaseUrl: '' }

      const load = react.useCallback(async () => {
        try {
          const payload = await api.config()
          tabCache.config = payload
          setConfig(payload)
          setDraft(Object.assign({}, payload.settings))
        } catch (err) {
          setError(err.message)
        }
      }, [])

      react.useEffect(() => { void load() }, [load])

      const save = async () => {
        setError('')
        setMessage('')
        try {
          for (const field of SETTING_FIELDS) {
            const value = draft[field.key]
            if (value === undefined) continue
            if (config && config.settings && String(config.settings[field.key]) === String(value)) continue
            await api.setConfig(field.key, value)
          }
          setMessage(t('saved'))
          await load()
          poke()
        } catch (err) {
          setError(err.message)
        }
      }

      const resetAll = async () => {
        setError('')
        try {
          await api.resetConfig('')
          setMessage(t('saved'))
          await load()
          poke()
        } catch (err) {
          setError(err.message)
        }
      }

      const saveAddress = async () => {
        setError('')
        setTestResult('')
        setTesting(true)
        try {
          for (const key of ['controlBaseUrl', 'generateBaseUrl']) {
            const next = draft[key] === undefined ? '' : draft[key]
            if (String(config.settings[key] ?? '') !== String(next)) {
              await api.setConfig(key, next)
            }
          }
          // 地址同步发生在每个请求的入口，所以下一次 status 打的就是新地址
          const payload = await api.status()
          setTestResult(
            (payload.online ? t('addressOk') : t('addressFail')) +
            (payload.device ? ' · ' + payload.device : '') +
            (payload.online ? '' : ' · ' + (payload.reason || ''))
          )
          await load()
          poke()
        } catch (err) {
          setTestResult(t('addressFail') + '：' + err.message)
        } finally {
          setTesting(false)
        }
      }

      const clearAddress = async () => {
        setTestResult('')
        try {
          for (const key of ['controlBaseUrl', 'generateBaseUrl']) {
            if (String(config.settings[key] ?? '') !== '') await api.setConfig(key, '')
          }
          await load()
          poke()
        } catch (err) {
          setError(err.message)
        }
      }

      if (config === null) {
        return h('div', { className: 'ld-body' },
          error !== '' ? Note({ children: error }) : h('div', { className: 'ld-empty' }, '…'))
      }

      const presetIds = Object.keys(config.modelPresets || {})

      return h('div', { className: 'ld-body' },
        error !== '' ? Note({ children: error }) : null,
        message !== '' ? Note({ info: true, children: message }) : null,

        h('div', { className: 'ld-field' },
          h('div', { className: 'ld-label' }, t('addressTitle')),
          h('div', { className: 'ld-capsule-row' },
            h('input', {
              className: 'ld-capsule-input',
              'aria-label': t('addressControl'),
              value: draft.controlBaseUrl === undefined ? '' : draft.controlBaseUrl,
              placeholder: active.controlBaseUrl || 'http://127.0.0.1:8808',
              onChange: (event) => setDraft(Object.assign({}, draft, { controlBaseUrl: event.target.value }))
            })),
          h('div', { className: 'ld-capsule-row' },
            h('input', {
              className: 'ld-capsule-input',
              'aria-label': t('addressGenerate'),
              value: draft.generateBaseUrl === undefined ? '' : draft.generateBaseUrl,
              placeholder: active.generateBaseUrl || 'http://127.0.0.1:8081',
              onChange: (event) => setDraft(Object.assign({}, draft, { generateBaseUrl: event.target.value }))
            })),
          h('div', { className: 'ld-hint' }, t('addressAuto')),
          h('div', { className: 'ld-hint' }, t('addressControl') + ' ' + active.controlBaseUrl + ' · ' + t('addressGenerate') + ' ' + active.generateBaseUrl),
          testResult !== '' ? h('div', { className: 'ld-hint' }, testResult) : null,
          h('div', { className: 'ld-footer' },
            h('button', {
              className: 'ld-btn ld-btn-sm',
              type: 'button',
              disabled: testing,
              onClick: saveAddress
            }, testing ? t('addressTesting') : t('addressTest')),
            h('button', {
              className: 'ld-btn ld-btn-sm',
              type: 'button',
              onClick: clearAddress
            }, t('addressReset')))),

        SETTING_FIELDS.map((field) => h(Field, {
          key: field.key,
          label: field.label,
          children: field.type === 'textarea'
            ? h('textarea', {
                className: 'ld-textarea',
                style: { minHeight: '64px' },
                value: draft[field.key] === undefined ? '' : draft[field.key],
                onChange: (event) => setDraft(Object.assign({}, draft, { [field.key]: event.target.value }))
              })
            : field.type === 'select'
              ? h('select', {
                  className: 'ld-select',
                  value: draft[field.key] === undefined ? '' : draft[field.key],
                  onChange: (event) => setDraft(Object.assign({}, draft, { [field.key]: event.target.value }))
                }, field.options.map((value) => h('option', { key: value, value }, value)))
              : h('input', {
                  className: 'ld-input',
                  type: field.type,
                  value: draft[field.key] === undefined ? '' : draft[field.key],
                  onChange: (event) => setDraft(Object.assign({}, draft, { [field.key]: event.target.value }))
                })
        })),

        presetIds.length > 0
          ? h('div', { className: 'ld-field' },
              h('div', { className: 'ld-label' }, 'models.json'),
              h('div', { className: 'ld-list' }, presetIds.map((id) => h('div', { className: 'ld-item', key: id },
                h('span', { className: 'ld-item-title' }, id),
                h('span', { className: 'ld-item-sub' }, JSON.stringify(config.modelPresets[id]))))))
          : null,

        h('div', { className: 'ld-field' },
          h('div', { className: 'ld-label' }, t('paths')),
          h('div', { className: 'ld-hint' },
            config.paths.settings + '\n' + config.paths.models + '\n' + config.paths.prompts)),

        h('div', { className: 'ld-footer' },
          h('button', { className: 'ld-btn ld-btn-primary', type: 'button', onClick: save }, t('save')),
          h('span', { className: 'ld-spacer' }),
          h('button', { className: 'ld-btn ld-btn-sm', type: 'button', onClick: resetAll }, t('resetAll'))))
    }
    //#endregion

    //#region 浮层
    function Overlay (props) {
      const t = makeT(props.t)
      const open = react.useSyncExternalStore(subscribePanel, getPanelOpen, getPanelOpen)
      const snap = react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const [tab, setTab] = react.useState('draw')
      const [templates, setTemplates] = react.useState(tabCache.templates || [])

      react.useEffect(() => {
        if (!open) return undefined
        void api.prompts()
          .then((payload) => {
            const next = payload.templates || []
            tabCache.templates = next
            setTemplates(next)
          })
          .catch(() => {})
        return undefined
      }, [open])

      react.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setPanelOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      if (!open) return null

      const tabs = [
        { id: 'draw', label: t('tabDraw') },
        { id: 'gallery', label: t('tabGallery') },
        { id: 'models', label: t('tabModels') },
        { id: 'prompts', label: t('tabPrompts') },
        { id: 'settings', label: t('tabSettings') }
      ]

      // 必须用 h(...) 而不是直接调用组件函数 —— 这些组件内部有 hooks，
      // 直接调用会把它们的 hooks 并进 Overlay 的序列，切标签时数量一变就炸。
      const body = tab === 'draw'
        ? h(DrawTab, { key: 'draw', t: props.t, templates, onTask: () => poke() })
        : tab === 'gallery'
          ? h(GalleryTab, { key: 'gallery', t: props.t })
          : tab === 'models'
            ? h(ModelsTab, { key: 'models', t: props.t })
            : tab === 'prompts'
              ? h(PromptsTab, { key: 'prompts', t: props.t, templates, onTemplates: setTemplates })
              : h(SettingsTab, { key: 'settings', t: props.t })

      return h('div', {
        className: 'ld-backdrop',
        onClick: (event) => {
          if (event.target === event.currentTarget) setPanelOpen(false)
        }
      },
      h('div', { className: 'ld-dialog', role: 'dialog', 'aria-label': t('title') },
        h('div', { className: 'ld-header' },
          h('h2', { className: 'ld-title' }, t('title')),
          h('button', {
            className: 'ld-close',
            type: 'button',
            onClick: () => setPanelOpen(false),
            'aria-label': t('close')
          }, '✕')),

        h('div', { className: 'ld-tabs' },
          tabs.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: cls('ld-tab', tab === item.id && 'ld-tab-on'),
            onClick: () => setTab(item.id)
          }, item.label))),

        body,

        snap.error
          ? h('div', { style: { padding: '0 18px 14px' } }, Note({ children: snap.error }))
          : null))
    }
    //#endregion

    const inject = ['slots', 'locale']

    function apply (ctx) {
      const removeStyle = injectStyle()

      ctx.effect(() => {
        ctx.locale.register(NS, { zh, en })
        return () => {
          if (ctx.locale.unregister) ctx.locale.unregister(NS)
          removeStyle()
        }
      }, 'dsh-localdream: locale')

      // 侧边栏底部的胶囊。list 槽位按 (priority, order) 升序排，
      // 「导出会话日志」pill 的 order 是 5，这枚取 3 —— 稳稳压在它上面。
      ctx.slots.inject('sidebar.footer.action', () => {
        return ctx.slots.register({ name: 'sidebar.footer.action', id: NS, order: 3, locale: NS }, SidebarPill)
      })

      ctx.slots.inject('shell.overlay', () => {
        return ctx.slots.register({ name: 'shell.overlay', id: NS, order: 12, locale: NS }, Overlay)
      })
    }

    return { inject, apply }
  }
})
