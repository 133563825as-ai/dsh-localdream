/**
 * dsh-localdream —— 把手机端 Local Dream 的本地 NPU 生图接进 DeepSeek Harness。
 *
 * 注册六个模型可见工具：
 * - `ld_status`  —— 受控模式在线状态、当前模型、已装模型与放大器清单
 * - `ld_select`  —— 显式挂载模型并等到可出图
 * - `ld_draw`    —— 文生图 / 图生图
 * - `ld_enhance` —— ×4 放大 / UltraFix 分块重绘
 * - `ld_config`  —— 容器里查看与修改使用偏好、per-model 参数预设
 * - `ld_prompt`  —— 容器里的提示词模板库
 *
 * 外加一个 Web 界面：输入框下方的状态条、侧边栏入口，以及点开后的完整面板。
 *
 * ## 两条硬约束
 *
 * **一、运行期零依赖。** 这个模块和它下面的一切都只 import Node 内置模块。
 * 装了插件的人**不需要**往插件目录里塞 `node_modules` 软链，也就不会有
 * 「在插件目录跑一次 npm install 却写进了宿主 node_modules」这类事故。
 * 详见 `define-tool.js` 顶部的说明。
 *
 * **二、模型是变的、机器是别人的。** 插件不内置任何具体模型 id、不预设任何画风偏好：
 * 基准尺寸与默认步数 / CFG / 采样器全部从后端 `/models` 现读。属于某台机器的偏好
 * 放在容器里的 JSON 文件里（`<DSH_HOME>/localdream/`），随时可查可改。
 *
 * @module dsh-localdream
 */

import { join } from 'node:path'

import { LocalDreamClient } from './client.js'
import { registerRoutes } from './http.js'
import { defaultOutputDir, resolveDshHome } from './output.js'
import {
  DEFAULT_GENERATE_TIMEOUT_MS,
  DEFAULT_MAX_BATCH,
  DEFAULT_SELECT_TIMEOUT_MS
} from './presets.js'
import { DrawService } from './service.js'
import { LocalDreamStore } from './store.js'
import { createConfigTool } from './tools/config.js'
import { createDrawTool } from './tools/draw.js'
import { createEnhanceTool } from './tools/enhance.js'
import { createPromptTool } from './tools/prompt.js'
import { createSelectTool } from './tools/select.js'
import { createStatusTool } from './tools/status.js'

export const name = 'dsh-localdream'

/** 需要工具注册表才能挂上工具。`webServer` 走可选注入，见 `apply`。 */
export const inject = ['tools']

/** 基础设施默认值。可用 profile 的 `cordis.patch.yml` 覆盖（见随包的 `cordis.patch.yml`）。 */
const CONFIG_DEFAULTS = Object.freeze({
  controlBaseUrl: 'http://127.0.0.1:8808',
  generateBaseUrl: 'http://127.0.0.1:8081',
  outputDir: '',
  defaultModel: '',
  maxBatch: DEFAULT_MAX_BATCH,
  generateTimeoutMs: DEFAULT_GENERATE_TIMEOUT_MS,
  selectTimeoutMs: DEFAULT_SELECT_TIMEOUT_MS,
  modelPresets: {}
})

function pickString (value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function pickPositiveNumber (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * 合并用户配置与默认值。这里刻意不依赖 schema 校验 —— 插件不导出 `Config`，
 * 于是也不需要 `@deepseek-ai/schemastery`；错的类型在这里被挡成默认值，
 * 不会让插件起不来。
 */
function resolveConfig (config) {
  const raw = (config !== null && typeof config === 'object') ? config : {}
  return {
    controlBaseUrl: pickString(raw.controlBaseUrl, CONFIG_DEFAULTS.controlBaseUrl),
    generateBaseUrl: pickString(raw.generateBaseUrl, CONFIG_DEFAULTS.generateBaseUrl),
    outputDir: typeof raw.outputDir === 'string' ? raw.outputDir.trim() : CONFIG_DEFAULTS.outputDir,
    defaultModel: pickString(raw.defaultModel, CONFIG_DEFAULTS.defaultModel),
    maxBatch: pickPositiveNumber(raw.maxBatch, CONFIG_DEFAULTS.maxBatch),
    generateTimeoutMs: pickPositiveNumber(raw.generateTimeoutMs, CONFIG_DEFAULTS.generateTimeoutMs),
    selectTimeoutMs: pickPositiveNumber(raw.selectTimeoutMs, CONFIG_DEFAULTS.selectTimeoutMs),
    modelPresets: (raw.modelPresets !== null && typeof raw.modelPresets === 'object' && !Array.isArray(raw.modelPresets))
      ? raw.modelPresets
      : {}
  }
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config]
 */
export function apply (ctx, config) {
  const dshHome = resolveDshHome(ctx)
  const root = join(dshHome, 'localdream')
  const resolved = resolveConfig(config)

  if (resolved.outputDir === '') resolved.outputDir = defaultOutputDir(dshHome)

  const client = new LocalDreamClient({
    controlBaseUrl: resolved.controlBaseUrl,
    generateBaseUrl: resolved.generateBaseUrl,
    defaultModel: resolved.defaultModel,
    generateTimeoutMs: resolved.generateTimeoutMs,
    log: (message) => ctx.logger?.info?.(message)
  })

  const store = new LocalDreamStore({ root })
  const getConfig = () => resolved
  const service = new DrawService({ client, store, getConfig })

  ctx.logger?.info?.(
    `dsh-localdream: 控制口 ${resolved.controlBaseUrl} · 生成口 ${resolved.generateBaseUrl} · ` +
      `输出 ${resolved.outputDir} · 配置 ${root}`
  )

  ctx.effect(function* registerTools () {
    yield ctx.tools.register(createStatusTool({ client }))
    yield ctx.tools.register(createSelectTool({ client }))
    yield ctx.tools.register(createDrawTool({ client, store, getConfig }))
    yield ctx.tools.register(createEnhanceTool({ client, store, getConfig }))
    yield ctx.tools.register(createConfigTool({ store, getConfig }))
    yield ctx.tools.register(createPromptTool({ store }))
  }, 'dsh-localdream.tools')

  // Web 界面用的数据面。可选注入：headless profile 里没有 webServer，
  // 那种情况下工具照常可用，只是没有界面。
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => registerRoutes({
        webServer: webCtx.webServer,
        client,
        store,
        service,
        getConfig
      }),
      'dsh-localdream: routes'
    )
  })
}
