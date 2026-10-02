/**
 * 常量与纯函数：宽高比换算、参数解析顺序、默认提示词。
 *
 * 这个模块不碰网络、不碰文件系统，全部逻辑都能在离线单测里覆盖。
 *
 * @module dsh-localdream/presets
 */

/** `scheduler` 的合法标识符，来自 Local Dream 的 `utils/SchedulerNames.kt`。 */
export const SCHEDULERS = [
  'dpm',
  'dpm_karras',
  'euler_a',
  'euler_a_karras',
  'lcm',
  'euler',
  'euler_karras',
  'dpm_sde',
  'dpm_sde_karras'
]

/**
 * 常用宽高比。`aspect_ratio` 是**真正决定成图尺寸**的字段：
 * 长边固定为模型的 `generation_size`（通常 1024），短边按比例换算后向 8 的倍数取整。
 */
export const ASPECT_RATIOS = [
  '1:1',
  '4:3',
  '3:2',
  '16:10',
  '16:9',
  '2:1',
  '3:4',
  '9:16'
]

/** 通用负面提示词。CFG=1.0 时后端不建负分支，写了也不生效。 */
export const DEFAULT_NEGATIVE_PROMPT =
  'lowres, bad anatomy, bad hands, missing fingers, extra fingers, extra digits, ' +
  'deformed, mutated, ugly, disfigured, poorly drawn face, fused face, cloned face, ' +
  'worst quality, bad quality, jpeg artifacts, text, watermark, signature'

/** 模型表与预设都没命中时的全局兜底。 */
export const FALLBACK_PARAMS = Object.freeze({
  steps: 20,
  cfg: 7.0,
  scheduler: 'dpm'
})

/** 单次连出张数上限：手机 NPU 连出更多会持续高负载、发热甚至顶掉内存。 */
export const DEFAULT_MAX_BATCH = 2

/** 一次生成请求的默认超时。冷启动可能 90s+，留足余量。 */
export const DEFAULT_GENERATE_TIMEOUT_MS = 15 * 60 * 1000

/** 挂载模型后等待就绪的默认时长。 */
export const DEFAULT_SELECT_TIMEOUT_MS = 4 * 60 * 1000

/**
 * 把 8 位无符号整数向下取整到 8 的倍数。
 * @param {number} value
 * @returns {number}
 */
export function floorTo8 (value) {
  return Math.floor(value / 8) * 8
}

/**
 * 解析 `"宽:高"` 形式的宽高比。
 * @param {string} ratio - 例如 `"3:2"`。
 * @returns {{a: number, b: number}} 归一化后的正比例。
 */
export function parseAspectRatio (ratio) {
  const text = String(ratio ?? '').trim()
  const match = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (match === null) {
    throw new Error(`宽高比格式应为 "宽:高"（例如 "1:1"、"3:2"），收到 "${text}"`)
  }
  const a = Number(match[1])
  const b = Number(match[2])
  if (!(a > 0) || !(b > 0)) throw new Error(`宽高比必须为正数，收到 "${text}"`)
  return { a, b }
}

/**
 * 由宽高比算出后端实际出图尺寸。
 *
 * 长边固定为 `base`，短边按比例换算后向 8 的倍数取整（3:2 → 682.7 → **680**）。
 * 与 Local Dream 后端自身的换算规则一致。
 *
 * @param {string} ratio - 例如 `"3:2"`。
 * @param {number} [base] - 长边像素，默认取模型的 `generation_size`。
 * @returns {{width: number, height: number}}
 */
export function aspectSize (ratio, base = 1024) {
  const { a, b } = parseAspectRatio(ratio)
  const long = Math.max(8, floorTo8(base))
  const short = Math.max(8, floorTo8((long * Math.min(a, b)) / Math.max(a, b)))
  return a >= b ? { width: long, height: short } : { width: short, height: long }
}

/**
 * 参数来源的优先级顺序，从高到低。
 * 想解释「这个步数到底从哪来的」时按这个顺序找。
 */
export const PARAM_SOURCES = ['explicit', 'template', 'preset', 'model-defaults', 'fallback']

/**
 * 按优先级解析生成参数。
 *
 * 顺序是有意的，跨模型也成立：
 * 1. `explicit` —— 调用方这次显式传的值
 * 2. `template` —— 提示词模板里带的参数
 * 3. `preset` —— 容器里为该模型存的预设
 * 4. `model-defaults` —— 后端 `/models` 报出的该模型默认值
 * 5. `fallback` —— 全局兜底
 *
 * 第 4 层是关键：它让插件适配任意模型，而不是绑定某一台机器上装了什么。
 *
 * @param {object} sources
 * @param {object} [sources.explicit] - 调用方显式传入，`undefined` / `null` 视为未传。
 * @param {object} [sources.template] - 提示词模板里带的参数。
 * @param {object} [sources.preset] - 容器里为该模型存的预设。
 * @param {object} [sources.defaults] - 后端报告的该模型默认值。
 * @returns {{steps: number, cfg: number, scheduler: string, source: string}}
 */
export function resolveParams ({ explicit = {}, template = {}, preset = {}, defaults = {} } = {}) {
  const layers = [
    ['explicit', explicit],
    ['template', template],
    ['preset', preset],
    ['model-defaults', defaults]
  ]

  const pick = (key) => {
    for (const [from, layer] of layers) {
      const value = layer?.[key]
      if (value !== undefined && value !== null) return { value, from }
    }
    return { value: FALLBACK_PARAMS[key], from: 'fallback' }
  }

  const steps = pick('steps')
  const cfg = pick('cfg')
  const scheduler = pick('scheduler')

  // 以「优先级最高」的那个来源作为整体来源标签，用于向调用方解释参数从哪来。
  const source = [steps, cfg, scheduler]
    .map((item) => PARAM_SOURCES.indexOf(item.from))
    .sort((x, y) => x - y)[0]

  return {
    steps: Number(steps.value),
    cfg: Number(cfg.value),
    scheduler: String(scheduler.value),
    source: PARAM_SOURCES[source]
  }
}

/**
 * 把连出张数夹到 `1..maxBatch`。超出即报错，不静默截断 ——
 * 悄悄少出一张比报错更难查。
 *
 * @param {number|undefined} count
 * @param {number} maxBatch
 * @returns {number}
 */
export function clampBatch (count, maxBatch) {
  const value = count === undefined || count === null ? 1 : Number(count)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`张数必须是正整数，收到 ${JSON.stringify(count)}`)
  }
  if (value > maxBatch) {
    throw new Error(
      `张数最多 ${maxBatch}：手机 NPU 一次连出更多会发热、顶内存。需要更多张请分多次调用。`
    )
  }
  return value
}
