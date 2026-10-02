/**
 * `ld_config` —— 查看与修改容器里的使用偏好、per-model 参数预设。
 * @module dsh-localdream/tools/config
 */

import { defineTool } from '../define-tool.js'

import { MODEL_PRESET_KEYS, SETTINGS_KEYS } from '../store.js'
import { num, text } from './shared.js'

const MODEL_KEY_PATTERN = /^models\.(.+)\.([A-Za-z]+)$/

function renderSettings (value) {
  const lines = ['**全局使用偏好**（`settings.json`）', '']
  for (const [key, spec] of Object.entries(SETTINGS_KEYS)) {
    const current = value.settings[key]
    const shown = key === 'defaultNegativePrompt'
      ? `${String(current).slice(0, 60)}${String(current).length > 60 ? '…' : ''}`
      : String(current)
    lines.push(`- \`${key}\` = ${shown}`)
    if (spec.oneOf) lines.push(`  - 可选值：${spec.oneOf.join(' / ')}`)
    if (spec.min !== undefined) lines.push(`  - 范围：${spec.min} ~ ${spec.max}`)
  }

  lines.push('')
  const presetIds = Object.keys(value.modelPresets)
  lines.push(`**per-model 参数预设**（\`models.json\`）${presetIds.length === 0 ? '：空' : ''}`)
  for (const id of presetIds) {
    const preset = value.modelPresets[id]
    const parts = Object.entries(preset).map(([key, item]) => `${key}=${num(Number(item))}`)
    lines.push(`- \`${id}\` → ${parts.join(' · ')}`)
  }
  lines.push(`- 键格式：${Object.keys(MODEL_PRESET_KEYS).map((key) => `\`models.<模型id>.${key}\``).join(' / ')}`)

  lines.push('')
  lines.push('**插件层配置**（由 `cordis.patch.yml` 提供，容器文件可以覆盖同名项）')
  lines.push(`- 控制口 \`${value.pluginConfig.controlBaseUrl}\` · 生成口 \`${value.pluginConfig.generateBaseUrl}\``)
  lines.push(`- 输出目录 \`${value.paths.output}\``)
  lines.push(`- 单次张数上限 maxBatch = ${value.pluginConfig.maxBatch}`)
  lines.push('')
  lines.push('**文件位置**（可直接在容器里改）')
  lines.push(`- \`${value.paths.settings}\``)
  lines.push(`- \`${value.paths.models}\``)
  lines.push(`- \`${value.paths.prompts}/\``)
  return lines.join('\n')
}

function renderMutation (action, value) {
  if (action === 'set') {
    return [
      `已写入 \`${value.key}\` = ${value.display}`,
      '',
      `文件：\`${value.path}\``,
      '改完立即生效，下一次出图就会用上新值（不需要重启宿主）。'
    ].join('\n')
  }
  return [
    value.key === '' ? '已把所有配置恢复为内置默认值。' : `已把 \`${value.key}\` 恢复为默认值 ${value.display}。`,
    '',
    `文件：\`${value.paths.settings}\` · \`${value.paths.models}\``
  ].join('\n')
}

/**
 * @param {object} deps
 * @param {import('../store.js').LocalDreamStore} deps.store
 * @param {() => object} deps.getConfig
 */
export function createConfigTool ({ store, getConfig }) {
  return defineTool({
    name: 'ld_config',
    description:
      '查看与修改 dsh-localdream 的使用偏好和 per-model 参数预设。数据落在容器里的 JSON 文件，' +
      '改完立即生效、不需要重启宿主；想看文件在哪就先用 action="show"。' +
      'key 支持全局键（defaultAspectRatio / defaultCount / defaultOutputFormat / ' +
      'defaultNegativePrompt / defaultModel / maxBatch）与模型预设键' +
      '（models.<模型id>.steps / .cfg / .scheduler）。',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['show', 'set', 'reset'],
        description: 'show 查看当前值；set 改一个键；reset 恢复默认（key 留空即全部重置）。'
      },
      key: {
        type: 'string',
        description: 'set / reset 的目标键，例如 defaultAspectRatio，或 models.<模型id>.cfg 这种模型预设键。'
      },
      value: {
        type: 'string',
        description: 'set 的新值。数字与枚举键会按声明校验，非法值直接报错。'
      }
    },
    output: {
      schema: { type: 'json' },
      render: (args, value) => text(
        args?.action === 'show' ? renderSettings(value) : renderMutation(args?.action, value)
      )
    },
    timeoutMs: 30_000,
    async execute (args) {
      const action = args.action
      const paths = store.paths
      const pluginConfig = getConfig()

      if (action === 'show') {
        return {
          paths,
          settings: await store.readSettings(),
          modelPresets: await store.readModelPresets(),
          pluginConfig: {
            controlBaseUrl: pluginConfig.controlBaseUrl,
            generateBaseUrl: pluginConfig.generateBaseUrl,
            maxBatch: pluginConfig.maxBatch,
            defaultModel: pluginConfig.defaultModel
          }
        }
      }

      const key = typeof args.key === 'string' ? args.key.trim() : ''

      if (action === 'set') {
        if (key === '') throw new Error('set 必须提供 key')
        if (args.value === undefined) throw new Error('set 必须提供 value')

        const match = MODEL_KEY_PATTERN.exec(key)
        if (match !== null) {
          const [, modelId, presetKey] = match
          await store.setModelPreset(modelId, presetKey, args.value)
          return { key, display: `"${args.value}"`, path: paths.models }
        }

        const settings = await store.setSetting(key, args.value)
        return { key, display: String(settings[key]), path: paths.settings }
      }

      if (key === '') {
        await store.resetSettings('')
        await store.resetModelPresets('')
        return { key: '', display: '默认值', paths }
      }

      const match = MODEL_KEY_PATTERN.exec(key)
      if (match !== null) {
        const [, modelId] = match
        await store.resetModelPresets(modelId)
        return { key, display: `已删除 ${modelId} 的整套预设`, paths }
      }

      const settings = await store.resetSettings(key)
      return { key, display: String(settings[key]), paths }
    }
  })
}
