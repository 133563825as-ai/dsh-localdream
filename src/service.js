/**
 * Web UI 的出图任务。
 *
 * 出图是分钟级的操作，不能占住一个 HTTP 请求 —— 所以这里是「提交后立即返回、
 * 后台跑、前端轮询状态」的模式。同一时刻只允许一个任务：手机 NPU 扛不住并发，
 * 而且后端的生成互斥锁会让第二个请求排队到超时。
 *
 * @module dsh-localdream/service
 */

import { basename } from 'node:path'

import { runDraw } from './draw-core.js'

/** 只暴露给客户端的字段：完整容器路径没必要、也不该出到浏览器。 */
function toClientFile (file) {
  return {
    name: basename(file.path),
    width: file.width,
    height: file.height,
    format: file.format,
    seed: file.seed ?? null,
    bytes: file.bytes,
    elapsedMs: Math.round(file.elapsedMs ?? 0)
  }
}

function initialSnapshot () {
  return {
    busy: false,
    phase: 'idle',
    step: 0,
    totalSteps: 0,
    index: 0,
    count: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    last: null
  }
}

export class DrawService {
  #client
  #store
  #getConfig
  #state

  /**
   * @param {object} deps
   * @param {import('./client.js').LocalDreamClient} deps.client
   * @param {import('./store.js').LocalDreamStore} deps.store
   * @param {() => object} deps.getConfig
   */
  constructor ({ client, store, getConfig }) {
    this.#client = client
    this.#store = store
    this.#getConfig = getConfig
    this.#state = initialSnapshot()
  }

  /** 当前任务快照。 */
  snapshot () {
    return { ...this.#state }
  }

  /**
   * 提交一次出图。立刻返回，任务在后台跑。
   * @param {object} args - 与 `ld_draw` 同名的入参。
   * @returns {object} 提交后的状态快照。
   */
  start (args) {
    if (this.#state.busy) {
      throw new Error('已经有一张在画了。手机 NPU 一次只能跑一个任务，等它结束再试。')
    }

    this.#state = {
      ...initialSnapshot(),
      busy: true,
      phase: 'selecting',
      startedAt: Date.now()
    }

    void this.#run(args)
    return this.snapshot()
  }

  async #run (args) {
    try {
      const result = await runDraw({
        client: this.#client,
        store: this.#store,
        config: this.#getConfig(),
        args,
        onPhase: (phase) => {
          if (this.#state.busy) this.#state = { ...this.#state, phase }
        },
        onProgress: ({ step, totalSteps, index, count }) => {
          if (!this.#state.busy) return
          this.#state = { ...this.#state, step, totalSteps, index, count }
        }
      })

      this.#state = {
        ...initialSnapshot(),
        phase: 'done',
        finishedAt: Date.now(),
        last: {
          modelId: result.modelId,
          size: result.size,
          params: result.params,
          aspectRatio: result.aspectRatio,
          prompt: result.prompt,
          template: result.template,
          mode: result.mode,
          notes: result.notes,
          files: result.files.map(toClientFile),
          totalElapsedMs: result.totalElapsedMs
        }
      }
    } catch (error) {
      this.#state = {
        ...initialSnapshot(),
        phase: 'error',
        finishedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
