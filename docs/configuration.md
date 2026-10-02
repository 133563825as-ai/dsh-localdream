# 配置与提示词库

插件的所有可调项都落在 `<DSH_HOME>/localdream/`（通常是 `/root/.dsh/localdream/`），全是普通 JSON。

```
localdream/
├── settings.json     使用偏好
├── models.json       per-model 参数预设
├── prompts/          提示词模板，一个模板一个 JSON
└── out/              出图输出
```

**每次工具调用都重新读盘**，所以改完立刻生效，不需要重启宿主。用 `ld_config({ action: 'show' })` 可以随时打出这几个路径。

写盘是原子的（先写 `.tmp-*` 再 rename），不会读到写了一半的文件。

## settings.json

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `defaultNegativePrompt` | string | 内置通用质量词表 | 默认负面提示词 |
| `defaultAspectRatio` | string | `1:1` | 默认宽高比，任意 `"宽:高"` |
| `defaultCount` | number | `1` | 默认连出张数，1~8 |
| `defaultOutputFormat` | string | `png` | `png` 或 `jpeg` |
| `defaultModel` | string | `""` | 后端被回收时默认重挂哪个模型 |
| `maxBatch` | number | `2` | 单次连出张数上限，1~8 |
| `controlBaseUrl` | string | `""` | 控制口地址。**留空 = 自动用 `http://127.0.0.1:8808`** |
| `generateBaseUrl` | string | `""` | 生成口地址。**留空 = 自动用 `http://127.0.0.1:8081`** |

后两个键只在把 Local Dream 跑在别处（另一台设备、端口转发）时才需要填。校验只接受 `http(s)://host[:port]`，带路径或查询串会被拒。改完**下一次请求就生效**——每个 HTTP 请求进来时会先从容器里读一次地址。

改法：

```
ld_config({ action: 'set', key: 'defaultAspectRatio', value: '3:4' })
ld_config({ action: 'reset', key: 'defaultAspectRatio' })   # 单键恢复默认
ld_config({ action: 'reset', key: '' })                     # 全部恢复默认
```

也可以直接编辑文件：

```json
{
  "defaultNegativePrompt": "lowres, bad anatomy, bad hands",
  "defaultAspectRatio": "3:4",
  "defaultCount": 1,
  "defaultOutputFormat": "png",
  "defaultModel": "",
  "maxBatch": 2
}
```

非法值会被拒绝并报错，不会写坏文件：宽高比要能解析、枚举键要命中、数字键有范围。

## models.json

per-model 参数预设。**不同模型的参数不能互相套用**，所以按模型 id 分开存：

```json
{
  "某个模型的 id": { "steps": 29, "cfg": 6, "scheduler": "dpm" },
  "另一个模型的 id": { "cfg": 1, "scheduler": "euler_a" }
}
```

| 键 | 范围 |
|---|---|
| `steps` | 1~200 的整数 |
| `cfg` | 0~30 |
| `scheduler` | `dpm` `dpm_karras` `euler_a` `euler_a_karras` `lcm` `euler` `euler_karras` `dpm_sde` `dpm_sde_karras` |

改法：

```
ld_config({ action: 'set', key: 'models.<模型id>.cfg', value: '6' })
```

只想覆盖一个键就只写一个键，其余仍走后端该模型的默认值。

> 模型 id 从 `ld_status` 的模型清单里拿。装了新模型不需要改任何配置 —— 插件会直接用后端报给它的默认参数。

## prompts/

一个模板一个 JSON，文件名就是模板名（可以带中文，不能含 `/ \ : * ? " < > |`，长度上限 64）。

```json
{
  "name": "雨夜少女",
  "prompt": "1girl, umbrella, raining, night city, light blue hair",
  "negativePrompt": "oily skin, plastic skin",
  "aspectRatio": "3:4",
  "steps": 30,
  "cfg": 6,
  "scheduler": "dpm",
  "model": "",
  "note": "半厚涂写实 CG",
  "updatedAt": "2026-10-02T10:00:00.000Z"
}
```

除了 `name` 和 `prompt`，其余都是可选的。出图时带模板名即可套用：

```
ld_prompt({ action: 'save', name: '雨夜少女', prompt: '...', aspectRatio: '3:4', steps: 30 })
ld_prompt({ action: 'list' })
ld_prompt({ action: 'show', name: '雨夜少女' })
ld_prompt({ action: 'remove', name: '雨夜少女' })

ld_draw({ template: '雨夜少女' })            # 用模板里的 prompt 与参数
ld_draw({ template: '雨夜少女', steps: 45 }) # 显式参数仍然优先
```

覆盖保存时未传的字段保留原值，所以可以只改一个参数：

```
ld_prompt({ action: 'save', name: '雨夜少女', cfg: 7 })
```

## 参数优先级

同一项在多个地方被定义时，按这个顺序取（高到低）：

1. 调用方显式传参
2. 提示词模板
3. `models.json` 里的 per-model 预设
4. 插件配置里的 `modelPresets`
5. 后端 `/models` 报出的该模型 `defaults`
6. 全局兜底（`20 步 / CFG 7 / dpm`）

`ld_draw` 的返回里有一个 `参数来源` 字段，直接告诉你这次用的是哪一层。

## 插件层配置

属于基础设施的项（端口、超时、数据目录）走 `cordis.patch.yml`，不是容器里的 JSON。要改的话在你的 profile 配置里追加同 id 的覆盖：

```yaml
- id: dsh-localdream
  config:
    controlBaseUrl: http://127.0.0.1:8808
    generateBaseUrl: http://127.0.0.1:8081
    outputDir: /root/.dsh/localdream/out
    defaultModel: ''
    maxBatch: 2
    generateTimeoutMs: 900000
    selectTimeoutMs: 240000
```

不要改插件包里的 `cordis.patch.yml` —— 升级时会被覆盖。

插件**不导出 Config schema**（那会引入对 `@deepseek-ai/schemastery` 的依赖）。配置项在入口处做防御性解析：类型不对的值直接退回默认值，不会让插件起不来。代价是键名拼错时不会报错、只会静默用默认值 —— 改完不确定的话，看一眼启动日志里那行 `dsh-localdream: 控制口 … · 输出 …` 就知道实际生效的是什么。
