import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DrawService } from '../src/service.js'
import { LocalDreamStore } from '../src/store.js'

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xd9
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeEnv (options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ld-service-'))
  const store = new LocalDreamStore({ root: join(dir, 'localdream') })
  const config = {
    outputDir: join(dir, 'out'),
    controlBaseUrl: 'http://127.0.0.1:8808',
    generateBaseUrl: 'http://127.0.0.1:8081',
    defaultModel: '',
    maxBatch: 2,
    generateTimeoutMs: 5_000,
    selectTimeoutMs: 5_000,
    modelPresets: {}
  }

  const progressHooks = []
  const client = {
    models: async () => ({
      models: [{ id: 'alpha', generation_size: 512, defaults: { steps: 12, cfg: 5, scheduler: 'euler' } }],
      upscalers: []
    }),
    status: async () => ({ state: 'running', serving_model_id: 'alpha' }),
    ensureBackend: async () => ({ modelId: 'alpha', state: 'running', reused: true }),
    selectAndWait: async ({ modelId }) => ({ modelId, state: 'running', reused: false }),
    generate: async (body, { onProgress } = {}) => {
      progressHooks.push(onProgress)
      if (options.delayMs) await sleep(options.delayMs)
      if (options.fail) throw new Error('后端在生成途中被回收')
      onProgress?.({ step: 6, totalSteps: 12 })
      return { image: JPEG.toString('base64'), format: 'jpeg', seed: 3, width: 512, height: 512, elapsedMs: 10 }
    }
  }

  const service = new DrawService({ client, store, getConfig: () => config })
  return { service, store, config, progressHooks }
}

test('start 立刻返回 busy 快照，任务在后台跑', async () => {
  const { service } = await makeEnv()
  const snapshot = service.start({ prompt: 'a cat' })

  assert.equal(snapshot.busy, true)
  assert.equal(snapshot.phase, 'selecting')
  assert.equal(snapshot.last, null)

  await sleep(60)
  const done = service.snapshot()
  assert.equal(done.busy, false)
  assert.equal(done.phase, 'done')
  assert.equal(done.last.files.length, 1)
})

test('忙碌时再提交会被拒绝（NPU 扛不住并发）', async () => {
  const { service } = await makeEnv({ delayMs: 120 })
  service.start({ prompt: 'first' })
  assert.throws(() => service.start({ prompt: 'second' }), /已经有一张在画了/)
  await sleep(200)
  assert.equal(service.snapshot().busy, false)
})

test('暴露给客户端的只有文件名，不带容器路径', async () => {
  const { service } = await makeEnv()
  service.start({ prompt: 'a cat' })
  await sleep(60)

  const file = service.snapshot().last.files[0]
  assert.ok(file.name.endsWith('.jpg'))
  assert.equal(file.name.includes('/'), false)
  assert.equal('path' in file, false)
})

test('失败时记录错误原文，并解除忙碌', async () => {
  const { service } = await makeEnv({ fail: true })
  service.start({ prompt: 'a cat' })
  await sleep(60)

  const snapshot = service.snapshot()
  assert.equal(snapshot.busy, false)
  assert.equal(snapshot.phase, 'error')
  assert.match(snapshot.error, /回收/)
  assert.equal(snapshot.last, null)
})

test('进度回调会更新步数', async () => {
  const { service } = await makeEnv({ delayMs: 40 })
  service.start({ prompt: 'a cat' })
  await sleep(25)
  const mid = service.snapshot()
  assert.ok(mid.busy)
  assert.ok(['selecting', 'generating', 'saving'].includes(mid.phase))
  await sleep(80)
  assert.equal(service.snapshot().phase, 'done')
})

test('prompt 为空时任务以错误结束，而不是抛到调用方', async () => {
  const { service } = await makeEnv()
  service.start({})
  await sleep(30)
  const snapshot = service.snapshot()
  assert.equal(snapshot.phase, 'error')
  assert.match(snapshot.error, /prompt/)
})

test('用的是容器里的 maxBatch，不是硬编码', async () => {
  const { service, store } = await makeEnv()
  await store.setSetting('maxBatch', 3)
  service.start({ prompt: 'a cat', count: 3 })
  await sleep(80)
  assert.equal(service.snapshot().last.files.length, 3)
})
