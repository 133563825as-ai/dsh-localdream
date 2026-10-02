import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalDreamStore } from '../src/store.js'
import { createConfigTool } from '../src/tools/config.js'
import { createDrawTool } from '../src/tools/draw.js'
import { createEnhanceTool } from '../src/tools/enhance.js'
import { createPromptTool } from '../src/tools/prompt.js'
import { createSelectTool } from '../src/tools/select.js'
import { createStatusTool } from '../src/tools/status.js'

// 插件运行期零依赖 —— 工具定义走自实现的 src/define-tool.js，
// 所以这一组用例在任何 Node 环境下都能直接跑，不需要宿主、不需要 node_modules。
const hostTest = test

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x60,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xd9
])

const DEFAULT_MODELS = [
  { id: 'alpha', generation_size: 768, is_sdxl: true, defaults: { steps: 25, cfg: 5, scheduler: 'euler' } },
  { id: 'beta', generation_size: 1024, defaults: { steps: 20, cfg: 7, scheduler: 'dpm' } }
]

function makeEnv (overrides = {}) {
  const calls = { generate: [], selectAndWait: [], ensureBackend: 0, upscale: [] }
  const models = overrides.models ?? DEFAULT_MODELS
  const status = overrides.status ?? {
    state: 'running',
    serving_model_id: 'alpha',
    width: 768,
    height: 768
  }
  const completion = overrides.completion ?? {
    image: JPEG.toString('base64'),
    format: 'jpeg',
    seed: 7,
    width: 768,
    height: 768
  }

  const client = {
    models: async () => ({ models, upscalers: overrides.upscalers ?? [] }),
    status: async () => status,
    snapshot: async () => overrides.offline === true
      ? { online: false, reason: 'connect ECONNREFUSED', hint: '请在 App 里点「进入受控模式」' }
      : {
          online: true,
          info: { device: 'TestPhone', version: '3.0.0', protocol: 1 },
          status,
          generatePortAlive: true
        },
    selectAndWait: async (options) => {
      calls.selectAndWait.push(options)
      return { modelId: options.modelId, state: 'running', reused: false, width: 1024, height: 1024 }
    },
    ensureBackend: async () => {
      calls.ensureBackend += 1
      return { modelId: status.serving_model_id, state: 'running', reused: true }
    },
    generate: async (body) => {
      calls.generate.push(body)
      return { ...completion }
    },
    upscale: async (options) => {
      calls.upscale.push(options)
      return JPEG
    }
  }

  return { client, calls }
}

async function makeConfig (overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ld-tools-'))
  return {
    outputDir: join(dir, 'out'),
    controlBaseUrl: 'http://127.0.0.1:8808',
    generateBaseUrl: 'http://127.0.0.1:8081',
    defaultModel: '',
    maxBatch: 2,
    generateTimeoutMs: 5_000,
    selectTimeoutMs: 5_000,
    modelPresets: {},
    ...overrides
  }
}

async function makeStore () {
  const root = join(await mkdtemp(join(tmpdir(), 'ld-store-')), 'localdream')
  return new LocalDreamStore({ root })
}

hostTest('ld_status 在线时列出模型，且不假设任何具体模型', async () => {
  const { client } = makeEnv()
  const tool = createStatusTool({ client })
  const value = await tool.execute({})
  const rendered = tool.output.render({}, value)[0].text

  assert.equal(value.online, true)
  assert.equal(value.device, 'TestPhone')
  assert.deepEqual(value.models.map((m) => m.id), ['alpha', 'beta'])
  assert.equal(value.models[0].generationSize, 768)
  assert.equal(value.models[0].isSdxl, true)
  assert.match(rendered, /alpha/)
  assert.match(rendered, /25 步/)
  assert.match(rendered, /生成口 8081 可连/)
})

hostTest('ld_status 离线时给出开启受控模式的指引，而不是抛错', async () => {
  const { client } = makeEnv({ offline: true })
  const tool = createStatusTool({ client })
  const value = await tool.execute({})
  const rendered = tool.output.render({}, value)[0].text

  assert.equal(value.online, false)
  assert.match(rendered, /未在线/)
  assert.match(rendered, /进入受控模式/)
})

hostTest('ld_draw 缺省参数来自后端该模型的默认值', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat' })

  assert.equal(value.modelId, 'alpha')
  assert.equal(value.params.steps, 25)
  assert.equal(value.params.cfg, 5)
  assert.equal(value.params.scheduler, 'euler')
  assert.equal(value.params.source, 'model-defaults')
  assert.equal(calls.ensureBackend, 1)
  assert.equal(calls.generate.length, 1)
  assert.equal(calls.generate[0].steps, 25)
  assert.equal(calls.generate[0].negative_prompt.length > 0, true)
})

hostTest('ld_draw 的基准尺寸跟随模型的 generation_size', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat', aspectRatio: '3:4' })

  // alpha 的基准是 768，不是写死的 1024
  assert.deepEqual(value.size, { width: 576, height: 768 })
  assert.equal(calls.generate[0].aspect_ratio, '3:4')
  assert.equal(calls.generate[0].width, 576)
})

hostTest('ld_draw 显式参数优先于模型默认值', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat', steps: 12, cfg: 1, scheduler: 'lcm' })

  assert.equal(value.params.source, 'explicit')
  assert.equal(calls.generate[0].steps, 12)
  assert.equal(calls.generate[0].cfg, 1)
  assert.equal(calls.generate[0].scheduler, 'lcm')
})

hostTest('ld_draw 套用提示词模板，显式参数仍优先', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  await store.writePrompt('我的模板', {
    prompt: 'from template',
    negativePrompt: 'from template negative',
    aspectRatio: '3:4',
    steps: 30,
    cfg: 6,
    scheduler: 'dpm_karras'
  })
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ template: '我的模板', steps: 15 })

  assert.equal(value.template, '我的模板')
  assert.equal(calls.generate[0].prompt, 'from template')
  assert.equal(calls.generate[0].negative_prompt, 'from template negative')
  assert.equal(calls.generate[0].aspect_ratio, '3:4')
  assert.equal(calls.generate[0].steps, 15) // 显式覆盖
  assert.equal(calls.generate[0].cfg, 6) // 来自模板
  assert.equal(calls.generate[0].scheduler, 'dpm_karras')
})

hostTest('ld_draw 读容器里的 settings 与模型预设', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  await store.setSetting('defaultAspectRatio', '16:9')
  await store.setSetting('defaultNegativePrompt', 'only this')
  await store.setModelPreset('alpha', 'steps', '31')
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat' })

  assert.equal(value.aspectRatio, '16:9')
  assert.equal(calls.generate[0].negative_prompt, 'only this')
  assert.equal(calls.generate[0].steps, 31)
  assert.equal(value.params.source, 'preset')
})

hostTest('ld_draw 把出图落盘，并回报路径与 seed', async () => {
  const { client } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat' })
  const file = value.files[0]

  assert.equal(value.files.length, 1)
  assert.equal(file.format, 'jpeg')
  assert.equal(file.seed, 7)
  assert.equal((await stat(file.path)).size, JPEG.length)
  assert.deepEqual(await readFile(file.path), JPEG)

  const rendered = tool.output.render({}, value)[0].text
  assert.match(rendered, /文生图完成/)
  assert.match(rendered, /后端模型默认值/)
  assert.ok(rendered.includes(`![](${file.path})`) || rendered.includes(`(${file.path})`))
})

hostTest('ld_draw 连出多张时 seed 依次 +1，并执行次数上限', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const value = await tool.execute({ prompt: 'a cat', count: 2, seed: 100 })
  assert.equal(value.files.length, 2)
  assert.deepEqual(calls.generate.map((body) => body.seed), [100, 101])
})

hostTest('ld_draw 在张数超限与 prompt 缺失时直接报错', async () => {
  const { client } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  await assert.rejects(() => tool.execute({ prompt: 'x', count: 3 }), /张数最多 2/)
  await assert.rejects(() => tool.execute({}), /prompt 不能为空/)
  await assert.rejects(() => tool.execute({ template: '不存在', prompt: 'x' }), /没有名为/)
})

hostTest('ld_draw 指定 model 时显式切换模型', async () => {
  const { client, calls } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  await tool.execute({ prompt: 'a cat', model: 'beta' })
  assert.equal(calls.selectAndWait.length, 1)
  assert.equal(calls.selectAndWait[0].modelId, 'beta')
  assert.equal(calls.ensureBackend, 0)
})

hostTest('ld_draw 的 img2img 在尺寸不符时报错并给出标准化命令', async () => {
  const { client } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createDrawTool({ client, store, getConfig: () => config })

  const dir = await mkdtemp(join(tmpdir(), 'ld-img-'))
  const { encodePng } = await import('../src/png.js')
  const wrong = join(dir, 'wrong.png')
  await (await import('node:fs/promises')).writeFile(wrong, await encodePng(64, 64, Buffer.alloc(64 * 64 * 3)))

  await assert.rejects(
    () => tool.execute({ prompt: 'a cat', aspectRatio: '3:4', image: wrong }),
    /必须是 576×768.*convert/s
  )
})

hostTest('ld_select 用模型自己的基准尺寸，不传 1024', async () => {
  const { client, calls } = makeEnv()
  const tool = createSelectTool({ client })
  await tool.execute({ model: 'beta' })
  assert.equal(calls.selectAndWait[0].modelId, 'beta')
  assert.equal('width' in calls.selectAndWait[0], false)
})

hostTest('ld_config 能看、能改、能重置', async () => {
  const { client } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createConfigTool({ store, getConfig: () => config })

  const shown = await tool.execute({ action: 'show' })
  assert.equal(shown.settings.defaultAspectRatio, '1:1')
  const rendered = tool.output.render({ action: 'show' }, shown)[0].text
  assert.match(rendered, /settings\.json/)
  assert.match(rendered, /models\.<模型id>/)

  await tool.execute({ action: 'set', key: 'defaultAspectRatio', value: '9:16' })
  assert.equal((await store.readSettings()).defaultAspectRatio, '9:16')

  await tool.execute({ action: 'set', key: 'models.alpha.cfg', value: '6' })
  assert.deepEqual(await store.readModelPresets(), { alpha: { cfg: 6 } })

  await assert.rejects(
    () => tool.execute({ action: 'set', key: 'defaultAspectRatio', value: 'nope' }),
    /宽高比格式/
  )
  await assert.rejects(() => tool.execute({ action: 'set', key: '瞎写的键', value: '1' }), /未知的设置键/)

  await tool.execute({ action: 'reset', key: '' })
  assert.equal((await store.readSettings()).defaultAspectRatio, '1:1')
  assert.deepEqual(await store.readModelPresets(), {})
})

hostTest('ld_prompt 全流程：存、列、看、删', async () => {
  const { client } = makeEnv()
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createPromptTool({ store })

  const saved = await tool.execute({
    action: 'save',
    name: '测试模板',
    prompt: 'a cat, light blue hair',
    aspectRatio: '3:4',
    steps: 30
  })
  assert.equal(saved.template.name, '测试模板')

  const listed = await tool.execute({ action: 'list' })
  assert.equal(listed.templates.length, 1)
  assert.match(tool.output.render({ action: 'list' }, listed)[0].text, /测试模板/)

  const shown = await tool.execute({ action: 'show', name: '测试模板' })
  assert.match(tool.output.render({ action: 'show' }, shown)[0].text, /a cat, light blue hair/)

  await tool.execute({ action: 'remove', name: '测试模板' })
  assert.deepEqual((await tool.execute({ action: 'list' })).templates, [])

  await assert.rejects(() => tool.execute({ action: 'show', name: '../etc/passwd' }), /模板名/)
})

hostTest('ld_enhance 的 upscale 需要 PNG，并挑一个放大器', async () => {
  const { client, calls } = makeEnv({
    upscalers: [{ id: 'x4', path: '/models/realesrgan.mnn' }]
  })
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createEnhanceTool({ client, store, getConfig: () => config })

  const dir = await mkdtemp(join(tmpdir(), 'ld-up-'))
  const { encodePng } = await import('../src/png.js')
  const { writeFile } = await import('node:fs/promises')
  const png = join(dir, 'in.png')
  await writeFile(png, await encodePng(4, 4, Buffer.alloc(4 * 4 * 3, 9)))

  const value = await tool.execute({ mode: 'upscale', image: png })
  assert.equal(calls.upscale.length, 1)
  assert.equal(calls.upscale[0].upscalerPath, '/models/realesrgan.mnn')
  assert.equal(calls.upscale[0].rgb.length, 4 * 4 * 3)
  assert.equal(value.inWidth, 4)

  const jpeg = join(dir, 'in.jpg')
  await writeFile(jpeg, JPEG)
  await assert.rejects(() => tool.execute({ mode: 'upscale', image: jpeg }), /必须是 raw RGB24/)
})

hostTest('ld_enhance 的 ultrafix 要 prompt，并校验尺寸约束', async () => {
  const { client, calls } = makeEnv({
    // beta 不是 SDXL，tile_size 可调
    status: { state: 'running', serving_model_id: 'beta', width: 1024, height: 1024 },
    completion: { image: JPEG.toString('base64'), format: 'jpeg', seed: 1, width: 2048, height: 2048 }
  })
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createEnhanceTool({ client, store, getConfig: () => config })

  const dir = await mkdtemp(join(tmpdir(), 'ld-uf-'))
  const { encodePng } = await import('../src/png.js')
  const { writeFile } = await import('node:fs/promises')
  const png = join(dir, 'big.png')
  await writeFile(png, await encodePng(2048, 2048, Buffer.alloc(2048 * 2048 * 3, 1)))

  await assert.rejects(() => tool.execute({ mode: 'ultrafix', image: png }), /需要 prompt/)

  const value = await tool.execute({ mode: 'ultrafix', image: png, prompt: 'a cat', tileSize: 512 })
  assert.equal(value.tileSize, 512)
  assert.equal(calls.generate[0].ultrafix, true)
  assert.equal(calls.generate[0].width, 2048)
  assert.equal('aspect_ratio' in calls.generate[0], false)

  const small = join(dir, 'small.png')
  await writeFile(small, await encodePng(256, 2048, Buffer.alloc(256 * 2048 * 3, 1)))
  await assert.rejects(
    () => tool.execute({ mode: 'ultrafix', image: small, prompt: 'a cat' }),
    /shorter edge must be >= 512/
  )
})

hostTest('ld_enhance 在 SDXL 后端上把 tile_size 固定为 1024', async () => {
  const { client } = makeEnv({
    status: { state: 'running', serving_model_id: 'alpha', width: 768, height: 768 },
    completion: { image: JPEG.toString('base64'), format: 'jpeg', seed: 1, width: 1024, height: 1024 }
  })
  const config = await makeConfig()
  const store = await makeStore()
  const tool = createEnhanceTool({ client, store, getConfig: () => config })

  const dir = await mkdtemp(join(tmpdir(), 'ld-uf-sdxl-'))
  const { encodePng } = await import('../src/png.js')
  const { writeFile } = await import('node:fs/promises')
  const png = join(dir, 'big.png')
  await writeFile(png, await encodePng(1024, 1024, Buffer.alloc(1024 * 1024 * 3, 1)))

  const value = await tool.execute({ mode: 'ultrafix', image: png, prompt: 'a cat', tileSize: 512 })
  assert.equal(value.tileSize, 1024)
  assert.ok(value.notes.some((note) => /SDXL/.test(note)))
})
