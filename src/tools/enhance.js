/**
 * `ld_enhance` —— 放大（`/upscale`）与分块重绘（UltraFix）。
 *
 * 两条路线的分工必须先说清楚，这是最容易搞混的地方：
 * - `/upscale` 固定放大 4 倍，**不重绘**，输入是 raw RGB24。
 * - UltraFix **不放大**，它吃一张已经是目标尺寸的大图，按 tile 切开做分块 img2img 再混合重叠区。
 *
 * 所以「想要高清大图」的正确顺序是：出图 → upscale → ultrafix。
 *
 * @module dsh-localdream/tools/enhance
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defineTool } from '../define-tool.js'

import { defaultOutputDir, saveBuffer, saveGeneratedImage } from '../output.js'
import { decodePng, imageInfo } from '../png.js'
import {
  DEFAULT_SELECT_TIMEOUT_MS,
  SCHEDULERS,
  clampBatch
} from '../presets.js'
import { buildGenerateBody, validateUltrafixSize } from '../request.js'
import { LocalDreamUnavailableError } from '../client.js'
import {
  findModel,
  humanBytes,
  normalizeModels,
  normalizeUpscalers,
  num,
  resolveDrawParams,
  text
} from './shared.js'

/**
 * 把 `decodePng` 的结果统一成 raw RGB24。
 * 灰度图要逐像素扩展成三通道，否则 `/upscale` 的字节数校验会挂。
 *
 * @param {{channels: number, data: Buffer}} decoded
 * @returns {Buffer} 长度 = `width * height * 3`。
 */
export function toRgb24 (decoded) {
  if (decoded.channels === 3) return decoded.data
  if (decoded.channels !== 1) {
    throw new Error(`不支持的通道数：${decoded.channels}（只支持 1 或 3）`)
  }
  const pixels = decoded.data.length
  const out = Buffer.allocUnsafe(pixels * 3)
  for (let i = 0; i < pixels; i += 1) {
    const value = decoded.data[i]
    out[i * 3] = value
    out[i * 3 + 1] = value
    out[i * 3 + 2] = value
  }
  return out
}

/**
 * 挑一个放大器。id 与路径都能匹配。
 * @param {Array<{id: string, path: string}>} upscalers
 * @param {string} [wanted]
 * @returns {{id: string, path: string}}
 */
export function pickUpscaler (upscalers, wanted) {
  if (upscalers.length === 0) {
    throw new Error(
      '设备上没有可用的放大模型。请先在 Local Dream App 里下载一个放大器（例如 Real-ESRGAN x4），再重试。'
    )
  }
  const key = typeof wanted === 'string' ? wanted.trim() : ''
  if (key === '') {
    if (upscalers.length === 1) return upscalers[0]
    throw new Error(
      `设备上有 ${upscalers.length} 个放大器（${upscalers.map((item) => item.id).join(', ')}），请用 upscaler 参数指定一个。`
    )
  }
  const hit = upscalers.find((item) => item.id === key || item.path === key)
  if (hit === undefined) {
    throw new Error(
      `找不到放大器 "${key}"。可用：${upscalers.map((item) => `${item.id}（${item.path}）`).join('；')}`
    )
  }
  return hit
}

function renderEnhance (value) {
  const lines = []
  if (value.mode === 'upscale') {
    lines.push(`放大完成（×4）· \`${value.upscaler.id}\``)
  } else {
    lines.push(
      `分块重绘完成（UltraFix）· 模型 \`${value.modelId}\` · ${value.size.width}×${value.size.height} · ` +
        `tile ${value.tileSize} · denoise ${num(value.denoise)}`
    )
  }
  lines.push('')
  lines.push(`![Local Dream 增强结果](${value.path})`)
  lines.push(
    `- \`${value.path}\` · ${value.outWidth}×${value.outHeight} · ` +
      `${value.format.toUpperCase()} · ${humanBytes(value.bytes)} · ${(value.elapsedMs / 1000).toFixed(1)}s`
  )
  lines.push('')
  lines.push(`输入图：\`${value.sourceImage}\`（${value.inWidth}×${value.inHeight}）`)
  if (value.notes.length > 0) {
    lines.push('')
    for (const note of value.notes) lines.push(`> ${note}`)
  }
  return lines.join('\n')
}

/**
 * @param {object} deps
 * @param {import('../client.js').LocalDreamClient} deps.client
 * @param {import('../store.js').LocalDreamStore} deps.store
 * @param {() => object} deps.getConfig
 */
export function createEnhanceTool ({ client, store, getConfig }) {
  return defineTool({
    name: 'ld_enhance',
    description:
      '把已有图片变大或变清晰。mode="upscale" 走 /upscale，固定放大 4 倍、不重绘，输入必须是 PNG（后端要求 raw RGB24 请求体）。' +
      'mode="ultrafix" 走分块重绘：它**不放大**，吃的是一张已经是目标尺寸的大图，按 tile 切开做 img2img 再混合重叠区，需要 prompt。' +
      '想要高清大图的顺序是：ld_draw 出图 → upscale → ultrafix。' +
      'UltraFix 只被 SD1.5 QNN 与 SDXL QNN 后端支持，MNN / Anima / DiT 后端会直接报不支持。',
    parameters: {
      mode: {
        type: 'string',
        required: true,
        enum: ['upscale', 'ultrafix'],
        description: 'upscale 是 ×4 放大；ultrafix 是分块重绘大图。'
      },
      image: {
        type: 'string',
        required: true,
        description: '输入图路径。upscale 必须是 PNG；ultrafix 支持 PNG 与 JPEG。'
      },
      prompt: {
        type: 'string',
        description: 'UltraFix 重绘提示词，**必填** —— 它是重绘，不是纯放大。'
      },
      negativePrompt: { type: 'string', description: 'UltraFix 的负面提示词（cfg > 1 时生效）。' },
      model: {
        type: 'string',
        description: 'UltraFix 用哪个模型。不传则沿用后端当前热着的模型。'
      },
      steps: { type: 'number', description: 'UltraFix 步数，缺省按模型默认值。' },
      cfg: { type: 'number', description: 'UltraFix 的 CFG，缺省按模型默认值。' },
      scheduler: { type: 'string', enum: [...SCHEDULERS], description: 'UltraFix 采样器。' },
      denoise: {
        type: 'number',
        description: 'UltraFix 重绘强度，默认 0.4。调高会更贴 prompt、但更容易跑偏原图。'
      },
      tileSize: {
        type: 'number',
        description: 'UltraFix 分块边长，默认 512，必须是 8 的倍数。SDXL 后端会忽略它、固定用 1024。'
      },
      upscaler: {
        type: 'string',
        description: 'upscale 用哪个放大器，填 id 或路径。设备上只有一个时可以省略。'
      },
      useOpencl: { type: 'boolean', description: 'upscale 走 MNN 放大器时是否启用 OpenCL。' },
      outputFormat: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'UltraFix 的落盘格式，默认 jpeg（大图 PNG 体积很夸张）。upscale 的输出由后端固定为 JPEG。'
      },
      outputDir: { type: 'string', description: '输出目录，默认插件配置的 outputDir。' },
      timeoutSeconds: { type: 'number', description: '超时上限秒数，默认 900。' }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => text(renderEnhance(value))
    },
    timeoutMs: 30 * 60 * 1000,
    async execute (args) {
      const config = getConfig()
      const mode = args.mode
      if (mode !== 'upscale' && mode !== 'ultrafix') {
        throw new Error(`mode 只能是 "upscale" 或 "ultrafix"，收到 ${JSON.stringify(mode)}`)
      }

      const imagePath = resolve(String(args.image ?? ''))
      if (imagePath === '' || imagePath === resolve('')) throw new Error('image 不能为空')

      let buffer
      try {
        buffer = await readFile(imagePath)
      } catch (error) {
        throw new Error(`读不到输入图 ${imagePath}：${error instanceof Error ? error.message : error}`)
      }

      const info = imageInfo(buffer)
      if (info.format === 'unknown') {
        throw new Error(`识别不出输入图格式：${imagePath}（支持 PNG / JPEG / GIF / WebP / BMP）`)
      }
      if (!(info.width > 0) || !(info.height > 0)) {
        throw new Error(`读不出输入图尺寸：${imagePath}（文件可能已损坏，或是不含尺寸头的 JPEG）`)
      }

      const outputDir = typeof args.outputDir === 'string' && args.outputDir.trim() !== ''
        ? args.outputDir.trim()
        : config.outputDir
      const timeoutMs = Number.isFinite(Number(args.timeoutSeconds)) && Number(args.timeoutSeconds) > 0
        ? Number(args.timeoutSeconds) * 1000
        : config.generateTimeoutMs

      if (mode === 'upscale') {
        return runUpscale({ args, client, buffer, info, imagePath, outputDir, timeoutMs })
      }

      // 参数同样按「显式 → 容器预设 → 后端模型默认值 → 全局兜底」解析，不绑定具体模型。
      const filePresets = await store.readModelPresets()
      const presets = { ...config.modelPresets, ...filePresets }

      return runUltrafix({
        args,
        client,
        config,
        presets,
        buffer,
        info,
        imagePath,
        outputDir,
        timeoutMs
      })
    }
  })
}

async function runUpscale ({ args, client, buffer, info, imagePath, outputDir, timeoutMs }) {
  if (info.format !== 'png') {
    throw new Error(
      `/upscale 的请求体必须是 raw RGB24，而插件只能解 PNG 像素。当前输入是 ${info.format.toUpperCase()}，` +
        `请先转成 PNG：convert in.${info.format} out.png（ld_draw 默认就是 png，可以直接喂给它）`
    )
  }

  const decoded = decodePng(buffer)
  const rgb = toRgb24(decoded)

  let upscalers = []
  try {
    upscalers = normalizeUpscalers(await client.models())
  } catch (error) {
    if (error instanceof LocalDreamUnavailableError) throw error
    throw new Error(`读取放大器清单失败：${error instanceof Error ? error.message : error}`)
  }
  const upscaler = pickUpscaler(upscalers, args.upscaler)

  const started = Date.now()
  const jpeg = await client.upscale({
    rgb,
    width: decoded.width,
    height: decoded.height,
    upscalerPath: upscaler.path,
    useOpencl: args.useOpencl === true,
    timeoutMs
  })
  const elapsedMs = Date.now() - started

  const path = await saveBuffer(jpeg, { outputDir, extension: 'jpg', prefix: 'ld_up' })
  const outInfo = imageInfo(jpeg)

  return {
    mode: 'upscale',
    sourceImage: imagePath,
    inWidth: decoded.width,
    inHeight: decoded.height,
    upscaler,
    path,
    outWidth: outInfo.width,
    outHeight: outInfo.height,
    format: 'jpeg',
    bytes: jpeg.length,
    elapsedMs,
    notes: [
      '后端固定 ×4、输出 JPEG（quality 95）。要再做分块重绘就把这张图喂给 mode="ultrafix"。'
    ]
  }
}

async function runUltrafix ({ args, client, config, presets, buffer, info, imagePath, outputDir, timeoutMs }) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (prompt === '') {
    throw new Error('UltraFix 需要 prompt：它是分块 img2img 重绘，不是纯放大')
  }

  const selectWaitMs = config.selectTimeoutMs ?? DEFAULT_SELECT_TIMEOUT_MS
  const requestedModel = typeof args.model === 'string' ? args.model.trim() : ''
  const backend = requestedModel !== ''
    ? await client.selectAndWait({ modelId: requestedModel, waitMs: selectWaitMs })
    : await client.ensureBackend({ waitMs: selectWaitMs })

  const notes = []
  let model
  try {
    model = findModel(normalizeModels(await client.models()), backend.modelId)
  } catch (error) {
    notes.push(`读取模型清单失败，改用全局兜底参数：${error instanceof Error ? error.message : error}`)
  }

  // 尺寸约束先校验：这些是后端源码里的硬校验，本地拦下来能省一次无谓的请求。
  const { tileSize } = validateUltrafixSize({
    width: info.width,
    height: info.height,
    tileSize: args.tileSize,
    isSdxl: model?.isSdxl === true
  })
  if (model?.isSdxl === true && args.tileSize !== undefined && Number(args.tileSize) !== 1024) {
    notes.push('SDXL 后端的 tile_size 被硬编码为 1024，已忽略传入值。')
  }

  const params = resolveDrawParams({ args, presets, modelId: backend.modelId, model })
  const denoise = Number.isFinite(Number(args.denoise)) ? Number(args.denoise) : 0.4
  const outputFormat = args.outputFormat === 'png' ? 'png' : 'jpeg'

  const body = buildGenerateBody({
    prompt,
    negativePrompt: typeof args.negativePrompt === 'string' ? args.negativePrompt : '',
    steps: params.steps,
    cfg: params.cfg,
    scheduler: params.scheduler,
    width: info.width,
    height: info.height,
    seed: Number.isFinite(Number(args.seed)) ? Number(args.seed) : undefined,
    imageBase64: buffer.toString('base64'),
    denoiseStrength: denoise,
    outputFormat,
    ultrafix: true,
    tileSize
  })

  const complete = await client.generate(body, { timeoutMs })
  const saved = await saveGeneratedImage(complete, { outputDir, index: 0, outputFormat })

  return {
    mode: 'ultrafix',
    modelId: backend.modelId,
    sourceImage: imagePath,
    inWidth: info.width,
    inHeight: info.height,
    size: { width: info.width, height: info.height },
    tileSize,
    denoise,
    params,
    path: saved.path,
    // 后端不保证在 complete 事件里回吐尺寸，拿不到就按输入尺寸算 —— UltraFix 不改变尺寸。
    outWidth: saved.width > 0 ? saved.width : info.width,
    outHeight: saved.height > 0 ? saved.height : info.height,
    format: saved.format,
    bytes: saved.bytes,
    elapsedMs: complete.elapsedMs,
    notes
  }
}
