/**
 * 工具之间共用的小工具函数。
 * @module dsh-localdream/tools/shared
 */

import { resolveParams } from '../presets.js'

/**
 * 把一段文本包成工具结果内容块。
 * @param {string} value
 * @returns {Array<{type: 'text', text: string}>}
 */
export const text = (value) => [{ type: 'text', text: value }]

/**
 * 整理 `/models` 的返回，只留下调用方需要的东西。
 * @param {object|null} listing
 * @returns {Array<object>}
 */
export function normalizeModels (listing) {
  const entries = Array.isArray(listing?.models) ? listing.models : []
  return entries.map((entry) => ({
    id: entry.id,
    generationSize: Number(entry.generation_size ?? entry.generationSize ?? 1024) || 1024,
    isSdxl: Boolean(entry.is_sdxl ?? entry.isSdxl),
    isAnima: Boolean(entry.is_anima ?? entry.isAnima),
    defaults: {
      steps: entry.defaults?.steps,
      cfg: entry.defaults?.cfg,
      scheduler: entry.defaults?.scheduler
    }
  }))
}

/**
 * 整理放大器列表。`id` 与 `path` 都能当 `upscaler` 参数传给 `ld_enhance`。
 * @param {object|null} listing
 * @returns {Array<{id: string, path: string}>}
 */
export function normalizeUpscalers (listing) {
  const entries = Array.isArray(listing?.upscalers) ? listing.upscalers : []
  return entries.map((entry) => ({ id: entry.id, path: entry.path }))
}

/**
 * 在模型列表里按 id 精确查找。
 * @param {Array<object>} models
 * @param {string} modelId
 * @returns {object|undefined}
 */
export function findModel (models, modelId) {
  if (typeof modelId !== 'string' || modelId === '') return undefined
  return models.find((model) => model.id === modelId)
}

/**
 * 取模型的长边基准像素。`aspect_ratio` 的换算以它为长边。
 * @param {object|undefined} model
 * @returns {number}
 */
export function generationBase (model) {
  const size = Number(model?.generationSize ?? 0)
  return Number.isFinite(size) && size > 0 ? size : 1024
}

/**
 * 按「显式入参 → 提示词模板 → 容器预设 → 后端模型默认值 → 全局兜底」解析步数 / CFG / 采样器。
 *
 * @param {object} options
 * @param {object} options.args - 工具入参。
 * @param {object} [options.template] - `ld_prompt` 里取出的模板。
 * @param {object} [options.presets] - 容器 `models.json` 里的 per-model 预设表。
 * @param {string} [options.modelId] - 当前实际挂载的模型 id。
 * @param {object} [options.model] - `normalizeModels` 之后的模型条目。
 * @returns {{steps: number, cfg: number, scheduler: string, source: string}}
 */
export function resolveDrawParams ({ args, template = {}, presets = {}, modelId = '', model }) {
  const preset = (modelId !== '' && presets[modelId] !== undefined) ? presets[modelId] : {}
  return resolveParams({
    explicit: { steps: args.steps, cfg: args.cfg, scheduler: args.scheduler },
    template: { steps: template?.steps, cfg: template?.cfg, scheduler: template?.scheduler },
    preset,
    defaults: model?.defaults ?? {}
  })
}

/**
 * 人类可读的数字：整数不带小数点，小数最多两位。
 * @param {number} value
 * @returns {string}
 */
export function num (value) {
  if (!Number.isFinite(value)) return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 把字节数写成带单位的短字符串。
 * @param {number} bytes
 * @returns {string}
 */
export function humanBytes (bytes) {
  if (!Number.isFinite(bytes)) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
