# dsh-localdream

**开源**（MIT）的 **DeepSeek Harness 专用**插件：把手机端 [Local Dream](https://github.com/xororz/local-dream) 的本地 NPU 生图接进对话 —— 一句话出图、图生图、放大与分块重绘，全程只跟本机 loopback 说话，不走云端、不计费、无内容审查。

插件不内置任何模型清单、不预设任何画风偏好：基准尺寸与默认步数 / CFG / 采样器全部从 Local Dream 后端现读，**换模型、换机器都照样能用**。属于你自己那台机器的偏好（默认负面词、比例、per-model 参数、提示词模板）都放在容器里的普通 JSON 文件里，随时可查可改。

**运行期零依赖**：`dependencies` 与 `peerDependencies` 都是空的，不需要软链、不需要 `npm install`，装它不会动你现有的任何东西。详见[安装](#安装)一节。

## 前置条件

1. 手机上装了 Local Dream（3.0.0-alpha.3 及以上实测通过，更低版本未验证）。
2. **在 App 里手动打开受控模式** —— 这一步只能手点：

   > Local Dream → 模型列表右上角 **⋮** → **设备互联** → 受控模式区块 → **「进入受控模式」**

   受控模式的服务在 `AndroidManifest.xml` 里是 `exported="false"`，外部唤起不了，插件也不会替你去点。

打开后会暴露两个端口，插件就用这两个：

| 端口 | 性质 | 用到的端点 |
|---|---|---|
| `127.0.0.1:8808` | 控制口（JSON API） | `GET /info` `/models` `/status`，`POST /select` `/stop` |
| `127.0.0.1:8081` | 生成口（native 后端） | `POST /generate`（SSE）、`POST /upscale`（raw body） |

自检：

```bash
curl -s --max-time 6 http://127.0.0.1:8808/info
# {"app":"localdream","protocol":1,"version":"3.0.0-alpha.3","device":"..."}
```

没有响应就是受控模式没开或被系统回收了，回 App 里重点一次 —— **重试不会让它自己起来**。

## 安装

```bash
git clone https://github.com/133563825as-ai/dsh-localdream.git ~/dsh-localdream

dsh plugin --profile web add link:~/dsh-localdream
```

装完**重启 dsh** 才生效。验证装上了：

```bash
dsh --profile web --dump-config | grep -A3 dsh-localdream
```

### 不需要装依赖，也不会碰你的环境

插件**运行期零依赖**：它只 import Node 内置模块，`dependencies` 和 `peerDependencies` 都是空的。

所以**不要**往插件目录里放 `node_modules`，也**不要**在那里跑 `npm install` —— 不需要。这一点是刻意的：

- 如果插件目录里有一条 `node_modules -> <宿主>/node_modules` 的软链，任何人误在插件目录跑一次 `npm install`，都会顺着链接把包写进**宿主的** `node_modules`，污染整个 dsh 安装。这个插件从设计上不留这个口子。
- 插件不注册全局命令、不改宿主文件、不写 profile 之外的路径。它只做三件事：注册工具、在 `<DSH_HOME>/localdream/` 下读写自己的 JSON、往 webServer 挂一组 `/localdream/*` 接口。
- 卸载就是 `dsh plugin --profile web remove dsh-localdream`，删掉目录即可；`<DSH_HOME>/localdream/` 留着不影响任何东西，想一起清掉就删它。

> **这一条是给别人用的前提。** 一台机器上装几十个插件时，最怕的不是功能少，而是某个插件在你没注意的时候动了别人的东西。

## 六个工具

| 工具 | 作用 |
|---|---|
| `ld_status` | 受控模式在不在线、当前挂着哪个模型、后端状态、生成口是否可连、已装模型与放大器清单。出图前先跑它。 |
| `ld_select` | 显式挂载模型并等到可出图。`ld_draw` 的 `model` 只在后端被回收时才重挂，想主动换模型得用它。 |
| `ld_draw` | 文生图 / 图生图。 |
| `ld_enhance` | `mode="upscale"` ×4 放大；`mode="ultrafix"` 分块重绘。 |
| `ld_config` | 查看与修改容器里的使用偏好、per-model 参数预设。 |
| `ld_prompt` | 提示词模板库：存、列、看、删。 |

典型对话：

> 帮我画一张在雨里撑伞的少女，竖版
> → `ld_draw({ prompt: '...', aspectRatio: '3:4' })`

> 把这张图放大四倍再重绘成高清的
> → `ld_enhance({ mode: 'upscale', image: '...' })` → `ld_enhance({ mode: 'ultrafix', image: '...', prompt: '...' })`

## 出图与后处理流程

```
ld_status  →  ld_draw  →  ld_enhance(upscale)  →  ld_enhance(ultrafix)
                      1024 图        ×4 放大              分块重绘
```

一个容易搞混的点：**UltraFix 本身不放大**。它吃一张**已经是目标尺寸的大图**，按 tile 切开做分块 img2img 再混合重叠区。所以顺序永远是先放大、再 UltraFix。

`upscale` 的请求体是 raw RGB24，所以输入必须是 **PNG**（`ld_draw` 的默认输出格式就是 PNG，可以直接喂）。UltraFix 的输入走 base64，PNG / JPEG 都行。

UltraFix 只被 SD1.5 QNN 与 SDXL QNN 后端支持，MNN / Anima / DiT 后端会直接报 `ultrafix not supported by this backend`。

## 容器里的配置与提示词

都落在 `<DSH_HOME>/localdream/`（通常是 `/root/.dsh/localdream/`），全是普通 JSON，可以直接编辑：

```
localdream/
├── settings.json     使用偏好
├── models.json       per-model 参数预设
├── prompts/          提示词模板，一个模板一个 JSON
└── out/              出图输出
```

用工具改（推荐，会做校验）：

```
ld_config({ action: 'show' })
ld_config({ action: 'set', key: 'defaultAspectRatio', value: '3:4' })
ld_config({ action: 'set', key: 'models.<模型id>.cfg', value: '6' })
ld_config({ action: 'reset', key: '' })

ld_prompt({ action: 'save', name: '雨夜少女', prompt: '...', aspectRatio: '3:4', steps: 30 })
ld_prompt({ action: 'list' })
```

然后出图时带模板名即可套用：

```
ld_draw({ template: '雨夜少女' })
```

**每次调用都重新读盘，改完立即生效，不需要重启宿主。**

### settings.json 的键

| 键 | 说明 | 默认 |
|---|---|---|
| `defaultNegativePrompt` | 默认负面提示词（`cfg > 1` 时生效） | 内置通用质量词表 |
| `defaultAspectRatio` | 默认宽高比 | `1:1` |
| `defaultCount` | 默认连出张数 | `1` |
| `defaultOutputFormat` | 默认落盘格式 | `png` |
| `defaultModel` | 后端被回收时默认重挂哪个模型 | 空（必须显式指定） |
| `maxBatch` | 单次连出张数上限 | `2` |

`maxBatch` 默认 2 是有意的：手机 NPU 一次连出更多会持续高负载、发热甚至顶掉内存。想要更多张，优先分多次调用。

## 参数从哪来

同一个数字可能在四个地方被定义，优先级从高到低：

1. **调用方显式传参** —— 这次出图的入参
2. **提示词模板** —— `ld_prompt` 存的模板里带的 `steps` / `cfg` / `scheduler`
3. **容器预设** —— `models.json` 里为该模型存的值
4. **后端模型默认值** —— `/models` 报出的该模型自己的 `defaults`
5. 全局兜底 —— `20 步 / CFG 7 / dpm`

第 4 层是整个插件通用性的关键：**它让插件适配任意模型，而不是绑定某一台机器上装了什么**。工具返回里会有一个 `参数来源` 告诉你这次用的是哪一层。

## 已知限制与常见坑

- **`width` / `height` 是无效字段。** 真正决定成图尺寸的是 `aspect_ratio`：长边固定为该模型的基准尺寸（`generation_size`），短边按比例换算后向 8 的倍数取整（`3:2` → 682.7 → **680**，不是 683）。
- **后端对不认识的字段一律静默忽略。** 图生图的输入图字段只有 `image` 一个；写成 `init_image` / `input_image` / `image_base64` 会照常返回一张 txt2img 的图，且不报任何错。
- **`cfg = 1.0` 等于关掉负面提示词分支**，此时 `negativePrompt` 写了也没用。要让它生效就把 `cfg` 提到 5~7。
- **图生图的输入图尺寸必须等于 `aspectRatio` 的换算值**，否则后端报 `Img size mismatch`。先用 `convert in.png -resize 576x768^ -gravity center -extent 576x768 out.png` 标准化。
- **`/select` 的宽高只改状态回显**，不影响成图。
- 避开 `*_turbo` 模型：吃内存，在 12G 机器上容易把后台进程一起挤掉。

## 排障

| 症状 | 原因 | 对策 |
|---|---|---|
| `ld_status` 报未在线 | 受控模式被回收或没开 | 回 App 里重点「进入受控模式」 |
| 状态 `idle`、8081 无监听 | native 后端被系统回收 | `ld_draw` 已内置自愈，会自动重挂（代价是一次冷启动） |
| 出图报「没有收到 complete 事件」 | 后端在生成中途被回收 | 重跑一次；仍失败先 `ld_select` 再重试 |
| `gen` 出来的却是上一个模型 | 后端还热着旧模型 | 用 `ld_select` 显式切换，别指望 `ld_draw` 的 `model` 主动换 |
| `HTTP Error 404` on `/select` | host 在 idle 切换的窗口期偶发 | 重跑一次；仍 404 就 `ld_select` 重来 |
| 出图很慢（> 90s） | 冷启动未预热 | 正常，第二张起回到热态速度 |
| `Img size mismatch` | 图生图输入图尺寸不符 | 按 `aspectRatio` 换算值标准化 |
| `ultrafix not supported by this backend` | 当前后端不支持 | 换 SD1.5 QNN / SDXL QNN 后端的模型 |

稳定性建议：App 里的 **「纯黑屏幕（保持运行）」** 能保持屏幕常亮、避免 doze 回收；系统设置里给 Local Dream 开**电池不优化 / 后台锁定**。

## 界面

侧边栏底部一枚胶囊（压在「导出会话日志」上面），点开是完整面板。视觉沿用这套 GUI 既有的设计语言：`--dsw-*` 令牌，胶囊的尺寸与描边对齐同区域的 session-log pill，图标直接用宿主原语库里的官方图标（取法与 `dsh-web-mobile` 一致，取不到才回落到自绘 SVG）。

| 位置 | 内容 |
|---|---|
| 侧边栏胶囊 | 状态灯 + 图标 +「本地生图」+ 当前状态（模型名 / `15/29` / 未连接） |
| 点开后的面板 | **出图**（提示词、模板、模型、比例、步数、CFG、采样器、张数 → 出图并预览）· **历史**（输出目录里的图）· **模型**（设备上已下载的模型与放大器，可一键切换）· **提示词**（模板增删改）· **设置** |
| 设置 → 连接地址 | 胶囊形输入框，可手填控制口 / 生成口地址，带「测试连接」与「恢复自动」 |

面板里出的图和 Agent 调 `ld_draw` 出的图走的是**同一条链路**（`src/draw-core.js`），参数解析规则完全一致。同一时刻只允许一个出图任务：手机 NPU 扛不住并发。

### 连接地址：自动还是手动？

**默认自动。** Local Dream 的受控模式固定监听 `127.0.0.1:8808`（控制口）与 `127.0.0.1:8081`（生成口），插件直接连，不需要填任何东西。注意这里**没有"发现"过程**——端口是 Local Dream 写死的，不是扫描出来的。

**需要时才手动覆盖**：只有把 Local Dream 跑在别处（另一台设备、端口转发）才用得上。在面板「设置 → 连接地址」里填，两个输入框都留空就等于恢复自动。改完**下一次请求就生效**，不用重启宿主。

地址的合法性在写入时就校验：必须 `http(s)://host:port`，不接受带路径或查询串的值。

## 开发

```bash
npm test      # node --test，96 项，离线，秒级
npm run check # 逐个文件的语法检查
```

测试**不需要装任何东西**（没有 `node_modules` 也能全绿）—— 这本身就是「零依赖」这条约束的回归测试。

## 许可

MIT
