import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_SETTINGS, LocalDreamStore, assertPromptName, coerceValue } from '../src/store.js'

async function freshStore () {
  const root = join(await mkdtemp(join(tmpdir(), 'ld-store-')), 'localdream')
  return new LocalDreamStore({ root })
}

test('未初始化时读到的就是内置默认值', async () => {
  const store = await freshStore()
  const settings = await store.readSettings()
  assert.equal(settings.defaultAspectRatio, DEFAULT_SETTINGS.defaultAspectRatio)
  assert.equal(settings.maxBatch, DEFAULT_SETTINGS.maxBatch)
  assert.deepEqual(await store.readModelPresets(), {})
  assert.deepEqual(await store.listPrompts(), [])
})

test('设置写入后立刻能读回，且落成可人工编辑的 JSON', async () => {
  const store = await freshStore()
  await store.setSetting('defaultAspectRatio', '3:4')
  await store.setSetting('defaultCount', '2')

  assert.equal((await store.readSettings()).defaultAspectRatio, '3:4')
  assert.equal((await store.readSettings()).defaultCount, 2)

  const raw = JSON.parse(await readFile(store.paths.settings, 'utf-8'))
  assert.equal(raw.defaultAspectRatio, '3:4')
  assert.equal(raw.defaultCount, 2)
})

test('非法设置值直接报错，不写坏文件', async () => {
  const store = await freshStore()
  await assert.rejects(() => store.setSetting('defaultAspectRatio', '正方形'), /宽高比格式/)
  await assert.rejects(() => store.setSetting('defaultOutputFormat', 'webp'), /只能是 png \/ jpeg/)
  await assert.rejects(() => store.setSetting('maxBatch', 99), /不能大于 8/)
  await assert.rejects(() => store.setSetting('defaultCount', 1.5), /需要整数/)
  await assert.rejects(() => store.setSetting('不存在的键', 1), /未知的设置键/)
})

test('reset 单键与整体重置', async () => {
  const store = await freshStore()
  await store.setSetting('defaultAspectRatio', '9:16')
  await store.setSetting('defaultCount', 3)

  await store.resetSettings('defaultAspectRatio')
  const afterOne = await store.readSettings()
  assert.equal(afterOne.defaultAspectRatio, DEFAULT_SETTINGS.defaultAspectRatio)
  assert.equal(afterOne.defaultCount, 3)

  await store.resetSettings('')
  assert.deepEqual(await store.readSettings(), { ...DEFAULT_SETTINGS })
})

test('per-model 预设按模型隔离，且各自可部分覆盖', async () => {
  const store = await freshStore()
  await store.setModelPreset('模型甲', 'steps', '29')
  await store.setModelPreset('模型甲', 'cfg', '6')
  await store.setModelPreset('模型乙', 'scheduler', 'euler_a')

  const presets = await store.readModelPresets()
  assert.deepEqual(presets['模型甲'], { steps: 29, cfg: 6 })
  assert.deepEqual(presets['模型乙'], { scheduler: 'euler_a' })

  await store.resetModelPresets('模型甲')
  const after = await store.readModelPresets()
  assert.equal(after['模型甲'], undefined)
  assert.deepEqual(after['模型乙'], { scheduler: 'euler_a' })

  await store.resetModelPresets('')
  assert.deepEqual(await store.readModelPresets(), {})
})

test('模型预设的值也要过校验', async () => {
  const store = await freshStore()
  await assert.rejects(() => store.setModelPreset('m', 'steps', '0'), /不能小于 1/)
  await assert.rejects(() => store.setModelPreset('m', 'cfg', 'abc'), /需要数字/)
  await assert.rejects(() => store.setModelPreset('m', 'scheduler', 'dpm++'), /只能是/)
  await assert.rejects(() => store.setModelPreset('', 'steps', 1), /模型 id 不能为空/)
  await assert.rejects(() => store.setModelPreset('m', '不存在的键', 1), /未知的模型预设键/)
})

test('提示词模板完整的增删查改', async () => {
  const store = await freshStore()
  const saved = await store.writePrompt('鲸鱼娘 半厚涂', {
    prompt: 'deepseek whale girl, light blue hair',
    negativePrompt: 'oily skin, plastic skin',
    aspectRatio: '3:4',
    steps: 29,
    cfg: 6,
    scheduler: 'dpm',
    model: '任意模型',
    note: '半厚涂写实 CG'
  })

  assert.equal(saved.name, '鲸鱼娘 半厚涂')
  assert.equal(saved.aspectRatio, '3:4')
  assert.equal(typeof saved.updatedAt, 'string')

  const listed = await store.listPrompts()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].prompt, 'deepseek whale girl, light blue hair')

  const read = await store.readPrompt('鲸鱼娘 半厚涂')
  assert.equal(read.cfg, 6)

  // 部分覆盖：只改 cfg，prompt 与其它参数保留
  const patched = await store.writePrompt('鲸鱼娘 半厚涂', { cfg: 7 })
  assert.equal(patched.cfg, 7)
  assert.equal(patched.prompt, 'deepseek whale girl, light blue hair')
  assert.equal(patched.steps, 29)

  await store.removePrompt('鲸鱼娘 半厚涂')
  assert.deepEqual(await store.listPrompts(), [])
  await assert.rejects(() => store.readPrompt('鲸鱼娘 半厚涂'), /没有名为/)
  await assert.rejects(() => store.removePrompt('鲸鱼娘 半厚涂'), /没有名为/)
})

test('模板名挡住路径穿越与非法字符', async () => {
  const store = await freshStore()
  for (const bad of ['../evil', 'a/b', 'a\\b', 'a:b', '', '   ', 'x'.repeat(65)]) {
    assert.throws(() => assertPromptName(bad), /模板名/, `应拒绝 ${JSON.stringify(bad)}`)
  }
  await assert.rejects(() => store.writePrompt('../evil', { prompt: 'x' }), /模板名/)
  await assert.rejects(() => store.removePrompt('../../etc/passwd'), /模板名/)
})

test('新建模板必须带 prompt，覆盖时留空则保留原值', async () => {
  const store = await freshStore()
  await assert.rejects(() => store.writePrompt('空模板', {}), /必须提供 prompt/)
  await store.writePrompt('有内容', { prompt: 'x' })
  const patched = await store.writePrompt('有内容', { cfg: 5 })
  assert.equal(patched.prompt, 'x')
})

test('模板里的参数同样要过校验', async () => {
  const store = await freshStore()
  await assert.rejects(() => store.writePrompt('t', { prompt: 'x', aspectRatio: '宽高比' }), /宽高比格式/)
  await assert.rejects(() => store.writePrompt('t', { prompt: 'x', scheduler: 'nope' }), /scheduler 只能是/)
  await assert.rejects(() => store.writePrompt('t', { prompt: 'x', steps: 0 }), /不能小于 1/)
})

test('损坏的 JSON 会被明确报出来，而不是静默当成空配置', async () => {
  const store = await freshStore()
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(store.paths.root, { recursive: true })
  await writeFile(store.paths.settings, '{ 这不是 JSON', 'utf-8')
  await assert.rejects(() => store.readSettings(), /不是合法 JSON/)
})

test('coerceValue 按声明转换与校验', () => {
  assert.equal(coerceValue('k', '12', { type: 'number', integer: true, min: 1, max: 20 }), 12)
  assert.equal(coerceValue('k', 12, { type: 'string' }), '12')
  assert.throws(() => coerceValue('k', 'x', { type: 'number' }), /需要数字/)
  assert.equal(coerceValue('k', 'a', { type: 'string', oneOf: ['a', 'b'] }), 'a')
  assert.throws(() => coerceValue('k', 'c', { type: 'string', oneOf: ['a', 'b'] }), /只能是/)
})

test('连接地址默认留空（= 自动用内置的 127.0.0.1）', async () => {
  const store = await freshStore()
  const settings = await store.readSettings()
  assert.equal(settings.controlBaseUrl, '')
  assert.equal(settings.generateBaseUrl, '')
})

test('连接地址可以手填，也可以填回空串恢复自动', async () => {
  const store = await freshStore()
  await store.setSetting('controlBaseUrl', 'http://192.168.1.5:8808')
  assert.equal((await store.readSettings()).controlBaseUrl, 'http://192.168.1.5:8808')

  await store.setSetting('generateBaseUrl', 'https://gen.example:8443/')
  // 尾斜杠会被去掉
  assert.equal((await store.readSettings()).generateBaseUrl, 'https://gen.example:8443')

  assert.equal((await store.setSetting('controlBaseUrl', '')).controlBaseUrl, '')
})

test('连接地址把非法值挡在写入之前', async () => {
  const store = await freshStore()
  await assert.rejects(() => store.setSetting('controlBaseUrl', '不是地址'), /地址格式/)
  await assert.rejects(() => store.setSetting('controlBaseUrl', 'ftp://x:1'), /http/)
  await assert.rejects(() => store.setSetting('generateBaseUrl', 'http://127.0.0.1:8081/prefix'), /不要带路径/)
  await assert.rejects(() => store.setSetting('generateBaseUrl', 'http://127.0.0.1:8081/?a=1'), /查询串/)
  assert.equal((await store.readSettings()).controlBaseUrl, '')
})
