/**
 * Local Dream 受控模式 HTTP 客户端。
 *
 * 两个端口，性质完全不同：
 * - **控制口**（默认 `127.0.0.1:8808`，Kotlin 侧 JSON API）：`GET /info` `/models` `/status`，`POST /select` `/stop`
 * - **生成口**（默认 `127.0.0.1:8081`，native 后端）：`POST /generate`（SSE 流）、`POST /upscale`（raw body）
 *
 * 两个端口都在手机的 loopback 上，容器里可直连 —— 不需要局域网，也不需要 ADB。
 *
 * @module dsh-localdream/client
 */

import {
  DEFAULT_GENERATE_TIMEOUT_MS,
  DEFAULT_SELECT_TIMEOUT_MS
} from './presets.js'

/** 受控模式没开、或被系统回收时抛出的错误。调用方应当直接把它转述给使用者。 */
export class LocalDreamUnavailableError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LocalDreamUnavailableError'
  }
}

const OPEN_HINT =
  '受控模式没在运行。请在手机上打开 Local Dream → 模型列表右上角 ⋮ → 设备互联 → 「进入受控模式」，' +
  '然后重试。这一步只能在 App 里手点，重试不会让它自己起来。'

/** 内置默认地址。Local Dream 的受控模式固定监听这两个 loopback 端口。 */
export const DEFAULT_CONTROL_URL = 'http://127.0.0.1:8808'
export const DEFAULT_GENERATE_URL = 'http://127.0.0.1:8081'

function timeoutMillis (value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 空串 / 非字符串 → 回落到默认地址；否则去掉尾部斜杠。 */
function normalizeBaseUrl (value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return fallback
  return text.replace(/\/+$/, '')
}

/**
 * 把底层网络错误翻译成使用者看得懂的提示。
 * @param {unknown} error
 * @param {string} what
 * @returns {Error}
 */
function translate (error, what) {
  if (error instanceof LocalDreamUnavailableError) return error
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new Error(`${what} 超时。后端可能正在冷启动，或已被系统回收。`)
  }
  const code = error?.cause?.code ?? error?.code
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    return new LocalDreamUnavailableError(`${what} 连不上（${code}）。${OPEN_HINT}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function readJson (response, what) {
  const text = await response.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${what} 返回的不是 JSON：${text.slice(0, 200)}`)
  }
}

/**
 * 解析一小段 SSE 文本，返回其中的消息对象与是否已收到 `[DONE]`。
 * 抽出来是为了能在离线单测里覆盖流式解析逻辑。
 *
 * @param {string} line - 不含换行符的一行。
 * @returns {{message: object|null, done: boolean}}
 */
export function parseSseLine (line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return { message: null, done: false }
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return { message: null, done: true }
  if (payload === '') return { message: null, done: false }
  try {
    return { message: JSON.parse(payload), done: false }
  } catch {
    return { message: null, done: false }
  }
}

export class LocalDreamClient {
  /**
   * @param {object} options
   * @param {string} [options.controlBaseUrl]
   * @param {string} [options.generateBaseUrl]
   * @param {string} [options.defaultModel] - 后端被回收时默认重挂哪个模型，空串表示必须显式指定。
   * @param {number} [options.generateTimeoutMs]
   * @param {typeof fetch} [options.fetchImpl] - 注入点，单测用来打桩。
   * @param {(message: string) => void} [options.log]
   */
  constructor (options = {}) {
    this.controlBaseUrl = normalizeBaseUrl(options.controlBaseUrl, DEFAULT_CONTROL_URL)
    this.generateBaseUrl = normalizeBaseUrl(options.generateBaseUrl, DEFAULT_GENERATE_URL)
    this.defaultModel = options.defaultModel ?? ''
    this.generateTimeoutMs = timeoutMillis(options.generateTimeoutMs, DEFAULT_GENERATE_TIMEOUT_MS)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.log = options.log ?? (() => {})
  }

  /**
   * 运行期改地址。空串表示回到内置默认。
   *
   * UI 里填的地址存在容器里，每个 HTTP 请求进来时同步一次 —— 所以改完立即生效，
   * 不需要重启宿主。
   *
   * @param {{controlBaseUrl?: string, generateBaseUrl?: string}} [urls]
   */
  setBaseUrls ({ controlBaseUrl, generateBaseUrl } = {}) {
    if (controlBaseUrl !== undefined) {
      this.controlBaseUrl = normalizeBaseUrl(controlBaseUrl, DEFAULT_CONTROL_URL)
    }
    if (generateBaseUrl !== undefined) {
      this.generateBaseUrl = normalizeBaseUrl(generateBaseUrl, DEFAULT_GENERATE_URL)
    }
  }

  /** 当前实际在用的两个地址，给界面显示用。 */
  getBaseUrls () {
    return { controlBaseUrl: this.controlBaseUrl, generateBaseUrl: this.generateBaseUrl }
  }

  async controlGet (path, { timeoutMs = 15_000 } = {}) {
    let response
    try {
      response = await this.fetchImpl(`${this.controlBaseUrl}${path}`, {
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw translate(error, `控制口 ${path}`)
    }
    if (!response.ok) throw new Error(`控制口 ${path} 返回 HTTP ${response.status}`)
    return readJson(response, `控制口 ${path}`)
  }

  async controlPost (path, body, { timeoutMs = 30_000 } = {}) {
    let response
    try {
      response = await this.fetchImpl(`${this.controlBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw translate(error, `控制口 ${path}`)
    }
    if (!response.ok) throw new Error(`控制口 ${path} 返回 HTTP ${response.status}`)
    return readJson(response, `控制口 ${path}`)
  }

  /** `GET /info` —— 受控模式是否在线。连不上会抛 {@link LocalDreamUnavailableError}。 */
  info (options) {
    return this.controlGet('/info', options)
  }

  /** `GET /models` —— 已装模型、各自默认参数与放大器列表。 */
  models (options) {
    return this.controlGet('/models', { timeoutMs: 30_000, ...options })
  }

  /** `GET /status` —— native 后端状态，`state` 为 `idle` / `running` / `error` 等。 */
  status (options) {
    return this.controlGet('/status', options)
  }

  /**
   * `POST /select` —— 挂载模型。
   *
   * 这里的 `width` / `height` **只改 `/status` 的回显，不影响成图**，所以不给就用
   * 模型自己的基准尺寸（见 {@link modelCanvas}），省得写死一个不属于任何模型的数字。
   */
  select ({ modelId, width, height }, options) {
    const body = { model_id: modelId }
    const w = Number(width)
    const h = Number(height)
    if (Number.isFinite(w) && w > 0) body.width = w
    if (Number.isFinite(h) && h > 0) body.height = h
    return this.controlPost('/select', body, options)
  }

  /**
   * 查某个模型的基准画布尺寸。
   *
   * 从后端 `/models` 的 `generation_size` 取 —— 不同模型可能不同，不写死。
   * 查不到时回落到 `fallback`（Local Dream 后端的常见默认，仅用于 `/select` 回显）。
   *
   * @param {string} modelId
   * @param {number} [fallback]
   * @returns {Promise<{width: number, height: number}>}
   */
  async modelCanvas (modelId, fallback = 1024) {
    try {
      const listing = await this.models()
      const entry = (listing?.models ?? []).find((item) => item?.id === modelId)
      const size = Number(entry?.generation_size)
      if (Number.isFinite(size) && size > 0) return { width: size, height: size }
    } catch {
      // 查不到不是错误：/select 的宽高本来就不影响成图。
    }
    return { width: fallback, height: fallback }
  }

  /** `POST /stop` —— 卸载当前模型，释放内存。 */
  stop ({ modelId }, options) {
    return this.controlPost('/stop', { model_id: modelId }, options)
  }

  /**
   * 8081 是否真的在监听。
   * `state=running` 不代表端口已就绪 —— 切模型有一段窗口期，这个探测比状态字段可靠。
   */
  async generatePortAlive ({ timeoutMs = 3_000 } = {}) {
    try {
      await this.fetchImpl(`${this.generateBaseUrl}/`, { signal: AbortSignal.timeout(timeoutMs) })
      return true
    } catch (error) {
      // 404 也说明端口活着
      if (typeof error?.message === 'string' && /\bHTTP\s*4\d\d\b/.test(error.message)) return true
      const code = error?.cause?.code ?? error?.code
      if (code === 'ECONNREFUSED') return false
      return false
    }
  }

  /**
   * `POST /generate` —— 流式出图，返回 `complete` 事件。
   *
   * ⚠️ 字段名陷阱：img2img 的输入图字段**只有 `image`** 一个。
   * `init_image` / `input_image` / `image_base64` 之流会被**静默忽略**，
   * 照常返回一张 txt2img 的图，不报任何错。
   *
   * @param {object} body - 直接发给后端的请求体。
   * @param {object} [options]
   * @param {(progress: {step: number, totalSteps: number}) => void} [options.onProgress]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<object>} `complete` 事件，附带 `elapsedMs`。
   */
  async generate (body, { onProgress, timeoutMs } = {}) {
    const limit = timeoutMillis(timeoutMs, this.generateTimeoutMs)
    const started = Date.now()

    let response
    try {
      response = await this.fetchImpl(`${this.generateBaseUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(limit)
      })
    } catch (error) {
      throw translate(error, '生成口 /generate')
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`生成口 /generate 返回 HTTP ${response.status}：${detail.slice(0, 300)}`)
    }
    if (response.body === null || response.body === undefined) {
      throw new Error('生成口没有返回流式响应体')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let complete = null

    const consume = (line) => {
      const { message, done } = parseSseLine(line)
      if (done) return true
      if (message === null) return false
      if (message.type === 'progress') {
        onProgress?.({ step: message.step, totalSteps: message.total_steps })
      } else if (message.type === 'complete') {
        complete = message
      } else if (message.type === 'error') {
        throw new Error(`后端报错：${message.message ?? '未提供错误信息'}`)
      }
      return false
    }

    try {
      // finished 由 [DONE] 置位。不能用「buffer 是否为空」判断结束 ——
      // 一个 chunk 恰好以换行结尾时 buffer 就是空的，那样会提前跳出、丢掉后面的 complete。
      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          if (consume(line)) {
            finished = true
            buffer = ''
            break
          }
          index = buffer.indexOf('\n')
        }
      }
      if (!finished && buffer.trim() !== '') consume(buffer)
    } catch (error) {
      throw translate(error, '读取生成流')
    } finally {
      await reader.cancel?.().catch?.(() => {})
      reader.releaseLock?.()
    }

    if (complete === null) {
      throw new Error(
        '没有收到 complete 事件。通常是后端在生成中途被系统回收 —— 重跑一次；' +
          '仍失败就先挂载一次模型再重试。'
      )
    }

    return { ...complete, elapsedMs: Date.now() - started }
  }

  /**
   * `POST /upscale` —— 固定 ×4 放大，输出 JPEG。
   *
   * 这个端点**不是 JSON**：尺寸与放大器路径走 HTTP 头，body 是 raw RGB24，
   * 字节数必须恰好等于 `width * height * 3`。
   *
   * @param {object} options
   * @param {Buffer} options.rgb - raw RGB24 像素。
   * @param {number} options.width
   * @param {number} options.height
   * @param {string} options.upscalerPath - 放大器模型路径，`.mnn` 走 MNN，其余走 QNN。
   * @param {boolean} [options.useOpencl]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<Buffer>} JPEG 数据。
   */
  async upscale ({ rgb, width, height, upscalerPath, useOpencl = false, timeoutMs } = {}) {
    if (!Buffer.isBuffer(rgb) || rgb.length !== width * height * 3) {
      throw new Error(`/upscale 需要 raw RGB24，期望 ${width * height * 3} 字节`)
    }
    if (typeof upscalerPath !== 'string' || upscalerPath === '') {
      throw new Error('/upscale 必须提供放大器模型路径（X-Upscaler-Path）')
    }

    const limit = timeoutMillis(timeoutMs, this.generateTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(`${this.generateBaseUrl}/upscale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Image-Width': String(width),
          'X-Image-Height': String(height),
          'X-Upscaler-Path': upscalerPath,
          'X-Use-OpenCL': useOpencl ? 'true' : 'false'
        },
        body: rgb,
        signal: AbortSignal.timeout(limit)
      })
    } catch (error) {
      throw translate(error, '生成口 /upscale')
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`生成口 /upscale 返回 HTTP ${response.status}：${detail.slice(0, 300)}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * 确保后端处于可出图状态，必要时自动重挂模型。
   *
   * 三种情形分开处理，因为对策不同：
   * 1. `state=running` 但端口没起 → 只是切模型的窗口期，**等**，别重挂。
   * 2. `state` 非 running → 后端被系统回收，**重挂**指定模型。
   * 3. 端口一直不起 → 如实报错，不无限等。
   *
   * @param {object} [options]
   * @param {string} [options.modelId] - 需要挂载的模型；为空时用配置的 `defaultModel`。
   * @param {number} [options.waitMs]
   * @returns {Promise<{modelId: string, state: string, reused: boolean}>}
   */
  async ensureBackend ({ modelId, waitMs = DEFAULT_SELECT_TIMEOUT_MS } = {}) {
    const status = await this.status()
    const state = status?.state ?? 'unknown'
    const serving = status?.serving_model_id ?? ''

    if (state === 'running') {
      const ready = await this.waitForGeneratePort(waitMs)
      if (!ready) throw new Error('后端报 running，但生成口 8081 一直不可连。稍后重试，或在 App 里重新进入受控模式。')
      return { modelId: serving, state, reused: true }
    }

    const target = (modelId ?? '') !== '' ? modelId : this.defaultModel
    if (target === '') {
      throw new Error(
        `后端 state=${state} 且没有可用的重挂目标。请显式指定 model，` +
          '或在插件配置里设置 defaultModel。'
      )
    }

    this.log(`后端 state=${state} → 自动重挂 ${target}`)
    return this.selectAndWait({ modelId: target, waitMs })
  }

  /**
   * 显式切换模型并等到可出图。
   *
   * 与 {@link ensureBackend} 的区别：这个方法**总是**下发 `/select`（除非目标模型
   * 已经挂着且端口就绪），用于「我就是要换成这个模型」的语义 ——
   * 而 `ensureBackend` 只在后端被回收时才重挂，不会主动换掉热着的模型。
   *
   * @param {object} options
   * @param {string} options.modelId
   * @param {number} [options.width] - 只改 `/status` 回显，不影响成图。
   * @param {number} [options.height]
   * @param {number} [options.waitMs]
   * @returns {Promise<{modelId: string, state: string, reused: boolean, width: number, height: number}>}
   */
  async selectAndWait ({ modelId, width, height, waitMs = DEFAULT_SELECT_TIMEOUT_MS } = {}) {
    if (typeof modelId !== 'string' || modelId === '') throw new Error('modelId 不能为空')

    const requestedWidth = Number(width)
    const requested = Number.isFinite(requestedWidth) && requestedWidth > 0
      ? { width: requestedWidth, height: Number(height) > 0 ? Number(height) : requestedWidth }
      : await this.modelCanvas(modelId)

    const before = await this.status().catch(() => null)
    if (
      before?.state === 'running' &&
      before?.serving_model_id === modelId &&
      (await this.generatePortAlive())
    ) {
      return { modelId, state: 'running', reused: true, ...requested }
    }

    await this.select({ modelId, width: requested.width, height: requested.height })

    const deadline = Date.now() + waitMs
    for (;;) {
      await sleep(3_000)
      const current = await this.status()
      if (current?.state === 'error') {
        throw new Error(`挂载 ${modelId} 失败：${current?.message ?? '后端未提供原因'}`)
      }
      if (current?.state === 'running' && (await this.generatePortAlive())) {
        return {
          modelId: current.serving_model_id ?? modelId,
          state: 'running',
          reused: false,
          ...requested
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(`挂载 ${modelId} 等待超时（${Math.round(waitMs / 1000)}s 未就绪）`)
      }
    }
  }

  /** 轮询直到生成口可连，返回是否成功。 */
  async waitForGeneratePort (waitMs) {
    const deadline = Date.now() + waitMs
    for (;;) {
      if (await this.generatePortAlive()) return true
      if (Date.now() >= deadline) return false
      await sleep(2_000)
    }
  }

  /**
   * 一次拿齐受控模式的全貌，用于状态工具。
   * 控制口连不上时返回 `online: false`，而不是抛错 —— 状态查询是给人看的。
   */
  async snapshot () {
    try {
      const [info, status] = await Promise.all([
        this.info({ timeoutMs: 6_000 }),
        this.status({ timeoutMs: 6_000 })
      ])
      return {
        online: true,
        info,
        status,
        generatePortAlive: await this.generatePortAlive()
      }
    } catch (error) {
      return {
        online: false,
        reason: error instanceof Error ? error.message : String(error),
        hint: OPEN_HINT
      }
    }
  }
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { OPEN_HINT }
