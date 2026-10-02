/**
 * `ld_status` —— 受控模式与模型清单的总览。
 * @module dsh-localdream/tools/status
 */

import { defineTool } from '../define-tool.js'

import { normalizeModels, normalizeUpscalers, num, text } from './shared.js'

function renderStatus (value) {
  if (value?.online !== true) {
    const lines = ['Local Dream 受控模式：**未在线**', '']
    const reason = typeof value?.reason === 'string' ? value.reason : ''
    const hint = typeof value?.hint === 'string' ? value.hint : ''
    if (reason !== '') lines.push(reason)
    // reason 里通常已经含了开启指引，别把同一句话印两遍
    if (hint !== '' && hint !== reason && !(reason !== '' && reason.includes(hint))) {
      lines.push('', hint)
    }
    return lines.join('\n')
  }

  const parts = []
  const device = value.device ? `（${value.device}）` : ''
  const version = value.version ? ` v${value.version}` : ''
  parts.push(`Local Dream 受控模式：**在线**${device}${version}`)

  const backend = [`后端 \`${value.state ?? 'unknown'}\``]
  backend.push(value.servingModelId ? `模型 \`${value.servingModelId}\`` : '未挂载模型')
  backend.push(value.generatePortAlive ? '生成口 8081 可连' : '⚠️ 生成口 8081 不可连')
  parts.push(backend.join(' · '))

  if (value.canvas?.width > 0) {
    parts.push(`画布 ${value.canvas.width}×${value.canvas.height}`)
  }
  if (value.message) parts.push(`后端消息：${value.message}`)
  if (value.modelsError) parts.push(`模型清单读取失败：${value.modelsError}`)

  if (Array.isArray(value.models)) {
    parts.push('')
    parts.push(`已装模型（${value.models.length}）：`)
    for (const model of value.models) {
      const tags = []
      if (model.isSdxl) tags.push('sdxl')
      if (model.isAnima) tags.push('anima')
      const suffix = tags.length > 0 ? ` ${tags.join('/')}` : ''
      const defaults = model.defaults ?? {}
      const tuning = [
        defaults.steps === undefined ? null : `${num(Number(defaults.steps))} 步`,
        defaults.cfg === undefined ? null : `CFG ${num(Number(defaults.cfg))}`,
        defaults.scheduler ?? null
      ].filter((item) => item !== null).join(' · ')
      parts.push(`- \`${model.id}\`${suffix} · 基准 ${model.generationSize}${tuning ? ` · ${tuning}` : ''}`)
    }
  }

  if (Array.isArray(value.upscalers) && value.upscalers.length > 0) {
    parts.push('')
    parts.push(`放大器（${value.upscalers.length}）：`)
    for (const upscaler of value.upscalers) {
      parts.push(`- \`${upscaler.id}\` → ${upscaler.path}`)
    }
  }

  return parts.join('\n')
}

/**
 * @param {object} deps
 * @param {import('../client.js').LocalDreamClient} deps.client
 */
export function createStatusTool ({ client }) {
  return defineTool({
    name: 'ld_status',
    description:
      '查看手机端 Local Dream「受控模式」的可用状态：是否在线、当前挂着哪个模型、' +
      'native 后端状态、生成口是否可连，以及已装模型与放大器清单。' +
      '准备出图前先用它确认服务可用；offline 时把它给的重启指引转述给使用者。',
    parameters: {
      includeModels: {
        type: 'boolean',
        description: '是否附带已装模型与放大器清单，默认 true。模型很多时可以关掉。'
      }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => text(renderStatus(value))
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute (args) {
      const includeModels = args?.includeModels !== false
      const snapshot = await client.snapshot()

      if (snapshot.online !== true) {
        return { online: false, reason: snapshot.reason, hint: snapshot.hint }
      }

      const status = snapshot.status ?? {}
      const info = snapshot.info ?? {}
      const result = {
        online: true,
        device: info.device,
        version: info.version,
        protocol: info.protocol,
        state: status.state,
        servingModelId: status.serving_model_id ?? null,
        message: status.message ?? null,
        canvas: { width: Number(status.width ?? 0), height: Number(status.height ?? 0) },
        generatePortAlive: snapshot.generatePortAlive === true
      }

      if (includeModels) {
        try {
          const listing = await client.models()
          result.models = normalizeModels(listing)
          result.upscalers = normalizeUpscalers(listing)
          result.useImg2img = listing?.use_img2img ?? null
        } catch (error) {
          result.modelsError = error instanceof Error ? error.message : String(error)
        }
      }

      return result
    }
  })
}
