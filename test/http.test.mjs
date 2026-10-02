import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerRoutes } from '../src/http.js'
import { encodePng } from '../src/png.js'
import { DrawService } from '../src/service.js'
import { LocalDreamStore } from '../src/store.js'

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xd9
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 把路由挂到真实的 http 服务器上 —— 比 mock req/res 更能反映真实行为
 * （HEAD、Content-Length、query 解析这些都在这一层）。
 */
async function startServer (options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ld-http-'))
  const store = new LocalDreamStore({ root: join(dir, 'localdream') })
  const outputDir = join(dir, 'out')
  const config = {
    outputDir,
    controlBaseUrl: 'http://127.0.0.1:8808',
    generateBaseUrl: 'http://127.0.0.1:8081',
    defaultModel: '',
    maxBatch: 2,
    generateTimeoutMs: 5_000,
    selectTimeoutMs: 5_000,
    modelPresets: {}
  }

  // 地址按真实 LocalDreamClient 的语义模拟：空串回落默认、去尾斜杠。
  const baseUrls = {
    controlBaseUrl: config.controlBaseUrl,
    generateBaseUrl: config.generateBaseUrl
  }
  const client = {
    setBaseUrls: ({ controlBaseUrl, generateBaseUrl } = {}) => {
      if (controlBaseUrl !== undefined) {
        baseUrls.controlBaseUrl = controlBaseUrl === '' ? 'http://127.0.0.1:8808' : String(controlBaseUrl).replace(/\/+$/, '')
      }
      if (generateBaseUrl !== undefined) {
        baseUrls.generateBaseUrl = generateBaseUrl === '' ? 'http://127.0.0.1:8081' : String(generateBaseUrl).replace(/\/+$/, '')
      }
    },
    getBaseUrls: () => ({ ...baseUrls }),
    snapshot: async () => options.offline === true
      ? { online: false, reason: 'connect ECONNREFUSED', hint: '请在 App 里进入受控模式' }
      : {
          online: true,
          info: { device: 'TestPhone', version: '3.0.0', protocol: 1 },
          status: { state: 'running', serving_model_id: 'alpha' },
          generatePortAlive: true
        },
    models: async () => ({
      models: [{ id: 'alpha', generation_size: 512, is_sdxl: false, defaults: { steps: 12, cfg: 5, scheduler: 'euler' } }],
      upscalers: [{ id: 'x4', path: '/m/x4.mnn' }]
    }),
    status: async () => ({ state: 'running', serving_model_id: 'alpha' }),
    selectAndWait: async ({ modelId }) => {
      if (options.selectFails) throw new Error('挂载失败：模型文件不完整')
      return { modelId, state: 'running', reused: false }
    },
    ensureBackend: async () => ({ modelId: 'alpha', state: 'running', reused: true }),
    generate: async () => ({
      image: JPEG.toString('base64'),
      format: 'jpeg',
      seed: 1,
      width: 512,
      height: 512,
      elapsedMs: 5
    })
  }

  const service = new DrawService({ client, store, getConfig: () => config })
  const routes = []
  registerRoutes({
    webServer: {
      register ({ kind, path, handler }) {
        routes.push({ kind, path, handler })
        return () => {}
      }
    },
    client,
    store,
    service,
    getConfig: () => config
  })

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/localdream')

  const server = createServer((req, res) => {
    const route = routes.find((item) => (req.url ?? '/').startsWith(item.path))
    if (route === undefined) {
      res.writeHead(404)
      res.end('no route')
      return
    }
    void route.handler(req, res)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  return {
    base,
    store,
    config,
    outputDir,
    async close () {
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

test('GET /localdream/status 汇总状态、模型与设置', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const payload = await (await fetch(`${env.base}/localdream/status`)).json()
  assert.equal(payload.ok, true)
  assert.equal(payload.online, true)
  assert.equal(payload.servingModelId, 'alpha')
  assert.equal(payload.generatePortAlive, true)
  assert.deepEqual(payload.models.map((model) => model.id), ['alpha'])
  assert.equal(payload.models[0].generationSize, 512)
  assert.equal(payload.upscalers.length, 1)
  assert.equal(payload.settings.defaultAspectRatio, '1:1')
  assert.ok(Array.isArray(payload.schedulers))
})

test('离线时 status 仍返回 200，并带上开启指引', async (t) => {
  const env = await startServer({ offline: true })
  t.after(() => env.close())

  const response = await fetch(`${env.base}/localdream/status`)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.online, false)
  assert.match(payload.hint, /受控模式/)
})

test('GET /localdream/gallery 列出输出目录里的图', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const { mkdir } = await import('node:fs/promises')
  await mkdir(env.outputDir, { recursive: true })
  await writeFile(join(env.outputDir, 'ld_a.png'), await encodePng(4, 4, Buffer.alloc(4 * 4 * 3)))

  const payload = await (await fetch(`${env.base}/localdream/gallery`)).json()
  assert.equal(payload.ok, true)
  assert.equal(payload.images.length, 1)
  assert.equal(payload.images[0].name, 'ld_a.png')
  assert.equal(payload.images[0].width, 4)
})

test('GET /localdream/file 回图片字节，并挡住路径穿越', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const { mkdir } = await import('node:fs/promises')
  await mkdir(env.outputDir, { recursive: true })
  const png = await encodePng(2, 2, Buffer.alloc(12, 7))
  await writeFile(join(env.outputDir, 'ok.png'), png)

  const response = await fetch(`${env.base}/localdream/file?name=ok.png`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)

  const escape = await fetch(`${env.base}/localdream/file?name=${encodeURIComponent('../../etc/passwd')}`)
  assert.equal(escape.status, 400)

  const missing = await fetch(`${env.base}/localdream/file?name=nope.png`)
  assert.equal(missing.status, 404)
})

test('POST /localdream/config 改设置与模型预设', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const post = (body) => fetch(`${env.base}/localdream/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const ok = await post({ action: 'set', key: 'defaultAspectRatio', value: '3:4' })
  assert.equal(ok.status, 200)
  assert.equal((await env.store.readSettings()).defaultAspectRatio, '3:4')

  const preset = await post({ action: 'set', key: 'models.alpha.cfg', value: '6' })
  assert.equal(preset.status, 200)
  assert.deepEqual(await env.store.readModelPresets(), { alpha: { cfg: 6 } })

  const invalid = await post({ action: 'set', key: 'defaultAspectRatio', value: '正方形' })
  assert.equal(invalid.status, 400)
  const invalidBody = await invalid.json()
  assert.match(invalidBody.error.message, /宽高比/)

  const unknown = await post({ action: 'set', key: '瞎写', value: '1' })
  assert.equal(unknown.status, 400)

  const reset = await post({ action: 'reset', key: '' })
  assert.equal(reset.status, 200)
  assert.equal((await env.store.readSettings()).defaultAspectRatio, '1:1')
  assert.deepEqual(await env.store.readModelPresets(), {})
})

test('POST /localdream/prompts 存与删模板', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const post = (body) => fetch(`${env.base}/localdream/prompts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const saved = await post({ action: 'save', name: '测试', prompt: 'a cat', steps: 30 })
  assert.equal(saved.status, 200)

  const listed = await (await fetch(`${env.base}/localdream/prompts`)).json()
  assert.equal(listed.templates.length, 1)
  assert.equal(listed.templates[0].steps, 30)

  const escaped = await post({ action: 'save', name: '../evil', prompt: 'x' })
  assert.equal(escaped.status, 400)

  const removed = await post({ action: 'remove', name: '测试' })
  assert.equal(removed.status, 200)
  assert.equal((await env.store.listPrompts()).length, 0)
})

test('POST /localdream/draw 提交任务，缺少提示词时报 400', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const post = (body) => fetch(`${env.base}/localdream/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const missing = await post({})
  assert.equal(missing.status, 400)
  assert.match((await missing.json()).error.message, /提示词|模板/)

  const accepted = await post({ prompt: 'a cat' })
  assert.equal(accepted.status, 202)
  assert.equal((await accepted.json()).task.busy, true)

  const busy = await post({ prompt: 'another' })
  assert.equal(busy.status, 409)

  await sleep(120)
  const task = await (await fetch(`${env.base}/localdream/draw`)).json()
  assert.equal(task.task.busy, false)
  assert.equal(task.task.phase, 'done')
  assert.equal(task.task.last.files.length, 1)
})

test('POST /localdream/select 切模型，失败时把原因带回去', async (t) => {
  const env = await startServer({ selectFails: true })
  t.after(() => env.close())

  const response = await fetch(`${env.base}/localdream/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'alpha' })
  })
  assert.equal(response.status, 500)
  assert.match((await response.json()).error.message, /模型文件不完整/)
})

test('未知路径 404、方法不对 405', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  assert.equal((await fetch(`${env.base}/localdream/nope`)).status, 404)
  assert.equal((await fetch(`${env.base}/localdream/status`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${env.base}/localdream/gallery`, { method: 'POST' })).status, 405)
})

test('请求体不是 JSON 时报 400 而不是 500', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const response = await fetch(`${env.base}/localdream/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '这不是 JSON'
  })
  assert.equal(response.status, 400)
})

test('界面里改的连接地址，下一次请求就用上', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const before = await (await fetch(`${env.base}/localdream/status`)).json()
  assert.equal(before.address.controlBaseUrl, 'http://127.0.0.1:8808')

  const set = await fetch(`${env.base}/localdream/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', key: 'controlBaseUrl', value: 'http://10.9.9.9:8808' })
  })
  assert.equal(set.status, 200)

  const after = await (await fetch(`${env.base}/localdream/status`)).json()
  assert.equal(after.address.controlBaseUrl, 'http://10.9.9.9:8808')

  // 恢复自动
  await fetch(`${env.base}/localdream/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', key: 'controlBaseUrl', value: '' })
  })
  const restored = await (await fetch(`${env.base}/localdream/status`)).json()
  assert.equal(restored.address.controlBaseUrl, 'http://127.0.0.1:8808')
})

test('非法地址在接口这层就被挡住', async (t) => {
  const env = await startServer()
  t.after(() => env.close())

  const response = await fetch(`${env.base}/localdream/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set', key: 'controlBaseUrl', value: '随便写的' })
  })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error.message, /地址格式/)
})
