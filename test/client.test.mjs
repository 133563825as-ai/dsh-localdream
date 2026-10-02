import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LocalDreamClient, LocalDreamUnavailableError, parseSseLine } from '../src/client.js'

const encoder = new TextEncoder()

function sseResponse (chunks, { status = 200 } = {}) {
  const stream = new ReadableStream({
    start (controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, { status })
}

function clientWith (fetchImpl, overrides = {}) {
  return new LocalDreamClient({
    fetchImpl,
    controlBaseUrl: 'http://127.0.0.1:8808',
    generateBaseUrl: 'http://127.0.0.1:8081',
    generateTimeoutMs: 5_000,
    ...overrides
  })
}

test('parseSseLine 认出 data 行与 [DONE]', () => {
  assert.deepEqual(parseSseLine('data: [DONE]'), { message: null, done: true })
  assert.deepEqual(parseSseLine('data: {"type":"progress","step":1}'), {
    message: { type: 'progress', step: 1 },
    done: false
  })
  assert.deepEqual(parseSseLine('event: ping'), { message: null, done: false })
  assert.deepEqual(parseSseLine('data: {不合法'), { message: null, done: false })
})

test('generate 解析 SSE 流，拿到 complete 与进度', async () => {
  const progress = []
  const client = clientWith(async () => sseResponse([
    'data: {"type":"progress","step":1,"total_steps":4}\n',
    'data: {"type":"progress","step":2,"total_steps":4}\n\ndata: {"type":"complete","image":"AAAA","format":"jpeg","seed":7,"width":8,"height":9,"channels":3}\n',
    'data: [DONE]\n'
  ]))

  const complete = await client.generate({ prompt: 'x' }, { onProgress: (p) => progress.push(p) })
  assert.equal(complete.image, 'AAAA')
  assert.equal(complete.seed, 7)
  assert.equal(complete.width, 8)
  assert.equal(typeof complete.elapsedMs, 'number')
  assert.deepEqual(progress, [
    { step: 1, totalSteps: 4 },
    { step: 2, totalSteps: 4 }
  ])
})

test('generate 在后端报 error 事件时抛出后端原文', async () => {
  const client = clientWith(async () => sseResponse([
    'data: {"type":"error","message":"Invalid Arg: Err proc img: Img size mismatch"}\n'
  ]))
  await assert.rejects(
    () => client.generate({ prompt: 'x' }),
    /Img size mismatch/
  )
})

test('generate 没收到 complete 时给出可操作的提示', async () => {
  const client = clientWith(async () => sseResponse([
    'data: {"type":"progress","step":1,"total_steps":4}\n'
  ]))
  await assert.rejects(() => client.generate({ prompt: 'x' }), /没有收到 complete 事件/)
})

test('generate 把非 2xx 的响应体带进错误信息', async () => {
  const client = clientWith(async () => new Response("Missing 'prompt'", { status: 400 }))
  await assert.rejects(() => client.generate({ prompt: '' }), /HTTP 400.*Missing 'prompt'/)
})

test('控制口连不上时抛 LocalDreamUnavailableError，并附上开启受控模式的指引', async () => {
  const client = clientWith(async () => {
    const error = new TypeError('fetch failed')
    error.cause = { code: 'ECONNREFUSED' }
    throw error
  })

  await assert.rejects(
    () => client.info(),
    (error) => {
      assert.ok(error instanceof LocalDreamUnavailableError)
      assert.match(error.message, /进入受控模式/)
      return true
    }
  )
})

test('snapshot 在控制口不可用时返回 online:false 而不是抛错', async () => {
  const client = clientWith(async () => {
    const error = new TypeError('fetch failed')
    error.cause = { code: 'ECONNREFUSED' }
    throw error
  })
  const snapshot = await client.snapshot()
  assert.equal(snapshot.online, false)
  assert.match(snapshot.hint, /受控模式/)
})

test('snapshot 在线时汇总信息与生成口状态', async () => {
  const client = clientWith(async (url) => {
    if (url.endsWith('/info')) return Response.json({ app: 'localdream', device: 'X', version: '1.2.3' })
    if (url.endsWith('/status')) return Response.json({ state: 'running', serving_model_id: 'm1' })
    return new Response('not found', { status: 404 })
  })
  const snapshot = await client.snapshot()
  assert.equal(snapshot.online, true)
  assert.equal(snapshot.info.device, 'X')
  assert.equal(snapshot.status.serving_model_id, 'm1')
  // 404 也算端口活着
  assert.equal(snapshot.generatePortAlive, true)
})

test('modelCanvas 现读模型的基准尺寸，不写死 1024', async () => {
  const client = clientWith(async () => Response.json({
    models: [
      { id: 'a', generation_size: 768 },
      { id: 'b' }
    ]
  }))
  assert.deepEqual(await client.modelCanvas('a'), { width: 768, height: 768 })
  assert.deepEqual(await client.modelCanvas('b'), { width: 1024, height: 1024 })
  assert.deepEqual(await client.modelCanvas('不存在'), { width: 1024, height: 1024 })
})

test('upscale 用 HTTP 头 + raw body，而不是 JSON', async () => {
  let captured = null
  const client = clientWith(async (url, init) => {
    captured = { url, init }
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200 })
  })

  const rgb = Buffer.alloc(2 * 2 * 3, 7)
  const out = await client.upscale({ rgb, width: 2, height: 2, upscalerPath: 'x4.mnn' })

  assert.equal(captured.url, 'http://127.0.0.1:8081/upscale')
  assert.equal(captured.init.headers['X-Image-Width'], '2')
  assert.equal(captured.init.headers['X-Upscaler-Path'], 'x4.mnn')
  assert.equal(captured.init.body.length, 12)
  assert.equal(out.length, 3)
})

test('upscale 在字节数不符时本地就拦下来', async () => {
  const client = clientWith(async () => new Response('', { status: 200 }))
  await assert.rejects(
    () => client.upscale({ rgb: Buffer.alloc(3), width: 2, height: 2, upscalerPath: 'x.mnn' }),
    /raw RGB24/
  )
  await assert.rejects(
    () => client.upscale({ rgb: Buffer.alloc(12), width: 2, height: 2, upscalerPath: '' }),
    /放大器模型路径/
  )
})

test('setBaseUrls 改地址：去尾斜杠、空串回默认、只传一个不动另一个', () => {
  const client = clientWith(async () => new Response('{}'))

  assert.deepEqual(client.getBaseUrls(), {
    controlBaseUrl: 'http://127.0.0.1:8808',
    generateBaseUrl: 'http://127.0.0.1:8081'
  })

  client.setBaseUrls({ controlBaseUrl: 'http://10.0.0.2:9000/' })
  assert.equal(client.getBaseUrls().controlBaseUrl, 'http://10.0.0.2:9000')
  assert.equal(client.getBaseUrls().generateBaseUrl, 'http://127.0.0.1:8081')

  client.setBaseUrls({ generateBaseUrl: 'http://10.0.0.2:9001', controlBaseUrl: '' })
  assert.equal(client.getBaseUrls().controlBaseUrl, 'http://127.0.0.1:8808')
  assert.equal(client.getBaseUrls().generateBaseUrl, 'http://10.0.0.2:9001')
})

test('改过的地址会真的用在请求上', async () => {
  const seen = []
  const client = clientWith(async (url) => {
    seen.push(url)
    return Response.json({ app: 'localdream' })
  })

  client.setBaseUrls({ controlBaseUrl: 'http://10.0.0.9:8808' })
  await client.info()
  assert.equal(seen[0], 'http://10.0.0.9:8808/info')
})
