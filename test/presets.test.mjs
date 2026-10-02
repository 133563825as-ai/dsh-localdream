import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FALLBACK_PARAMS,
  aspectSize,
  clampBatch,
  floorTo8,
  parseAspectRatio,
  resolveParams
} from '../src/presets.js'

test('floorTo8 向下取整到 8 的倍数', () => {
  assert.equal(floorTo8(682.7), 680)
  assert.equal(floorTo8(683), 680)
  assert.equal(floorTo8(688), 688)
  assert.equal(floorTo8(7), 0)
})

test('aspectSize 与后端实测尺寸一致', () => {
  const expected = {
    '1:1': [1024, 1024],
    '4:3': [1024, 768],
    '3:2': [1024, 680],
    '16:10': [1024, 640],
    '16:9': [1024, 576],
    '2:1': [1024, 512],
    '3:4': [768, 1024],
    '9:16': [576, 1024]
  }
  for (const [ratio, [width, height]] of Object.entries(expected)) {
    assert.deepEqual(aspectSize(ratio), { width, height }, `比例 ${ratio} 换算错误`)
  }
})

test('aspectSize 跟随模型的基准尺寸，而不是写死 1024', () => {
  assert.deepEqual(aspectSize('1:1', 512), { width: 512, height: 512 })
  assert.deepEqual(aspectSize('4:3', 2048), { width: 2048, height: 1536 })
})

test('aspectSize 接受任意宽高比', () => {
  assert.deepEqual(aspectSize('5:3'), { width: 1024, height: 608 })
})

test('parseAspectRatio 拒绝非法输入', () => {
  assert.throws(() => parseAspectRatio('1-1'), /宽高比格式/)
  assert.throws(() => parseAspectRatio('1:0'), /必须为正数/)
  assert.throws(() => parseAspectRatio(''), /宽高比格式/)
})

test('resolveParams 优先级：显式 > 模板 > 预设 > 模型默认 > 兜底', () => {
  const all = resolveParams({
    explicit: { steps: 10 },
    template: { steps: 20, cfg: 2 },
    preset: { steps: 30, cfg: 3, scheduler: 'lcm' },
    defaults: { steps: 40, cfg: 4, scheduler: 'euler' }
  })
  assert.deepEqual(all, { steps: 10, cfg: 2, scheduler: 'lcm', source: 'explicit' })

  const fromTemplate = resolveParams({
    template: { steps: 20 },
    preset: { steps: 30, cfg: 3, scheduler: 'lcm' },
    defaults: { steps: 40, cfg: 4, scheduler: 'euler' }
  })
  assert.equal(fromTemplate.steps, 20)
  assert.equal(fromTemplate.source, 'template')

  const fromPreset = resolveParams({
    preset: { steps: 30, cfg: 3, scheduler: 'lcm' },
    defaults: { steps: 40, cfg: 4, scheduler: 'euler' }
  })
  assert.equal(fromPreset.steps, 30)
  assert.equal(fromPreset.source, 'preset')

  const fromModel = resolveParams({ defaults: { steps: 29, cfg: 6, scheduler: 'dpm' } })
  assert.deepEqual(fromModel, { steps: 29, cfg: 6, scheduler: 'dpm', source: 'model-defaults' })
})

test('resolveParams 在没有任何来源时落到全局兜底', () => {
  const resolved = resolveParams({})
  assert.deepEqual(resolved, {
    steps: FALLBACK_PARAMS.steps,
    cfg: FALLBACK_PARAMS.cfg,
    scheduler: FALLBACK_PARAMS.scheduler,
    source: 'fallback'
  })
})

test('resolveParams 把 null 当作未传，不会被模板里的空值卡住', () => {
  const resolved = resolveParams({
    template: { steps: null, cfg: undefined },
    defaults: { steps: 25, cfg: 5, scheduler: 'dpm' }
  })
  assert.equal(resolved.steps, 25)
  assert.equal(resolved.cfg, 5)
})

test('clampBatch 允许 1..上限，超出直接报错而不是静默截断', () => {
  assert.equal(clampBatch(undefined, 2), 1)
  assert.equal(clampBatch(2, 2), 2)
  assert.throws(() => clampBatch(3, 2), /张数最多 2/)
  assert.throws(() => clampBatch(0, 2), /正整数/)
  assert.throws(() => clampBatch(1.5, 2), /正整数/)
})
