import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildGenerateBody, validateUltrafixSize } from '../src/request.js'

const base = {
  prompt: 'a whale girl',
  steps: 29,
  cfg: 6,
  scheduler: 'dpm',
  width: 1024,
  height: 1024
}

test('buildGenerateBody 用后端认得的字段名', () => {
  const body = buildGenerateBody({ ...base, aspectRatio: '3:4' })
  assert.equal(body.prompt, 'a whale girl')
  assert.equal(body.negative_prompt, '')
  assert.equal(body.aspect_ratio, '3:4')
  assert.equal(body.width, 1024)
  assert.equal(body.height, 1024)
  assert.equal(body.output_format, 'png')
  assert.equal(body.show_diffusion_process, false)
  assert.equal(body.use_opencl, false)
})

test('img2img 的输入图字段只有 image 一个', () => {
  const body = buildGenerateBody({ ...base, imageBase64: 'AAAA', denoiseStrength: 0.85 })
  assert.equal(body.image, 'AAAA')
  assert.equal(body.denoise_strength, 0.85)
  // 这些都是会被后端静默忽略的错误字段名，出现任何一个都说明写错了
  for (const wrong of ['init_image', 'init_images', 'input_image', 'init_img', 'image_base64', 'image_data']) {
    assert.equal(body[wrong], undefined, `不该出现字段 ${wrong}`)
  }
})

test('空 base64 不会被塞进请求体', () => {
  const body = buildGenerateBody({ ...base, imageBase64: '' })
  assert.equal('image' in body, false)
})

test('UltraFix 下不传 aspect_ratio —— 此时宽高就是全图真实尺寸', () => {
  const body = buildGenerateBody({
    ...base,
    width: 4096,
    height: 4096,
    aspectRatio: '1:1',
    ultrafix: true,
    tileSize: 512,
    imageBase64: 'AAAA'
  })
  assert.equal(body.ultrafix, true)
  assert.equal(body.tile_size, 512)
  assert.equal(body.width, 4096)
  assert.equal('aspect_ratio' in body, false)
})

test('seed 只在显式给出时才出现', () => {
  assert.equal('seed' in buildGenerateBody({ ...base }), false)
  assert.equal(buildGenerateBody({ ...base, seed: 0 }).seed, 0)
})

test('prompt 为空直接抛错，别浪费一次冷启动', () => {
  assert.throws(() => buildGenerateBody({ ...base, prompt: '' }), /prompt 不能为空/)
  assert.throws(() => buildGenerateBody({ ...base, prompt: '   ' }), /prompt 不能为空/)
})

test('validateUltrafixSize 按后端源码的约束顺序校验', () => {
  assert.deepEqual(validateUltrafixSize({ width: 4096, height: 4096, tileSize: 512 }), { tileSize: 512 })

  assert.throws(
    () => validateUltrafixSize({ width: 4096, height: 4096, tileSize: 100 }),
    /Invalid ultrafix tile_size/
  )
  assert.throws(
    () => validateUltrafixSize({ width: 4090, height: 4096, tileSize: 512 }),
    /must be a multiple of 8/
  )
  assert.throws(
    () => validateUltrafixSize({ width: 256, height: 4096, tileSize: 512 }),
    /shorter edge must be >= 512/
  )
  assert.throws(
    () => validateUltrafixSize({ width: 8192, height: 8200, tileSize: 512 }),
    /too large/
  )
})

test('SDXL 后端的 tile_size 被硬编码为 1024', () => {
  const result = validateUltrafixSize({ width: 2048, height: 2048, tileSize: 512, isSdxl: true })
  assert.equal(result.tileSize, 1024)
})
