/**
 * Web UI 的 HTTP 接口，挂在 webServer 的 `/localdream` 前缀下。
 *
 * 客户端半身不碰 Node API，所有数据和动作都走这里。
 *
 * @module dsh-localdream/http
 */

import { readFile } from 'node:fs/promises'

import { contentTypeFor, listImages, resolveImagePath } from './gallery.js'
import { MODEL_PRESET_KEYS, SETTINGS_KEYS } from './store.js'
import { SCHEDULERS } from './presets.js'

/** 允许从 UI 透传给出图核心的字段。别的键一律丢掉。 */
const DRAW_ARG_KEYS = [
  'prompt',
  'template',
  'negativePrompt',
  'model',
  'steps',
  'cfg',
  'scheduler',
  'aspectRatio',
  'seed',
  'count',
  'outputFormat',
  'image',
  'denoise',
  'timeoutSeconds'
]

const MAX_BODY_BYTES = 256 * 1024
const MAX_GALLERY_LIMIT = 200

class HttpError extends Error {
  constructor (status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function sendJson (res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

function fail (res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } })
}

async function readJsonBody (req, { allowEmpty = false } = {}) {
  const declared = req.headers?.['content-length']
  if (declared !== undefined) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) throw new HttpError(400, 'invalid-content-length', '请求体长度无效')
    if (length > MAX_BODY_BYTES) throw new HttpError(413, 'body-too-large', '请求体过大')
  }

  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'body-too-large', '请求体过大')
    chunks.push(chunk)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') {
    if (allowEmpty) return {}
    throw new HttpError(400, 'invalid-json', '请求体不能为空')
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid-json', '请求不是有效 JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid-json', '请求体必须是 JSON 对象')
  }
  return parsed
}

function pickDrawArgs (body) {
  const args = {}
  for (const key of DRAW_ARG_KEYS) {
    if (body[key] !== undefined) args[key] = body[key]
  }
  return args
}

async function serveFile (res, path) {
  let data
  try {
    data = await readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return fail(res, 404, 'not-found', '图片不存在或已被删除')
    throw error
  }
  res.writeHead(200, {
    'Content-Type': contentTypeFor(path),
    'Cache-Control': 'private, max-age=300',
    'Content-Length': data.length
  })
  res.end(data)
}

async function dispatch (req, res, deps) {
  const { client, store, service, getConfig } = deps
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname
  const method = (req.method ?? 'GET').toUpperCase()
  const config = getConfig()

  // 界面里改的地址存在容器里：每个请求进来先同步一次，所以改完立即生效，
  // 不需要重启。读盘失败就用当前地址，不该因此让路由挂掉。
  try {
    const settings = await store.readSettings()
    client.setBaseUrls({
      controlBaseUrl: settings.controlBaseUrl,
      generateBaseUrl: settings.generateBaseUrl
    })
  } catch {
    // 忽略：用当前地址继续
  }

  if (pathname === '/localdream/status') {
    if (method !== 'GET') return fail(res, 405, 'method-not-allowed', '只支持 GET')

    const snapshot = await client.snapshot()
    const settings = await store.readSettings()
    const payload = {
      ok: true,
      online: snapshot.online === true,
      hint: snapshot.hint ?? null,
      reason: snapshot.reason ?? null,
      info: snapshot.info ?? null,
      state: snapshot.status?.state ?? null,
      servingModelId: snapshot.status?.serving_model_id ?? null,
      message: snapshot.status?.message ?? null,
      generatePortAlive: snapshot.generatePortAlive === true,
      settings,
      address: typeof client.getBaseUrls === 'function' ? client.getBaseUrls() : null,
      paths: { output: config.outputDir, root: store.paths.root },
      maxBatch: settings.maxBatch ?? config.maxBatch,
      schedulers: [...SCHEDULERS],
      models: [],
      upscalers: []
    }

    if (snapshot.online === true) {
      try {
        const listing = await client.models()
        payload.models = (listing?.models ?? []).map((entry) => ({
          id: entry.id,
          generationSize: Number(entry.generation_size ?? 1024) || 1024,
          isSdxl: Boolean(entry.is_sdxl),
          isAnima: Boolean(entry.is_anima),
          defaults: {
            steps: entry.defaults?.steps,
            cfg: entry.defaults?.cfg,
            scheduler: entry.defaults?.scheduler
          }
        }))
        payload.upscalers = (listing?.upscalers ?? []).map((entry) => ({ id: entry.id, path: entry.path }))
      } catch (error) {
        payload.modelsError = error instanceof Error ? error.message : String(error)
      }
    }

    return sendJson(res, 200, payload)
  }

  if (pathname === '/localdream/gallery') {
    if (method !== 'GET') return fail(res, 405, 'method-not-allowed', '只支持 GET')
    const limit = Number(url.searchParams.get('limit') ?? 60)
    const images = await listImages(config.outputDir, {
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(MAX_GALLERY_LIMIT, limit)) : 60,
      grep: url.searchParams.get('grep') ?? undefined
    })
    return sendJson(res, 200, { ok: true, images })
  }

  if (pathname === '/localdream/file') {
    if (method !== 'GET') return fail(res, 405, 'method-not-allowed', '只支持 GET')
    const name = url.searchParams.get('name') ?? ''
    // 文件名解析失败（空名、非图片扩展名、路径穿越）是调用方的问题，明确回 400。
    let path
    try {
      path = resolveImagePath(config.outputDir, name)
    } catch (error) {
      return fail(res, 400, 'invalid-name', error instanceof Error ? error.message : String(error))
    }
    return serveFile(res, path)
  }

  if (pathname === '/localdream/draw') {
    if (method === 'GET') return sendJson(res, 200, { ok: true, task: service.snapshot() })
    if (method !== 'POST') return fail(res, 405, 'method-not-allowed', '只支持 GET / POST')

    const body = await readJsonBody(req)
    const args = pickDrawArgs(body)
    const hasPrompt = typeof args.prompt === 'string' && args.prompt.trim() !== ''
    const hasTemplate = typeof args.template === 'string' && args.template.trim() !== ''
    if (!hasPrompt && !hasTemplate) {
      return fail(res, 400, 'missing-prompt', '要么填提示词，要么选一个提示词模板')
    }

    try {
      const task = service.start(args)
      return sendJson(res, 202, { ok: true, task })
    } catch (error) {
      return fail(res, 409, 'busy', error instanceof Error ? error.message : String(error))
    }
  }

  if (pathname === '/localdream/select') {
    if (method !== 'POST') return fail(res, 405, 'method-not-allowed', '只支持 POST')
    const body = await readJsonBody(req)
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (model === '') return fail(res, 400, 'invalid-model', '必须提供模型 id')
    if (service.snapshot().busy) return fail(res, 409, 'busy', '正在出图，等它结束再切模型')
    try {
      const result = await client.selectAndWait({ modelId: model })
      return sendJson(res, 200, { ok: true, model: result.modelId })
    } catch (error) {
      return fail(res, 500, 'select-failed', error instanceof Error ? error.message : String(error))
    }
  }

  if (pathname === '/localdream/config') {
    if (method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        settings: await store.readSettings(),
        modelPresets: await store.readModelPresets(),
        settingsKeys: Object.keys(SETTINGS_KEYS),
        presetKeys: Object.keys(MODEL_PRESET_KEYS),
        paths: store.paths
      })
    }
    if (method !== 'POST') return fail(res, 405, 'method-not-allowed', '只支持 GET / POST')

    const body = await readJsonBody(req)
    const action = body.action
    const key = typeof body.key === 'string' ? body.key.trim() : ''

    if (action === 'set') {
      if (key === '') return fail(res, 400, 'invalid-key', '必须提供 key')
      if (body.value === undefined) return fail(res, 400, 'invalid-value', '必须提供 value')
      const presetMatch = /^models\.(.+)\.([A-Za-z]+)$/.exec(key)
      if (presetMatch !== null) {
        await store.setModelPreset(presetMatch[1], presetMatch[2], body.value)
        return sendJson(res, 200, { ok: true, modelPresets: await store.readModelPresets() })
      }
      const settings = await store.setSetting(key, body.value)
      return sendJson(res, 200, { ok: true, settings })
    }

    if (action === 'reset') {
      if (key === '') {
        await store.resetSettings('')
        await store.resetModelPresets('')
      } else if (/^models\.(.+)$/.test(key)) {
        await store.resetModelPresets(/^models\.(.+)$/.exec(key)[1])
      } else {
        await store.resetSettings(key)
      }
      return sendJson(res, 200, {
        ok: true,
        settings: await store.readSettings(),
        modelPresets: await store.readModelPresets()
      })
    }

    return fail(res, 400, 'invalid-action', 'action 只能是 set 或 reset')
  }

  if (pathname === '/localdream/prompts') {
    if (method === 'GET') {
      return sendJson(res, 200, { ok: true, templates: await store.listPrompts() })
    }
    if (method !== 'POST') return fail(res, 405, 'method-not-allowed', '只支持 GET / POST')

    const body = await readJsonBody(req)
    const action = body.action
    const name = typeof body.name === 'string' ? body.name : ''

    if (action === 'save') {
      if (name.trim() === '') return fail(res, 400, 'invalid-name', '必须提供模板名')
      const patch = {}
      for (const field of ['prompt', 'negativePrompt', 'aspectRatio', 'steps', 'cfg', 'scheduler', 'model', 'note']) {
        if (body[field] !== undefined) patch[field] = body[field]
      }
      const template = await store.writePrompt(name, patch)
      return sendJson(res, 200, { ok: true, template })
    }

    if (action === 'remove') {
      if (name.trim() === '') return fail(res, 400, 'invalid-name', '必须提供模板名')
      const removed = await store.removePrompt(name)
      return sendJson(res, 200, { ok: true, removed })
    }

    return fail(res, 400, 'invalid-action', 'action 只能是 save 或 remove')
  }

  return fail(res, 404, 'not-found', '接口不存在')
}

/**
 * 把路由挂到 webServer 上。
 * @param {object} deps
 * @param {object} deps.webServer
 * @param {import('./client.js').LocalDreamClient} deps.client
 * @param {import('./store.js').LocalDreamStore} deps.store
 * @param {import('./service.js').DrawService} deps.service
 * @param {() => object} deps.getConfig
 * @returns {() => void} disposer
 */
export function registerRoutes ({ webServer, client, store, service, getConfig }) {
  return webServer.register({
    kind: 'prefix',
    path: '/localdream',
    async handler (req, res) {
      try {
        await dispatch(req, res, { client, store, service, getConfig })
      } catch (error) {
        if (error instanceof HttpError) {
          fail(res, error.status, error.code, error.message)
          return
        }
        // 配置层的校验错误（非法键 / 非法值 / 模板名不合法）是有意抛给使用者的，
        // 原样转述比笼统的「操作失败」有用得多。
        const message = error instanceof Error ? error.message : String(error)
        const isValidation = /不能|必须|只能|未知的|没有名为|无效|格式|上限|需要/.test(message)
        if (isValidation) {
          fail(res, 400, 'invalid-request', message)
          return
        }
        fail(res, 500, 'internal-error', '操作失败')
      }
    }
  })
}
