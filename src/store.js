/**
 * 容器内可读写的本地配置与提示词库。
 *
 * 全部落在 `<DSH_HOME>/localdream/` 下，都是普通 JSON，可以直接在容器里用
 * 编辑器 / `cat` / `jq` 查看和修改：
 *
 * ```
 * localdream/
 * ├── settings.json    使用偏好：默认负面词、默认比例、默认张数、默认模型…
 * ├── models.json      per-model 参数预设 { "<模型id>": { steps, cfg, scheduler } }
 * ├── prompts/         提示词模板，一个模板一个 JSON
 * └── out/             出图输出
 * ```
 *
 * **每次调用都重新读盘**，所以改完立刻生效，不需要重启宿主。
 *
 * @module dsh-localdream/store
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  DEFAULT_MAX_BATCH,
  DEFAULT_NEGATIVE_PROMPT,
  SCHEDULERS,
  parseAspectRatio
} from './presets.js'

/** 提示词模板名允许的字符。挡住路径穿越与非法文件名。 */
export const PROMPT_NAME_PATTERN = /^[^\u0000-\u001f/\\:*?"<>|]{1,64}$/

/** 全局使用偏好的默认值。 */
export const DEFAULT_SETTINGS = Object.freeze({
  defaultNegativePrompt: DEFAULT_NEGATIVE_PROMPT,
  defaultAspectRatio: '1:1',
  defaultCount: 1,
  defaultOutputFormat: 'png',
  defaultModel: '',
  maxBatch: DEFAULT_MAX_BATCH,
  // 空串 = 用插件内置的 127.0.0.1:8808 / 8081。只有把 Local Dream 跑在别处
  // （另一台设备、端口转发…）时才需要填。
  controlBaseUrl: '',
  generateBaseUrl: ''
})

/**
 * 校验一个服务地址。只接受 `http(s)://host[:port]` 形式，且不接受查询串与路径 ——
 * 请求时是拿它去拼 `/info`、`/generate` 的，带路径会拼出意料之外的 URL。
 * @param {string} value
 * @returns {string} 去掉尾部斜杠的地址。
 */
export function assertBaseUrl (value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return ''
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error(`地址格式不对："${text}"，应该长这样：http://127.0.0.1:8808`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('地址必须以 http:// 或 https:// 开头')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('地址里不要带查询串或锚点')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('地址里不要带路径，只填到端口为止')
  }
  return `${url.origin}`
}

/** 每个设置键的类型与取值范围。`set` 时据此校验。 */
export const SETTINGS_KEYS = Object.freeze({
  defaultNegativePrompt: { type: 'string' },
  defaultAspectRatio: { type: 'string', validate: (value) => { parseAspectRatio(value); return value } },
  defaultCount: { type: 'number', integer: true, min: 1, max: 8 },
  defaultOutputFormat: { type: 'string', oneOf: ['png', 'jpeg'] },
  defaultModel: { type: 'string' },
  maxBatch: { type: 'number', integer: true, min: 1, max: 8 },
  controlBaseUrl: { type: 'string', validate: assertBaseUrl },
  generateBaseUrl: { type: 'string', validate: assertBaseUrl }
})

/** per-model 预设的键。 */
export const MODEL_PRESET_KEYS = Object.freeze({
  steps: { type: 'number', integer: true, min: 1, max: 200 },
  cfg: { type: 'number', min: 0, max: 30 },
  scheduler: { type: 'string', oneOf: [...SCHEDULERS] }
})

/**
 * 校验提示词模板名。
 * @param {unknown} name
 * @returns {string}
 */
export function assertPromptName (name) {
  const value = typeof name === 'string' ? name.trim() : ''
  if (value === '') throw new Error('模板名不能为空')
  if (!PROMPT_NAME_PATTERN.test(value)) {
    throw new Error('模板名不能包含 / \\ : * ? " < > | 或控制字符，长度上限 64')
  }
  return value
}

/**
 * 按声明把入参转成目标类型并校验。
 * @param {string} key
 * @param {unknown} raw
 * @param {object} spec
 * @returns {string|number}
 */
export function coerceValue (key, raw, spec) {
  if (spec.type === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${key} 需要数字，收到 ${JSON.stringify(raw)}`)
    if (spec.integer === true && !Number.isInteger(value)) throw new Error(`${key} 需要整数，收到 ${value}`)
    if (spec.min !== undefined && value < spec.min) throw new Error(`${key} 不能小于 ${spec.min}`)
    if (spec.max !== undefined && value > spec.max) throw new Error(`${key} 不能大于 ${spec.max}`)
    return value
  }

  const value = typeof raw === 'string' ? raw : String(raw ?? '')
  if (spec.oneOf !== undefined && !spec.oneOf.includes(value)) {
    throw new Error(`${key} 只能是 ${spec.oneOf.join(' / ')}，收到 "${value}"`)
  }
  if (spec.validate !== undefined) return spec.validate(value)
  return value
}

function isPlainObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonFile (path) {
  try {
    const text = await readFile(path, 'utf-8')
    if (text.trim() === '') return null
    return JSON.parse(text)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error instanceof SyntaxError) throw new Error(`${path} 不是合法 JSON：${error.message}`)
    throw error
  }
}

/** 原子写：先写临时文件再 rename，避免读到写了一半的内容。 */
async function writeJsonFile (path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
  await rename(temporary, path)
}

export class LocalDreamStore {
  /**
   * @param {object} options
   * @param {string} options.root - 数据根目录，通常是 `<DSH_HOME>/localdream`。
   */
  constructor ({ root }) {
    if (typeof root !== 'string' || root === '') throw new Error('store root 不能为空')
    this.root = root
  }

  /** 所有相关路径，回报给使用者时用。 */
  get paths () {
    return {
      root: this.root,
      settings: join(this.root, 'settings.json'),
      models: join(this.root, 'models.json'),
      prompts: join(this.root, 'prompts'),
      output: join(this.root, 'out')
    }
  }

  /**
   * 读全局设置，缺失项用内置默认补齐。
   * @returns {Promise<object>}
   */
  async readSettings () {
    const raw = await readJsonFile(this.paths.settings)
    const merged = { ...DEFAULT_SETTINGS }
    if (isPlainObject(raw)) {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (raw[key] !== undefined && raw[key] !== null) merged[key] = raw[key]
      }
    }
    return merged
  }

  /**
   * 改全局设置里的一个键。
   * @param {string} key
   * @param {unknown} value
   * @returns {Promise<object>} 写入后的完整设置。
   */
  async setSetting (key, value) {
    const spec = SETTINGS_KEYS[key]
    if (spec === undefined) {
      throw new Error(`未知的设置键 "${key}"。可用：${Object.keys(SETTINGS_KEYS).join(', ')}`)
    }
    const current = await this.readSettings()
    current[key] = coerceValue(key, value, spec)
    await writeJsonFile(this.paths.settings, current)
    return current
  }

  /**
   * 重置设置。`key` 为空表示全部恢复默认。
   * @param {string} [key]
   * @returns {Promise<object>}
   */
  async resetSettings (key) {
    if (key === undefined || key === '') {
      await unlink(this.paths.settings).catch(() => {})
      return { ...DEFAULT_SETTINGS }
    }
    const spec = SETTINGS_KEYS[key]
    if (spec === undefined) {
      throw new Error(`未知的设置键 "${key}"。可用：${Object.keys(SETTINGS_KEYS).join(', ')}`)
    }
    const current = await this.readSettings()
    current[key] = DEFAULT_SETTINGS[key]
    await writeJsonFile(this.paths.settings, current)
    return current
  }

  /**
   * 读 per-model 参数预设表。
   * @returns {Promise<Record<string, object>>}
   */
  async readModelPresets () {
    const raw = await readJsonFile(this.paths.models)
    return isPlainObject(raw) ? raw : {}
  }

  /**
   * 改某个模型的一个参数预设键。
   * @param {string} modelId
   * @param {string} key
   * @param {unknown} value
   */
  async setModelPreset (modelId, key, value) {
    const id = typeof modelId === 'string' ? modelId.trim() : ''
    if (id === '') throw new Error('models.<模型id>.<键> 里的模型 id 不能为空')
    const spec = MODEL_PRESET_KEYS[key]
    if (spec === undefined) {
      throw new Error(`未知的模型预设键 "${key}"。可用：${Object.keys(MODEL_PRESET_KEYS).join(', ')}`)
    }
    const presets = await this.readModelPresets()
    presets[id] = { ...(isPlainObject(presets[id]) ? presets[id] : {}), [key]: coerceValue(key, value, spec) }
    await writeJsonFile(this.paths.models, presets)
    return presets
  }

  /**
   * 删掉某个模型的整套预设；`modelId` 为空表示清空全部。
   * @param {string} [modelId]
   */
  async resetModelPresets (modelId) {
    const id = typeof modelId === 'string' ? modelId.trim() : ''
    if (id === '') {
      await unlink(this.paths.models).catch(() => {})
      return {}
    }
    const presets = await this.readModelPresets()
    delete presets[id]
    if (Object.keys(presets).length === 0) await unlink(this.paths.models).catch(() => {})
    else await writeJsonFile(this.paths.models, presets)
    return presets
  }

  /**
   * 列出全部提示词模板。
   * @returns {Promise<Array<object>>}
   */
  async listPrompts () {
    let entries = []
    try {
      entries = await readdir(this.paths.prompts)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }

    const templates = []
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json')) continue
      const name = entry.slice(0, -'.json'.length)
      const raw = await readJsonFile(join(this.paths.prompts, entry)).catch(() => null)
      if (!isPlainObject(raw)) continue
      templates.push({ name, ...raw })
    }
    return templates
  }

  /**
   * 读一个模板。
   * @param {string} name
   * @returns {Promise<object>}
   */
  async readPrompt (name) {
    const safe = assertPromptName(name)
    const raw = await readJsonFile(join(this.paths.prompts, `${safe}.json`))
    if (!isPlainObject(raw)) throw new Error(`没有名为 "${safe}" 的提示词模板`)
    return { name: safe, ...raw }
  }

  /**
   * 新建或覆盖一个模板。未传的字段保留原值，新建时用空值。
   * @param {string} name
   * @param {object} patch
   * @returns {Promise<object>} 写入后的模板。
   */
  async writePrompt (name, patch) {
    const safe = assertPromptName(name)
    let existing = {}
    try {
      existing = await this.readPrompt(safe)
    } catch {
      existing = {}
    }

    const next = { ...existing, ...patch, name: safe }

    if (next.prompt !== undefined && String(next.prompt).trim() === '') next.prompt = ''
    if (next.aspectRatio !== undefined && next.aspectRatio !== null && String(next.aspectRatio) !== '') {
      parseAspectRatio(String(next.aspectRatio))
    }
    if (next.scheduler !== undefined && next.scheduler !== null && String(next.scheduler) !== '') {
      if (!SCHEDULERS.includes(String(next.scheduler))) {
        throw new Error(`scheduler 只能是 ${SCHEDULERS.join(' / ')}`)
      }
    }
    if (next.steps !== undefined && next.steps !== null) {
      next.steps = coerceValue('steps', next.steps, MODEL_PRESET_KEYS.steps)
    }
    if (next.cfg !== undefined && next.cfg !== null) {
      next.cfg = coerceValue('cfg', next.cfg, MODEL_PRESET_KEYS.cfg)
    }
    if (String(next.prompt ?? '').trim() === '' && String(existing.prompt ?? '').trim() === '') {
      throw new Error('新建模板时必须提供 prompt')
    }

    next.updatedAt = new Date().toISOString()
    await mkdir(this.paths.prompts, { recursive: true })
    await writeJsonFile(join(this.paths.prompts, `${safe}.json`), next)
    return next
  }

  /**
   * 删除一个模板。
   * @param {string} name
   * @returns {Promise<string>} 被删掉的模板名。
   */
  async removePrompt (name) {
    const safe = assertPromptName(name)
    try {
      await unlink(join(this.paths.prompts, `${safe}.json`))
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`没有名为 "${safe}" 的提示词模板`)
      throw error
    }
    return safe
  }
}
