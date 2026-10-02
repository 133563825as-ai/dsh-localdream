import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'

import { crc32, decodePng, encodePng, imageInfo, rgbaToRgb } from '../src/png.js'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function rawChunk (type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** 手工造一张 PNG，好控制 colorType 与行滤波类型。 */
function makePng ({ width, height, colorType, channels, rows, filters }) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filters?.[y] ?? 0
    Buffer.from(rows[y]).copy(raw, y * (stride + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    rawChunk('IHDR', ihdr),
    rawChunk('IDAT', deflateSync(raw)),
    rawChunk('IEND', Buffer.alloc(0))
  ])
}

test('crc32 与标准测试向量一致', () => {
  assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926)
  assert.equal(crc32(Buffer.alloc(0)), 0)
})

test('encodePng / decodePng 往返无损', async () => {
  const width = 3
  const height = 2
  const rgb = Buffer.from([
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 11, 12, 13, 14, 15, 16, 17, 18
  ])
  const png = await encodePng(width, height, rgb)
  const decoded = decodePng(png)

  assert.equal(decoded.width, width)
  assert.equal(decoded.height, height)
  assert.equal(decoded.channels, 3)
  assert.deepEqual(decoded.data, rgb)
})

test('encodePng 拒绝长度不符的像素数据', async () => {
  await assert.rejects(() => encodePng(2, 2, Buffer.alloc(4)), /RGB 数据长度不符/)
  await assert.rejects(() => encodePng(0, 2, Buffer.alloc(0)), /尺寸非法/)
})

test('decodePng 处理行滤波（Sub）', () => {
  const png = makePng({
    width: 3,
    height: 1,
    colorType: 0,
    channels: 1,
    rows: [[10, 10, 10]],
    filters: [1]
  })
  const decoded = decodePng(png)
  assert.equal(decoded.channels, 1)
  assert.deepEqual([...decoded.data], [10, 20, 30])
})

test('decodePng 处理行滤波（Up）', () => {
  const png = makePng({
    width: 2,
    height: 2,
    colorType: 0,
    channels: 1,
    rows: [
      [5, 7],
      [1, 2] // 累加上一行 → 6, 9
    ],
    filters: [0, 2]
  })
  assert.deepEqual([...decodePng(png).data], [5, 7, 6, 9])
})

test('decodePng 把 RGBA 剥成 RGB —— 后端不收带 alpha 的 raw 请求体', () => {
  const png = makePng({
    width: 2,
    height: 1,
    colorType: 6,
    channels: 4,
    rows: [[1, 2, 3, 255, 4, 5, 6, 0]]
  })
  const decoded = decodePng(png)
  assert.equal(decoded.channels, 3)
  assert.deepEqual([...decoded.data], [1, 2, 3, 4, 5, 6])
})

test('decodePng 明确拒绝隔行与 16 位，而不是解出错图', () => {
  const interlaced = makePng({ width: 1, height: 1, colorType: 0, channels: 1, rows: [[0]] })
  interlaced[28] = 1 // IHDR 的 interlace 字节
  assert.throws(() => decodePng(interlaced), /隔行/)

  const deep = makePng({ width: 1, height: 1, colorType: 0, channels: 1, rows: [[0]] })
  deep[24] = 16 // bit depth
  assert.throws(() => decodePng(deep), /8 位/)
})

test('decodePng 拒绝非 PNG 输入', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /不是 PNG/)
})

test('imageInfo 读 PNG 尺寸', async () => {
  const png = await encodePng(6, 4, Buffer.alloc(6 * 4 * 3))
  const info = imageInfo(png)
  assert.equal(info.format, 'png')
  assert.equal(info.width, 6)
  assert.equal(info.height, 4)
})

test('imageInfo 读 JPEG 尺寸（SOF0）', () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60,
    0x00, 0x00, 0x00, 0x00, 0x00
  ])
  const info = imageInfo(jpeg)
  assert.equal(info.format, 'jpeg')
  assert.equal(info.width, 96)
  assert.equal(info.height, 64)
})

test('imageInfo 读 GIF 尺寸', () => {
  const gif = Buffer.alloc(12)
  gif.write('GIF89a', 0, 'ascii')
  gif.writeUInt16LE(320, 6)
  gif.writeUInt16LE(240, 8)
  const info = imageInfo(gif)
  assert.equal(info.format, 'gif')
  assert.equal(info.width, 320)
  assert.equal(info.height, 240)
})

test('imageInfo 对认不出的内容返回 unknown 而不是瞎猜', () => {
  const info = imageInfo(Buffer.from('hello world, definitely not an image'))
  assert.equal(info.format, 'unknown')
  assert.equal(info.width, 0)
})

test('rgbaToRgb 逐像素剥离 alpha', () => {
  const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([...rgbaToRgb(rgba)], [1, 2, 3, 5, 6, 7])
})
