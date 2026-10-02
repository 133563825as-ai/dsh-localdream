# Local Dream 受控模式协议要点

这份文档只记插件真正依赖的部分，以及那些**猜错了不会报错**的地方。

字段定义取自 Local Dream 源码快照（`app/src/main/cpp/src/RequestParser.hpp` 与 `main.cpp`），本机实测版本 `3.0.0-alpha.3`。

## 一、两个端口

| 端口 | 性质 | 端点 |
|---|---|---|
| `127.0.0.1:8808` | 控制口（Kotlin 侧 JSON API） | `GET /info` `/models` `/status`，`POST /select` `/stop` |
| `127.0.0.1:8081` | 生成口（native 后端） | `POST /generate` `/upscale` `/tokenize` |

两个端口都在手机的 loopback 上，容器里可直连，不需要局域网也不需要 ADB。

## 二、`POST /generate` 请求字段

| 字段 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `prompt` | string | **必填** | 缺失直接抛 `Missing 'prompt'` |
| `negative_prompt` | string | `""` | CFG=1.0 时后端不建负分支，写什么都没用 |
| `steps` | int | 20 | |
| `cfg` | float | 7.5 | |
| `scheduler` | string | `"dpm"` | 合法值见下 |
| `seed` | uint | 随机 | |
| `width` / `height` | int | 512 | **SDXL / Anima 后端被强制覆盖成 1024**，且对成图尺寸无影响 |
| `aspect_ratio` | string | — | **真正决定成图尺寸的字段** |
| `denoise_strength` | float | 0.6 | img2img 与 ultrafix 共用 |
| `image` | base64 | — | 图生图输入。**字段名只有这一个** |
| `mask` | base64 | — | 局部重绘。**ultrafix 下会被拒绝** |
| `ultrafix` | bool | false | 分块重绘 |
| `tile_size` | int | 512 | 仅 ultrafix 且非 SDXL 后端时生效 |
| `preview_format` | string | `"raw"` | 只接受 `jpeg` / `png` |
| `output_format` | string | `"raw"` | 同上 |
| `show_diffusion_process` | bool | false | ultrafix 下被强制 false |

`scheduler` 合法标识符：

```
dpm  dpm_karras  euler_a  euler_a_karras  lcm  euler  euler_karras  dpm_sde  dpm_sde_karras
```

## 三、响应是 SSE 流

```
data: {"type":"progress","step":N,"total_steps":M,"image":"<b64>","format":"jpeg"}
data: {"type":"complete","image":"<b64>","format":"raw|jpeg","seed":N,"width":W,"height":H,"channels":3}
data: [DONE]
```

`format:"raw"` 是 packed RGB（`channels` 可能为 3 或 4），要自行编码 PNG —— 见 `src/png.js`。

**解析上的坑**：不能用「缓冲区为空」判断流结束。一个 chunk 恰好以换行结尾时缓冲区就是空的，那样会提前退出、丢掉后面的 `complete`。以 `[DONE]` 为准（`src/client.js` 的 `generate()`）。

## 四、成图尺寸由 `aspect_ratio` 决定

SDXL 与 Anima 后端无条件把画布钉在 1024；非 1:1 的产出靠居中裁剪 + 局部重绘实现。长边固定为模型的 `generation_size`，短边按比例换算后**向 8 的倍数取整**。

| `aspect_ratio` | 成图 | | `aspect_ratio` | 成图 |
|---|---|---|---|---|
| `1:1` | 1024×1024 | | `3:4` | 768×1024 |
| `4:3` | 1024×768 | | `9:16` | 576×1024 |
| `3:2` | 1024×680 | | `2:1` | 1024×512 |
| `16:10` | 1024×640 | | `16:9` | 1024×576 |

取整规则：短边 = 长边 ÷ 比例，再向 8 的倍数取整（`3:2` → 682.7 → **680**，不是 683）。任意 `a:b` 都成立。

## 五、UltraFix

UltraFix **不放大**。它吃一张已经是目标尺寸的大图，按 tile 切开做分块 img2img 再混合重叠区。放大是 `/upscale` 的职责，所以顺序是「先放大、再 UltraFix」。

源码里的硬校验，任一条不满足即抛错（错误文本即后端原文）：

| 约束 | 报错 |
|---|---|
| 后端支持 ultrafix | `ultrafix not supported by this backend` |
| 必须带 `image` | `ultrafix requires 'image'` |
| **不可带 `mask`** | `ultrafix does not support 'mask'` |
| `tile_size > 0` 且 `% 8 == 0` | `Invalid ultrafix tile_size` |
| `width`、`height` 均 `% 8 == 0` | `ultrafix size must be a multiple of 8` |
| `min(W,H) >= max(tile_size, 512)` | `ultrafix image shorter edge must be >= N` |
| `max(W,H) <= 8192` | `ultrafix image too large (max 8192)` |

`tile_size` 只在非 SDXL 后端可调，SDXL 后端硬编码为 1024。`aspect_ratio` 在 ultrafix 下完全不生效 —— 此时宽高就是全图真实尺寸。

后端支持矩阵（`supportsUltrafix() = vaeTilingSupported() && supportsImg2Img()`）：

| Pipeline | ultrafix |
|---|---|
| `PipelineSd15Npu`（SD1.5 QNN） | ✅ |
| `PipelineSdxl`（SDXL QNN） | ✅ |
| `PipelineSd15Cpu` / `PipelineSdxlMnn`（MNN CPU） | ❌ |
| `PipelineAnima` / `PipelineDit`（FLUX.2） | ❌ |

## 六、`POST /upscale`（×4）

请求由 **HTTP 头 + raw body** 构成，不是 JSON：

| 位置 | 名称 | 说明 |
|---|---|---|
| Header | `X-Image-Width` | 原图宽（必需） |
| Header | `X-Image-Height` | 原图高（必需） |
| Header | `X-Upscaler-Path` | 放大器模型路径；`.mnn` 走 MNN，其余走 QNN（必需） |
| Header | `X-Use-OpenCL` | 可选 |
| Body | — | **raw RGB24**，字节数必须恰好为 `W × H × 3` |

固定放大 4 倍；最短边小于 192 时先放大到 192 再处理；输出 JPEG（quality 95）。

插件只能解 PNG 像素，所以 `mode="upscale"` 的输入限定为 PNG。

## 七、字段名陷阱

`POST /generate` 对**不认识的字段一律静默忽略**，不报错、不提示，返回的还是 txt2img 的图。实测被静默忽略的候选名：`init_image`、`init_images`、`input_image`、`init_img`、`image_base64`、`image_data`。**唯一有效的是 `image`**。

同类陷阱：`ultrafix` 传数字会报 `type must be boolean, but is number` —— **字段存在但类型错才会报错，报错反而是好消息**。用「传错误类型看是否报错」探测字段是否存在，是这套 API 上最可靠的字段发现手法。
