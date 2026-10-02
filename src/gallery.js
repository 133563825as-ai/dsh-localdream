/**
 * 出图历史：扫描输出目录，给客户端半身提供缩略图列表。
 *
 * @module dsh-localdream/gallery
 */

import { open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { imageInfo } from './png.js'

/** 只读文件头部就够判尺寸 —— PNG 的 IHDR 在前 24 字节，JPEG 的 SOF 通常也在最前面。 */
const HEADER_BYTES = 64 * 1024

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

/**
 * 读文件头并解析出图片尺寸。读不动或认不出就返回 0，调用方照常列出文件。
 * @param {string} path
 * @param {number} size
 * @returns {Promise<{width: number, height: number, format: string}>}
 */
async function readImageInfo (path, size) {
  const length = Math.min(HEADER_BYTES, size)
  if (length <= 0) return { width: 0, height: 0, format: 'unknown' }

  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return imageInfo(buffer.subarray(0, bytesRead))
  } catch {
    return { width: 0, height: 0, format: 'unknown' }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * 列出输出目录里的图片，新的在前。
 *
 * @param {string} dir - 输出目录。
 * @param {object} [options]
 * @param {number} [options.limit] - 最多返回多少条。
 * @param {string} [options.grep] - 只保留文件名包含该子串的项。
 * @returns {Promise<Array<{name: string, size: number, mtime: string, width: number, height: number, format: string}>>}
 */
export async function listImages (dir, { limit = 60, grep } = {}) {
  if (typeof dir !== 'string' || dir === '') return []

  let entries
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const names = entries.filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
  const statted = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (!info.isFile()) continue
      statted.push({ name, size: info.size, mtimeMs: info.mtimeMs, mtime: info.mtime.toISOString() })
    } catch {
      // 扫描期间被删掉的文件直接跳过。
    }
  }

  statted.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const filtered = typeof grep === 'string' && grep !== ''
    ? statted.filter((entry) => entry.name.includes(grep))
    : statted
  const selected = filtered.slice(0, Math.max(1, Math.min(500, limit)))

  const result = []
  for (const entry of selected) {
    const info = await readImageInfo(join(dir, entry.name), entry.size)
    result.push({
      name: entry.name,
      size: entry.size,
      mtime: entry.mtime,
      width: info.width,
      height: info.height,
      format: info.format
    })
  }
  return result
}

/**
 * 把客户端传来的文件名解析成一个**落在输出目录内**的绝对路径。
 *
 * 只用 `basename` 取值：任何带路径分隔符的输入都会被压成文件名，
 * 从根上挡掉 `../../etc/passwd` 这类穿越。
 *
 * @param {string} dir
 * @param {string} name
 * @returns {string}
 */
export function resolveImagePath (dir, name) {
  const safe = basename(String(name ?? ''))
  if (safe === '' || safe === '.' || safe === '..') {
    throw new Error('文件名无效')
  }
  if (!IMAGE_EXTENSIONS.has(extname(safe).toLowerCase())) {
    throw new Error('只能读取图片文件')
  }
  return join(dir, safe)
}

/** 按扩展名给出 Content-Type。 */
export function contentTypeFor (name) {
  switch (extname(name).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}
