/**
 * 出图落盘：把 `complete` 事件里的图像数据写成文件。
 *
 * 后端可能回吐三种 `format`：
 * - `raw` —— packed RGB(A)，得自己编码成 PNG
 * - `png` / `jpeg` —— 已经是成品字节，直接写
 *
 * @module dsh-localdream/output
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

import { encodePng, rgbaToRgb } from './png.js'

const EXTENSIONS = { png: 'png', jpeg: 'jpg', jpg: 'jpg' }

/**
 * 插件默认输出目录：`<DSH_HOME>/localdream/out`。
 * @param {string} dshHome
 * @returns {string}
 */
export function defaultOutputDir (dshHome) {
  return join(dshHome, 'localdream', 'out')
}

/**
 * 解析 DSH home。优先用运行时提供的取值，其次环境变量，最后 `~/.dsh`。
 * @param {{dshHomePath?: () => string}} [ctx]
 * @returns {string}
 */
export function resolveDshHome (ctx) {
  if (typeof ctx?.dshHomePath === 'function') {
    const fromContext = ctx.dshHomePath()
    if (typeof fromContext === 'string' && fromContext.trim() !== '') return fromContext
  }
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(fromEnv)
  return join(homedir(), '.dsh')
}

function randomSuffix () {
  return Math.random().toString(36).slice(2, 6)
}

function timestampForName (date) {
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/**
 * 把 `complete` 事件解码成落盘字节。
 *
 * @param {object} message - `/generate` 的 `complete` 事件。
 * @param {object} [options]
 * @param {string} [options.outputFormat] - 纯 txt2img 时希望的后缀；`raw` 一律转 PNG。
 * @returns {Promise<{data: Buffer, extension: string, width: number, height: number, format: string}>}
 */
export async function decodeCompletion (message, { outputFormat = 'png' } = {}) {
  const base64 = typeof message?.image === 'string' ? message.image : ''
  if (base64 === '') throw new Error('complete 事件里没有图像数据')

  const blob = Buffer.from(base64, 'base64')
  const format = message?.format ?? 'raw'
  const width = Number(message?.width ?? 0)
  const height = Number(message?.height ?? 0)

  if (format === 'raw') {
    if (!(width > 0) || !(height > 0)) throw new Error('raw 图像缺少 width / height')
    let channels = Number(message?.channels ?? 3)
    let pixels = blob
    if (channels === 4) {
      pixels = rgbaToRgb(blob)
      channels = 3
    }
    if (channels !== 3) throw new Error(`raw 图像的通道数不支持：${channels}`)
    const expected = width * height * 3
    if (pixels.length !== expected) {
      throw new Error(`raw 图像尺寸不符：期望 ${expected} 字节，实得 ${pixels.length}`)
    }
    return {
      data: await encodePng(width, height, pixels),
      extension: 'png',
      width,
      height,
      format: 'png'
    }
  }

  const extension = EXTENSIONS[String(format).toLowerCase()] ?? 'jpg'
  return { data: blob, extension, width, height, format }
}

/**
 * 写出图片，返回绝对路径。
 *
 * @param {object} message - `/generate` 的 `complete` 事件。
 * @param {object} options
 * @param {string} options.outputDir
 * @param {number} [options.index] - 同一批里的序号，从 0 开始。
 * @param {string} [options.outputFormat]
 * @param {Date} [options.now]
 * @returns {Promise<{path: string, width: number, height: number, format: string, seed: number|undefined, bytes: number}>}
 */
export async function saveGeneratedImage (message, { outputDir, index = 0, outputFormat = 'png', now = new Date() } = {}) {
  if (typeof outputDir !== 'string' || outputDir === '') throw new Error('outputDir 不能为空')
  const decoded = await decodeCompletion(message, { outputFormat })
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })

  const name = `ld_${timestampForName(now)}_${randomSuffix()}_${index}.${decoded.extension}`
  const path = join(dir, name)
  await writeFile(path, decoded.data)

  const seed = Number.isFinite(Number(message?.seed)) ? Number(message.seed) : undefined
  return {
    path,
    width: decoded.width,
    height: decoded.height,
    format: decoded.format,
    seed,
    bytes: decoded.data.length
  }
}

/**
 * 写出任意字节（放大结果等）。
 * @param {Buffer} data
 * @param {object} options
 * @param {string} options.outputDir
 * @param {string} options.extension
 * @param {string} [options.prefix]
 * @param {Date} [options.now]
 * @returns {Promise<string>} 绝对路径。
 */
export async function saveBuffer (data, { outputDir, extension, prefix = 'ld', now = new Date() }) {
  const dir = resolve(outputDir)
  await mkdir(dir, { recursive: true })
  const name = `${prefix}_${timestampForName(now)}_${randomSuffix()}.${extension}`
  const path = join(dir, name)
  await writeFile(path, data)
  return path
}
