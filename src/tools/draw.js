/**
 * `ld_draw` —— 文生图 / 图生图（模型可见工具）。
 *
 * 真正的执行链路在 `../draw-core.js`，Web UI 的出图按钮走同一份实现。
 *
 * @module dsh-localdream/tools/draw
 */

import { defineTool } from '../define-tool.js'

import { runDraw } from '../draw-core.js'
import { SCHEDULERS } from '../presets.js'
import { humanBytes, num, text } from './shared.js'

const PARAM_SOURCE_LABEL = {
  explicit: '显式指定',
  template: '提示词模板',
  preset: '容器里的模型预设',
  'model-defaults': '后端模型默认值',
  fallback: '全局兜底'
}

export function renderDraw (value) {
  const lines = []
  const mode = value.mode === 'img2img' ? '图生图' : '文生图'
  lines.push(
    `${mode}完成 · 模型 \`${value.modelId}\` · ${value.size.width}×${value.size.height} · ` +
      `${num(value.params.steps)} 步 / CFG ${num(value.params.cfg)} / ${value.params.scheduler} · ` +
      `${value.files.length} 张`
  )
  if (value.mode === 'img2img') {
    lines.push(`重绘强度 denoise = ${num(value.denoise)}（输入图 \`${value.sourceImage}\`）`)
  }
  lines.push('')

  for (const file of value.files) {
    lines.push(`![Local Dream 生成图](${file.path})`)
    const meta = [
      `\`${file.path}\``,
      `${file.width}×${file.height}`,
      file.format.toUpperCase(),
      `seed ${file.seed ?? '随机'}`,
      `${(file.elapsedMs / 1000).toFixed(1)}s`,
      humanBytes(file.bytes)
    ]
    lines.push(`- ${meta.join(' · ')}`)
    lines.push('')
  }

  lines.push(`参数来源：${PARAM_SOURCE_LABEL[value.params.source] ?? value.params.source}`)
  lines.push(`时长：${(value.totalElapsedMs / 1000).toFixed(1)}s · 输出目录：\`${value.outputDir}\``)

  if (value.notes.length > 0) {
    lines.push('')
    for (const note of value.notes) lines.push(`> ${note}`)
  }

  return lines.join('\n')
}

/**
 * @param {object} deps
 * @param {import('../client.js').LocalDreamClient} deps.client
 * @param {import('../store.js').LocalDreamStore} deps.store
 * @param {() => object} deps.getConfig - 返回插件配置。
 */
export function createDrawTool ({ client, store, getConfig }) {
  return defineTool({
    name: 'ld_draw',
    description:
      '用手机本地 NPU 出图（Local Dream 受控模式）。支持文生图与图生图，全程离线、不计费。' +
      '输出是容器里的绝对路径，直接贴给用户即可。' +
      '不绑定任何具体模型：步数 / CFG / 采样器缺省时按「提示词模板 → 容器里的模型预设 → 后端该模型的默认值 → 全局兜底」取。' +
      '改方向用 aspectRatio（它才真正决定成图尺寸），width / height 会被后端忽略。' +
      'cfg = 1.0 等于关掉负面提示词分支，此时 negativePrompt 完全不生效。',
    parameters: {
      prompt: {
        type: 'string',
        description: '正面提示词。也可以用 template 参数套用已存的模板，二者至少给一个。'
      },
      template: {
        type: 'string',
        description:
          '提示词模板名（用 ld_prompt 管理）。套用模板里的 prompt / negativePrompt / aspectRatio / ' +
          'steps / cfg / scheduler / model，显式传的参数仍然优先。'
      },
      negativePrompt: {
        type: 'string',
        description:
          '负面提示词。缺省按「模板 → 容器默认（ld_config 的 defaultNegativePrompt）→ 内置通用质量词」取，' +
          '仅在 cfg > 1 时生效。'
      },
      model: {
        type: 'string',
        description:
          '指定模型 id（取自 ld_status）。指定后会显式切换模型，代价是一次冷启动；' +
          '不传则沿用后端当前热着的模型。'
      },
      steps: { type: 'number', description: '采样步数。缺省按模型自己的默认值取。' },
      cfg: { type: 'number', description: 'CFG。缺省按模型默认值取。设为 1.0 会关掉负面提示词。' },
      scheduler: { type: 'string', enum: [...SCHEDULERS], description: '采样器。缺省按模型默认值取。' },
      aspectRatio: {
        type: 'string',
        description:
          '宽高比，真正决定成图尺寸的字段。任意 "宽:高" 都行（"1:1" "4:3" "3:2" "16:9" "2:1" "3:4" "9:16"…）。' +
          '长边固定为该模型的基准尺寸，短边向 8 的倍数取整。'
      },
      seed: {
        type: 'number',
        description: '随机种子，指定后结果可复现。连出多张时依次 +1。不传则随机。'
      },
      count: { type: 'number', description: '连出张数，默认 1。上限由 ld_config 的 maxBatch 决定。' },
      outputFormat: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: '落盘格式。png 无损、能被 ld_enhance 直接再处理；jpeg 体积小很多。'
      },
      image: {
        type: 'string',
        description:
          '图生图输入图路径。尺寸**必须**等于 aspectRatio 的换算值，否则后端报 Img size mismatch。'
      },
      denoise: {
        type: 'number',
        description:
          '图生图重绘强度，缺省 0.85。≥0.85 才会真正换角色；0.4~0.6 用于保留构图做局部改动。' +
          '纯文生图时无效。'
      },
      outputDir: { type: 'string', description: '输出目录，默认插件配置的 outputDir。' },
      timeoutSeconds: { type: 'number', description: '单张生成的超时上限秒数，默认由插件配置决定。' }
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => text(renderDraw(value))
    },
    timeoutMs: 30 * 60 * 1000,
    async execute (args) {
      return runDraw({ client, store, config: getConfig(), args })
    }
  })
}
