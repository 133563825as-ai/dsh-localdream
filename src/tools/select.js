/**
 * `ld_select` —— 显式挂载模型并等到可出图。
 * @module dsh-localdream/tools/select
 */

import { defineTool } from '../define-tool.js'

import { DEFAULT_SELECT_TIMEOUT_MS } from '../presets.js'
import { text } from './shared.js'

function renderSelect (value) {
  const lines = [
    value.reused
      ? `模型 \`${value.modelId}\` 已经挂着，无需重挂。`
      : `模型 \`${value.modelId}\` 挂载完成。`,
    `后端状态：\`${value.state}\` · 生成口 8081 可连`
  ]
  if (value.width > 0) lines.push(`回显画布：${value.width}×${value.height}`)
  lines.push('')
  lines.push('注意：`/select` 里的宽高只改状态回显，**不影响成图尺寸**；要改出图比例请用 `ld_draw` 的 `aspectRatio`。')
  return lines.join('\n')
}

/**
 * @param {object} deps
 * @param {import('../client.js').LocalDreamClient} deps.client
 */
export function createSelectTool ({ client }) {
  return defineTool({
    name: 'ld_select',
    description:
      '把指定模型挂载到 Local Dream 的 native 后端，并等到生成口就绪。' +
      '切换模型会重新占用内存、触发一次冷启动（首次出图可能 90 秒以上）。' +
      '注意 `ld_draw` 的 `model` 参数只在后端被回收时才会重挂，想主动换模型必须用它。',
    parameters: {
      model: {
        type: 'string',
        required: true,
        description: '模型 id，取自 `ld_status` 的模型清单。'
      },
      timeoutSeconds: {
        type: 'number',
        description: '等待就绪的上限秒数，默认 240。'
      }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => text(renderSelect(value))
    },
    timeoutMs: 15 * 60 * 1000,
    async execute (args) {
      const seconds = Number(args?.timeoutSeconds)
      const waitMs = Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : DEFAULT_SELECT_TIMEOUT_MS

      return client.selectAndWait({ modelId: args.model, waitMs })
    }
  })
}
