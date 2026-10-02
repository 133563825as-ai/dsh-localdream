/**
 * 自实现的 `defineTool`：把简写参数 DSL 编译成 JSON Schema，并在执行前校验入参。
 *
 * **为什么不用 `@deepseek-ai/dsh-tools`：**
 *
 * 这个插件要给别人的 dsh 装，就得避免任何依赖解析上的坑 —— 一旦 import 宿主包，
 * 安装侧就必须让插件目录能解析到宿主的 `node_modules`，而在这类容器里那通常意味着
 * 往插件目录里塞软链（`ln -s .../dsh/node_modules node_modules`）。软链本身有副作用：
 * 谁在插件目录里跑一次 `npm install`，就会顺着链接往**宿主的** `node_modules` 里写东西。
 *
 * `ctx.tools.register()` 真正接受的只是一份**编译好的 definition**（`name` /
 * `description` / `parameters`(JSON Schema) / `output` / `execute` …），
 * 宿主提供的 `defineTool` 只是作者侧的便利封装。这里自己实现等价物，于是插件运行期
 * 只 import Node 内置模块，`dependencies` 与 `peerDependencies` 都可以是空的。
 *
 * @module dsh-localdream/define-tool
 */

/** 允许出现在生成 schema 里的注解型关键字。 */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']

/** 参数 DSL 里允许出现的键。写错一个键就报错，好过编译出一份没人看得懂的 schema。 */
const SPEC_KEYS = new Set(['type', 'required', 'enum', 'items', 'properties', 'additionalProperties', ...ANNOTATION_KEYS])

function isPlainObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail (path, message) {
  throw new Error(`defineTool: ${path} ${message}`)
}

/**
 * 把单个属性的 DSL 编译成 JSON Schema。
 * @param {object} spec
 * @param {string} path - 报错时用的路径。
 * @returns {object}
 */
function compileValue (spec, path) {
  if (!isPlainObject(spec)) fail(path, '必须是对象')

  for (const key of Object.keys(spec)) {
    if (!SPEC_KEYS.has(key)) {
      fail(`${path}.${key}`, `不是支持的键（可用：${[...SPEC_KEYS].join(' / ')}）`)
    }
  }

  const schema = {}
  if (spec.type !== undefined) {
    if (typeof spec.type !== 'string') fail(`${path}.type`, '必须是字符串')
    schema.type = spec.type
  }
  for (const key of ANNOTATION_KEYS) {
    if (spec[key] !== undefined) schema[key] = spec[key]
  }
  if (spec.enum !== undefined) {
    if (!Array.isArray(spec.enum) || spec.enum.length === 0) fail(`${path}.enum`, '必须是非空数组')
    schema.enum = [...spec.enum]
  }
  if (spec.items !== undefined) {
    if (spec.type !== 'array') fail(`${path}.items`, '只能出现在 type = "array" 的属性上')
    schema.items = compileValue(spec.items, `${path}.items`)
  }
  if (spec.properties !== undefined) {
    if (spec.type !== 'object') fail(`${path}.properties`, '只能出现在 type = "object" 的属性上')
    const nested = compilePropertyMap(spec.properties, `${path}.properties`)
    schema.properties = nested.properties
    if (nested.required !== undefined) schema.required = nested.required
  }
  if (spec.additionalProperties !== undefined) {
    schema.additionalProperties = spec.additionalProperties
  }

  return schema
}

/**
 * 把属性表编译成 `properties` + `required`。
 * @param {object} spec
 * @param {string} path
 * @returns {{properties: object, required?: string[]}}
 */
function compilePropertyMap (spec, path) {
  if (!isPlainObject(spec)) fail(path, '必须是对象')

  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(spec)) {
    properties[key] = compileValue(value, `${path}.${key}`)
    if (value.required === true) required.push(key)
  }

  return required.length > 0 ? { properties, required } : { properties }
}

/**
 * 把参数 DSL 编译成参数对象的 JSON Schema。
 * @param {object} spec
 * @returns {{type: 'object', properties: object, required?: string[]}}
 */
export function compileParameters (spec) {
  const compiled = compilePropertyMap(spec ?? {}, 'parameters')
  return {
    type: 'object',
    properties: compiled.properties,
    ...(compiled.required === undefined ? {} : { required: compiled.required })
  }
}

function actualType (value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function matchesType (value, type) {
  const actual = actualType(value)
  if (type === 'integer') return actual === 'number' && Number.isInteger(value)
  if (type === 'number') return actual === 'number'
  return actual === type
}

/**
 * 按编译后的 schema 校验入参，返回违规描述（空数组表示通过）。
 *
 * 只校验声明过的键；未声明的键放行 —— 与宿主默认行为一致，
 * 免得模型多带一个无害字段就被挡回来。
 *
 * @param {object} schema
 * @param {object} args
 * @returns {string[]}
 */
export function validateArgs (schema, args) {
  if (!isPlainObject(args)) return ['arguments must be an object']

  const violations = []
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) violations.push(`"${key}" is required`)
  }

  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties?.[key]
    if (spec === undefined || value === undefined) continue

    if (spec.type !== undefined && !matchesType(value, spec.type)) {
      violations.push(`"${key}" must be ${spec.type}, got ${actualType(value)}`)
      continue
    }
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) {
      violations.push(`"${key}" must be one of ${JSON.stringify(spec.enum)}`)
      continue
    }
    if (spec.type === 'array' && Array.isArray(value) && spec.items?.type !== undefined) {
      value.forEach((item, index) => {
        if (!matchesType(item, spec.items.type)) {
          violations.push(`"${key}[${index}]" must be ${spec.items.type}`)
        }
      })
    }
  }

  return violations
}

/**
 * 与宿主 `defineTool` 等价的最小实现。
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.description
 * @param {object} options.parameters - 简写 DSL 属性表。
 * @param {{schema: object, render: (args: object, value: unknown) => unknown}} options.output
 * @param {(args: object, exec: object) => Promise<unknown>} options.execute
 * @param {number} [options.timeoutMs]
 * @param {(args: object) => boolean} [options.isConcurrencySafe]
 * @returns {object} 可直接交给 `ctx.tools.register()` 的 definition。
 */
export function defineTool (options) {
  if (!isPlainObject(options)) throw new Error('defineTool: options 必须是对象')
  if (typeof options.name !== 'string' || options.name === '') throw new Error('defineTool: name 不能为空')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${options.name}): execute 必须是函数`)
  if (!isPlainObject(options.output) || typeof options.output.render !== 'function') {
    throw new Error(`defineTool(${options.name}): 必须提供 output { schema, render }`)
  }
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new Error(`defineTool(${options.name}): timeoutMs 必须是正有限数`)
  }

  const parameters = compileParameters(options.parameters)
  const userExecute = options.execute

  const definition = {
    name: options.name,
    description: options.description ?? '',
    parameters,
    output: {
      schema: { type: 'object' },
      render: (args, value) => options.output.render(args, value)
    },
    async execute (args, exec) {
      const violations = validateArgs(parameters, args ?? {})
      if (violations.length > 0) {
        throw new Error(`invalid arguments: ${violations.join('; ')}`)
      }
      return userExecute(args ?? {}, exec)
    }
  }

  if (options.timeoutMs !== undefined) definition.timeoutMs = options.timeoutMs
  if (typeof options.isConcurrencySafe === 'function') {
    definition.isConcurrencySafe = (args) => options.isConcurrencySafe(args)
  }

  return definition
}
