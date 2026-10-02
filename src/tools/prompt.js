/**
 * `ld_prompt` —— 容器里的提示词模板库。
 * @module dsh-localdream/tools/prompt
 */

import { defineTool } from '../define-tool.js'

import { SCHEDULERS } from '../presets.js'
import { num, text } from './shared.js'

/** 模板里可以带上的生成参数。`ld_draw` 的 `template` 参数会套用它们。 */
const TEMPLATE_FIELDS = ['prompt', 'negativePrompt', 'aspectRatio', 'steps', 'cfg', 'scheduler', 'model', 'note']

function summarize (template) {
  const prompt = String(template.prompt ?? '').replace(/\s+/g, ' ').trim()
  const head = prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt
  const tuning = [
    template.aspectRatio ? `AR ${template.aspectRatio}` : null,
    template.steps !== undefined ? `${num(Number(template.steps))} 步` : null,
    template.cfg !== undefined ? `CFG ${num(Number(template.cfg))}` : null,
    template.scheduler ?? null,
    template.model ? `模型 ${template.model}` : null
  ].filter((item) => item !== null)
  return { head, tuning }
}

function renderList (value) {
  if (value.templates.length === 0) {
    return [
      '提示词模板库是空的。',
      '',
      `目录：\`${value.paths.prompts}\``,
      '用 `ld_prompt` 的 action="save" 存一个，或者直接在容器里往这个目录丢 JSON。'
    ].join('\n')
  }
  const lines = [`提示词模板（${value.templates.length}）· 目录 \`${value.paths.prompts}\``, '']
  for (const template of value.templates) {
    const { head, tuning } = summarize(template)
    lines.push(`- **${template.name}**${tuning.length > 0 ? ` · ${tuning.join(' · ')}` : ''}`)
    if (head !== '') lines.push(`  - ${head}`)
  }
  lines.push('')
  lines.push('出图时用 `ld_draw` 的 `template` 参数带上模板名即可套用其中的提示词与参数。')
  return lines.join('\n')
}

function renderTemplate (template) {
  const lines = [`**${template.name}**${template.note ? ` · ${template.note}` : ''}`, '']
  lines.push('正面提示词：')
  lines.push(`\`\`\`\n${template.prompt ?? ''}\n\`\`\``)
  if (template.negativePrompt) {
    lines.push('负面提示词：')
    lines.push(`\`\`\`\n${template.negativePrompt}\n\`\`\``)
  }
  const tuning = TEMPLATE_FIELDS
    .filter((field) => !['prompt', 'negativePrompt', 'note'].includes(field))
    .filter((field) => template[field] !== undefined && template[field] !== null && template[field] !== '')
    .map((field) => `${field}=${template[field]}`)
  if (tuning.length > 0) {
    lines.push('参数：')
    for (const item of tuning) lines.push(`- ${item}`)
  }
  if (template.updatedAt) lines.push(`\n更新时间：${template.updatedAt}`)
  return lines.join('\n')
}

/**
 * @param {object} deps
 * @param {import('../store.js').LocalDreamStore} deps.store
 */
export function createPromptTool ({ store }) {
  return defineTool({
    name: 'ld_prompt',
    description:
      '管理容器里的提示词模板库（`<DSH_HOME>/localdream/prompts/*.json`，也能直接在容器里编辑）。' +
      'action="list" 列全部模板；"show" 看某个模板全文；' +
      '"save" 新建或覆盖 —— 除了 prompt，还能一起存 negativePrompt / aspectRatio / steps / cfg / ' +
      'scheduler / model / note，配合 `ld_draw` 的 `template` 参数一次带齐；"remove" 删除。' +
      '把用户调好的提示词与参数固化下来用这个工具，别每次都重新拼。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'show', 'save', 'remove'],
        description: '要执行的操作。'
      },
      name: { type: 'string', description: '模板名，show / save / remove 必填。文件名就是它。' },
      prompt: { type: 'string', description: '正面提示词。save 新建时必填；覆盖时留空则保留原值。' },
      negativePrompt: { type: 'string', description: '负面提示词。' },
      aspectRatio: { type: 'string', description: '缺省宽高比，如 "3:4"。' },
      steps: { type: 'number', description: '缺省步数。' },
      cfg: { type: 'number', description: '缺省 CFG。' },
      scheduler: { type: 'string', enum: [...SCHEDULERS], description: '缺省采样器。' },
      model: { type: 'string', description: '缺省模型 id。' },
      note: { type: 'string', description: '给自己看的备注，例如画风或避雷说明。' }
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => {
        switch (args?.action) {
          case 'list': return text(renderList(value))
          case 'show': return text(renderTemplate(value.template))
          case 'save': return text(`已保存模板 **${value.template.name}**。\n\n文件：\`${value.path}\`\n\n出图时用 \`ld_draw\` 的 \`template="${value.template.name}"\` 即可套用。`)
          default: return text(`已删除模板 **${value.name}**。\n\n目录：\`${value.paths.prompts}\``)
        }
      }
    },
    timeoutMs: 30_000,
    async execute (args) {
      const action = args.action
      const paths = store.paths

      if (action === 'list') {
        return { paths, templates: await store.listPrompts() }
      }

      if (action === 'show') {
        if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error('show 必须提供 name')
        return { template: await store.readPrompt(args.name) }
      }

      if (action === 'save') {
        if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error('save 必须提供 name')
        const patch = {}
        for (const field of TEMPLATE_FIELDS) {
          if (args[field] !== undefined) patch[field] = args[field]
        }
        const template = await store.writePrompt(args.name, patch)
        return { template, path: `${paths.prompts}/${template.name}.json` }
      }

      if (typeof args.name !== 'string' || args.name.trim() === '') throw new Error('remove 必须提供 name')
      return { name: await store.removePrompt(args.name), paths }
    }
  })
}
