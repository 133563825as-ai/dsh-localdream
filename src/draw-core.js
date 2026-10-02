/**
 * 出图核心：把「解析参数 → 确保后端 → 出图 → 落盘」这条链路抽出来。
 *
 * 模型工具（`ld_draw`）和 Web UI 的出图按钮都走这里 —— 一份实现，
 * 免得两条路径的参数解析规则慢慢跑偏。
 *
 * @module dsh-localdream/draw-core
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { imageInfo } from './png.js'
import { saveGeneratedImage } from './output.js'
import {
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_SELECT_TIMEOUT_MS,
  aspectSize,
  clampBatch,
  parseAspectRatio
} from './presets.js'
import { buildGenerateBody } from './request.js'
import { findModel, generationBase, normalizeModels, resolveDrawParams } from './tools/shared.js'

/**
 * 跑一次完整出图。
 *
 * @param {object} options
 * @param {import('./client.js').LocalDreamClient} options.client
 * @param {import('./store.js').LocalDreamStore} options.store
 * @param {object} options.config - 插件配置。
 * @param {object} options.args - 与 `ld_draw` 同名的入参。
 * @param {(progress: {step: number, totalSteps: number, index: number, count: number}) => void} [options.onProgress]
 * @param {(phase: string) => void} [options.onPhase]
 * @returns {Promise<object>} 与 `ld_draw` 返回结构一致。
 */
export async function runDraw ({ client, store, config, args = {}, onProgress, onPhase } = {}) {
  const notes = []
  const phase = (value) => onPhase?.(value)

  const settings = await store.readSettings()
  const filePresets = await store.readModelPresets()
  const presets = { ...config.modelPresets, ...filePresets }

  const templateName = typeof args.template === 'string' ? args.template.trim() : ''
  const template = templateName !== '' ? await store.readPrompt(templateName) : {}

  const prompt = (typeof args.prompt === 'string' ? args.prompt.trim() : '') ||
    String(template.prompt ?? '').trim()
  if (prompt === '') {
    throw new Error('prompt 不能为空：显式传一个，或者先用 ld_prompt 存好模板再用 template 套用。')
  }

  const maxBatch = settings.maxBatch ?? config.maxBatch
  const count = clampBatch(args.count ?? template.count ?? settings.defaultCount, maxBatch)

  const aspectRatio =
    (typeof args.aspectRatio === 'string' && args.aspectRatio.trim() !== '' ? args.aspectRatio.trim() : '') ||
    (typeof template.aspectRatio === 'string' && template.aspectRatio !== '' ? template.aspectRatio : '') ||
    settings.defaultAspectRatio ||
    '1:1'
  parseAspectRatio(aspectRatio)

  const outputFormat = args.outputFormat === 'jpeg'
    ? 'jpeg'
    : args.outputFormat === 'png'
      ? 'png'
      : settings.defaultOutputFormat === 'jpeg' ? 'jpeg' : 'png'

  const outputDir = typeof args.outputDir === 'string' && args.outputDir.trim() !== ''
    ? args.outputDir.trim()
    : config.outputDir
  const selectWaitMs = config.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS
  const timeoutMs = Number.isFinite(Number(args.timeoutSeconds)) && Number(args.timeoutSeconds) > 0
    ? Number(args.timeoutSeconds) * 1000
    : config.generateTimeoutMs

  // 1. 后端就绪。显式给了 model 就切过去，否则只保证后端活着。
  phase('selecting')
  const requestedModel =
    (typeof args.model === 'string' && args.model.trim() !== '' ? args.model.trim() : '') ||
    (typeof template.model === 'string' && template.model.trim() !== '' ? template.model.trim() : '') ||
    settings.defaultModel ||
    ''
  const backend = requestedModel !== ''
    ? await client.selectAndWait({ modelId: requestedModel, waitMs: selectWaitMs })
    : await client.ensureBackend({ waitMs: selectWaitMs })
  const modelId = backend.modelId
  if (!backend.reused) notes.push('后端刚完成一次冷启动，第二张起才会回到热态速度。')

  // 2. 模型信息：基准尺寸与后端默认参数。全部现读，不写死。
  let model
  try {
    model = findModel(normalizeModels(await client.models()), modelId)
  } catch (error) {
    notes.push(`读取模型清单失败，改用全局兜底参数：${error instanceof Error ? error.message : error}`)
  }
  const size = aspectSize(aspectRatio, generationBase(model))

  // 3. 生成参数。
  const params = resolveDrawParams({ args, template, presets, modelId, model })

  // 4. 图生图输入图。
  let imageBase64
  let denoiseStrength = 1.0
  let sourceImage
  if (typeof args.image === 'string' && args.image.trim() !== '') {
    sourceImage = args.image.trim()
    const path = resolve(sourceImage)
    let buffer
    try {
      buffer = await readFile(path)
    } catch (error) {
      throw new Error(`读不到输入图 ${path}：${error instanceof Error ? error.message : error}`)
    }
    const info = imageInfo(buffer)
    if (info.format === 'unknown') {
      throw new Error(`识别不出输入图格式（${path}）：需要 PNG、JPEG、GIF、WebP 或 BMP`)
    }
    if (info.width > 0 && (info.width !== size.width || info.height !== size.height)) {
      throw new Error(
        `图生图输入图尺寸必须是 ${size.width}×${size.height} —— 这是 aspectRatio "${aspectRatio}" 的换算值。` +
          `当前输入图是 ${info.width}×${info.height}。先标准化再重试：` +
          `convert in.png -resize ${size.width}x${size.height}^ -gravity center -extent ${size.width}x${size.height} out.png`
      )
    }
    imageBase64 = buffer.toString('base64')
    denoiseStrength = Number.isFinite(Number(args.denoise)) ? Number(args.denoise) : 0.85
  }

  const negativePrompt = typeof args.negativePrompt === 'string'
    ? args.negativePrompt
    : (typeof template.negativePrompt === 'string' && template.negativePrompt !== ''
        ? template.negativePrompt
        : (settings.defaultNegativePrompt ?? DEFAULT_NEGATIVE_PROMPT))

  if (params.cfg <= 1.0 && negativePrompt !== '') {
    notes.push(`cfg = ${params.cfg} 时后端不建负面分支，negativePrompt 不会生效。要让它生效请把 cfg 提到 5~7。`)
  }

  // 5. 逐张生成并落盘。
  const startedAt = Date.now()
  const files = []
  for (let index = 0; index < count; index += 1) {
    const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) + index : undefined
    const body = buildGenerateBody({
      prompt,
      negativePrompt,
      steps: params.steps,
      cfg: params.cfg,
      scheduler: params.scheduler,
      width: size.width,
      height: size.height,
      aspectRatio,
      seed,
      imageBase64,
      denoiseStrength,
      outputFormat
    })

    phase('generating')
    const complete = await client.generate(body, {
      timeoutMs,
      onProgress: (progress) => onProgress?.({ ...progress, index, count })
    })
    phase('saving')
    const saved = await saveGeneratedImage(complete, { outputDir, index, outputFormat })
    files.push({ ...saved, elapsedMs: complete.elapsedMs })
  }

  phase('done')
  return {
    mode: imageBase64 === undefined ? 'txt2img' : 'img2img',
    modelId,
    sourceImage: sourceImage ?? null,
    template: templateName !== '' ? templateName : null,
    denoise: denoiseStrength,
    aspectRatio,
    size,
    params,
    prompt,
    negativePrompt,
    outputDir,
    files,
    totalElapsedMs: Date.now() - startedAt,
    notes
  }
}
