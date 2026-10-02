/**
 * 纯 Node 的 PNG 编解码与图片尺寸探测。
 *
 * 为什么自己写：Local Dream 在 `output_format: "raw"` 时回吐的是 packed RGB，
 * 要落盘就得自己编码 PNG；`/upscale` 又要求 raw RGB24 作为请求体，
 * 要读 PNG 就得自己解码。两件事都不能依赖原生模块 —— 插件要保持零 runtime 依赖。
 *
 * @module dsh-localdream/png
 */

import { deflate as deflateCallback, inflateSync } from 'node:zlib'
import { promisify } from 'node:util'

const deflate = promisify(deflateCallback)

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/**
 * 标准 CRC-32（PNG 分块校验用）。
 * @param {Buffer} buffer
 * @returns {number} 无符号 32 位结果。
 */
export function crc32 (buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk (type, data) {
  const out = Buffer.allocUnsafe(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * 把 packed RGB 编码成 PNG（8 位真彩、无隔行）。
 * @param {number} width
 * @param {number} height
 * @param {Buffer} rgb - 长度必须等于 `width * height * 3`。
 * @returns {Promise<Buffer>}
 */
export async function encodePng (width, height, rgb) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`PNG 尺寸非法：${width}x${height}`)
  }
  const stride = width * 3
  const expected = stride * height
  if (rgb.length !== expected) {
    throw new Error(`RGB 数据长度不符：期望 ${expected}，实得 ${rgb.length}`)
  }

  const raw = Buffer.allocUnsafe((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const at = y * (stride + 1)
    raw[at] = 0 // filter type 0 (None)
    rgb.copy(raw, at + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const idat = await deflate(raw, { level: 6 })
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * 解码 PNG 成 packed RGB 或灰度数据。
 *
 * 支持 8 位灰度 / 真彩 / 带 alpha（alpha 会被丢弃）、无隔行 —— 覆盖相机截图、
 * ImageMagick 输出和本插件自己写出的图。16 位与隔行图会明确抛错，不静默出错图。
 *
 * @param {Buffer} buffer
 * @returns {{width: number, height: number, channels: number, data: Buffer}} `channels` 为 1 或 3。
 */
export function decodePng (buffer) {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是 PNG 文件（签名不匹配）')
  }

  let offset = 8
  let header = null
  const idatParts = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error('PNG 分块长度越界，文件可能已损坏')

    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12]
      }
    } else if (type === 'IDAT') {
      idatParts.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }

    offset = dataEnd + 4
  }

  if (header === null) throw new Error('PNG 缺少 IHDR 分块')
  if (header.bitDepth !== 8) throw new Error(`只支持 8 位 PNG，收到 ${header.bitDepth} 位`)
  if (header.interlace !== 0) throw new Error('不支持隔行（interlaced）PNG，请先转成普通 PNG')
  if (idatParts.length === 0) throw new Error('PNG 缺少 IDAT 数据')

  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const sourceChannels = channelsByColorType[header.colorType]
  if (sourceChannels === undefined) {
    throw new Error(`不支持的 PNG 颜色类型 ${header.colorType}`)
  }

  const { width, height } = header
  const raw = inflateSync(Buffer.concat(idatParts))
  const stride = width * sourceChannels
  if (raw.length < (stride + 1) * height) {
    throw new Error('PNG 像素数据不完整')
  }

  // 逐行反滤波。每行开头一字节是 filter 类型。
  const unfiltered = Buffer.allocUnsafe(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)]
    const srcStart = y * (stride + 1) + 1
    const dstStart = y * stride
    const priorStart = dstStart - stride

    for (let x = 0; x < stride; x += 1) {
      const value = raw[srcStart + x]
      const left = x >= sourceChannels ? unfiltered[dstStart + x - sourceChannels] : 0
      const up = y > 0 ? unfiltered[priorStart + x] : 0
      const upLeft = y > 0 && x >= sourceChannels ? unfiltered[priorStart + x - sourceChannels] : 0

      let restored
      switch (filterType) {
        case 0: restored = value; break
        case 1: restored = value + left; break
        case 2: restored = value + up; break
        case 3: restored = value + ((left + up) >> 1); break
        case 4: restored = value + paeth(left, up, upLeft); break
        default: throw new Error(`未知的 PNG 行滤波类型 ${filterType}`)
      }
      unfiltered[dstStart + x] = restored & 0xff
    }
  }

  return packChannels(unfiltered, width, height, header.colorType, sourceChannels)
}

function packChannels (unfiltered, width, height, colorType, sourceChannels) {
  if (colorType === 2) {
    return { width, height, channels: 3, data: unfiltered }
  }

  const outChannels = colorType === 0 ? 1 : 3
  const out = Buffer.allocUnsafe(width * height * outChannels)
  const pixels = width * height

  for (let i = 0; i < pixels; i += 1) {
    const src = i * sourceChannels
    if (colorType === 0) {
      out[i] = unfiltered[src]
    } else if (colorType === 4) {
      // 灰度 + alpha → 灰度，丢弃 alpha
      out[i] = unfiltered[src]
    } else {
      // RGBA → RGB，alpha 丢弃（后端不接受带 alpha 的 raw 请求体）
      out[i * 3] = unfiltered[src]
      out[i * 3 + 1] = unfiltered[src + 1]
      out[i * 3 + 2] = unfiltered[src + 2]
    }
  }

  return { width, height, channels: outChannels, data: out }
}

/**
 * 只读出图片尺寸与格式，不解码像素。用于校验 img2img 输入图尺寸。
 *
 * @param {Buffer} buffer
 * @returns {{format: 'png'|'jpeg'|'gif'|'webp'|'bmp'|'unknown', width: number, height: number}} 识别失败时长为 0。
 */
export function imageInfo (buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {
      format: 'png',
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const size = jpegSize(buffer)
    return { format: 'jpeg', ...size }
  }

  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return { format: 'gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }

  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = buffer.toString('ascii', 12, 16)
    if (kind === 'VP8X') {
      const width = 1 + (buffer.readUIntLE(24, 3) & 0xffffff)
      const height = 1 + (buffer.readUIntLE(27, 3) & 0xffffff)
      return { format: 'webp', width, height }
    }
    if (kind === 'VP8 ') {
      return {
        format: 'webp',
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      }
    }
    if (kind === 'VP8L') {
      const bits = buffer.readUInt32LE(21)
      return {
        format: 'webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1
      }
    }
    return { format: 'webp', width: 0, height: 0 }
  }

  if (buffer.length >= 26 && buffer.toString('ascii', 0, 2) === 'BM') {
    return { format: 'bmp', width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) }
  }

  return { format: 'unknown', width: 0, height: 0 }
}

function jpegSize (buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    // 填充字节与无长度字段的标记
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const length = buffer.readUInt16BE(offset + 2)
    // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15 携带尺寸
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      }
    }
    if (length < 2) break
    offset += 2 + length
  }
  return { width: 0, height: 0 }
}

/**
 * 把 `channels` 为 4 的 packed RGBA 剥成 RGB。
 * @param {Buffer} buffer
 * @returns {Buffer}
 */
export function rgbaToRgb (buffer) {
  const pixels = Math.floor(buffer.length / 4)
  const out = Buffer.allocUnsafe(pixels * 3)
  for (let i = 0; i < pixels; i += 1) {
    out[i * 3] = buffer[i * 4]
    out[i * 3 + 1] = buffer[i * 4 + 1]
    out[i * 3 + 2] = buffer[i * 4 + 2]
  }
  return out
}

/** PNG 文件签名，导出给单测与格式判断复用。 */
export { PNG_SIGNATURE }
