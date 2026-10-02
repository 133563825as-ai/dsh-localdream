/**
 * 请求体构造与 UltraFix 约束校验。
 *
 * 全部是纯函数 —— 字段名和校验顺序是这套 API 上最容易踩坑的地方，
 * 单独抽出来就是为了让单测能钉住它们。
 *
 * @module dsh-localdream/request
 */

/**
 * 构造 `POST /generate` 的请求体。
 *
 * ⚠️ 后端对**不认识的字段一律静默忽略**：img2img 的输入图字段只有 `image` 一个，
 * 写成 `init_image` / `input_image` / `image_base64` 都会拿到一张 txt2img 的图，
 * 且不报任何错。字段名不要改。
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.negativePrompt]
 * @param {number} options.steps
 * @param {number} options.cfg
 * @param {string} options.scheduler
 * @param {number} options.width
 * @param {number} options.height
 * @param {string} [options.aspectRatio] - UltraFix 下不传，此时宽高就是全图真实尺寸。
 * @param {number} [options.seed]
 * @param {string} [options.imageBase64]
 * @param {number} [options.denoiseStrength]
 * @param {'jpeg'|'png'} [options.outputFormat]
 * @param {boolean} [options.ultrafix]
 * @param {number} [options.tileSize]
 * @returns {object}
 */
export function buildGenerateBody (options) {
  const {
    prompt,
    negativePrompt = '',
    steps,
    cfg,
    scheduler,
    width,
    height,
    aspectRatio,
    seed,
    imageBase64,
    denoiseStrength = 1.0,
    outputFormat = 'png',
    ultrafix = false,
    tileSize
  } = options ?? {}

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error("prompt 不能为空 —— 后端缺 prompt 会直接抛 Missing 'prompt'")
  }
  if (!Number.isFinite(Number(steps)) || !Number.isFinite(Number(cfg))) {
    throw new Error('steps 与 cfg 必须是数字')
  }

  const body = {
    prompt,
    negative_prompt: negativePrompt,
    steps: Number(steps),
    cfg: Number(cfg),
    scheduler,
    width: Number(width),
    height: Number(height),
    denoise_strength: Number(denoiseStrength),
    preview_format: 'jpeg',
    output_format: outputFormat,
    use_opencl: false,
    show_diffusion_process: false,
    show_diffusion_stride: 1
  }

  if (!ultrafix && typeof aspectRatio === 'string' && aspectRatio !== '') {
    body.aspect_ratio = aspectRatio
  }
  if (typeof imageBase64 === 'string' && imageBase64 !== '') {
    body.image = imageBase64
  }
  if (ultrafix) {
    body.ultrafix = true
    if (tileSize !== undefined) body.tile_size = Number(tileSize)
  }
  if (seed !== undefined && seed !== null) {
    body.seed = Number(seed)
  }

  return body
}

/** UltraFix 下 SDXL 后端的 `tile_size` 被硬编码成这个值。 */
export const SDXL_ULTRAFIX_TILE = 1024

/** UltraFix 全图最长边硬上限。 */
export const ULTRAFIX_MAX_EDGE = 8192

/**
 * 校验 UltraFix 的尺寸约束，不通过就抛错。
 *
 * 这些约束是后端源码里的硬校验，错误文本与后端一致，方便对照日志。
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} [options.tileSize]
 * @param {boolean} [options.isSdxl] - SDXL 后端忽略传入的 tile_size，固定 1024。
 * @returns {{tileSize: number}}
 */
export function validateUltrafixSize ({ width, height, tileSize, isSdxl = false }) {
  const resolvedTile = isSdxl ? SDXL_ULTRAFIX_TILE : Number(tileSize ?? 512)

  if (!Number.isInteger(resolvedTile) || resolvedTile <= 0 || resolvedTile % 8 !== 0) {
    throw new Error(`Invalid ultrafix tile_size：tile_size 必须为正的 8 的倍数，收到 ${tileSize}`)
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width % 8 !== 0 || height % 8 !== 0) {
    throw new Error(`ultrafix size must be a multiple of 8：收到 ${width}x${height}`)
  }
  const shorter = Math.min(width, height)
  const required = Math.max(resolvedTile, 512)
  if (shorter < required) {
    throw new Error(`ultrafix image shorter edge must be >= ${required}：收到短边 ${shorter}`)
  }
  const longer = Math.max(width, height)
  if (longer > ULTRAFIX_MAX_EDGE) {
    throw new Error(`ultrafix image too large (max ${ULTRAFIX_MAX_EDGE})：收到长边 ${longer}`)
  }

  return { tileSize: resolvedTile }
}
