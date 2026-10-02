import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contentTypeFor, listImages, resolveImagePath } from '../src/gallery.js'
import { encodePng } from '../src/png.js'

async function makeDir () {
  return mkdtemp(join(tmpdir(), 'ld-gallery-'))
}

test('listImages 读出尺寸并按修改时间倒序', async () => {
  const dir = await makeDir()
  await writeFile(join(dir, 'old.png'), await encodePng(8, 4, Buffer.alloc(8 * 4 * 3, 1)))
  await writeFile(join(dir, 'new.png'), await encodePng(6, 3, Buffer.alloc(6 * 3 * 3, 2)))

  // 把 old 的时间推到更早
  const past = new Date(Date.now() - 60_000)
  await utimes(join(dir, 'old.png'), past, past)

  const images = await listImages(dir)
  assert.equal(images.length, 2)
  assert.equal(images[0].name, 'new.png')
  assert.equal(images[0].width, 6)
  assert.equal(images[0].height, 3)
  assert.equal(images[0].format, 'png')
  assert.equal(images[1].name, 'old.png')
  assert.equal(images[1].width, 8)
})

test('listImages 只认图片扩展名', async () => {
  const dir = await makeDir()
  await writeFile(join(dir, 'note.txt'), 'hello')
  await writeFile(join(dir, 'a.png'), await encodePng(2, 2, Buffer.alloc(12)))
  const images = await listImages(dir)
  assert.deepEqual(images.map((item) => item.name), ['a.png'])
})

test('listImages 在目录不存在时返回空数组而不是抛错', async () => {
  assert.deepEqual(await listImages(join(tmpdir(), 'ld-does-not-exist-' + Date.now())), [])
  assert.deepEqual(await listImages(''), [])
})

test('listImages 支持 limit 与 grep', async () => {
  const dir = await makeDir()
  for (const name of ['ld_1.png', 'ld_2.png', 'other.png']) {
    await writeFile(join(dir, name), await encodePng(2, 2, Buffer.alloc(12)))
  }
  assert.equal((await listImages(dir, { limit: 2 })).length, 2)
  assert.deepEqual((await listImages(dir, { grep: 'ld_' })).map((item) => item.name).sort(), ['ld_1.png', 'ld_2.png'])
})

test('listImages 对认不出尺寸的文件照常列出，只是宽高为 0', async () => {
  const dir = await makeDir()
  await writeFile(join(dir, 'broken.png'), Buffer.from('not really a png'))
  const images = await listImages(dir)
  assert.equal(images.length, 1)
  assert.equal(images[0].width, 0)
  assert.equal(images[0].format, 'unknown')
})

test('resolveImagePath 把路径压成文件名，挡住穿越', () => {
  const dir = '/tmp/ld-out'
  assert.equal(resolveImagePath(dir, 'a.png'), '/tmp/ld-out/a.png')
  // 关键性质：任何输入都被压成纯文件名，结果永远落在输出目录里
  assert.equal(resolveImagePath(dir, '../../etc/passwd.png'), '/tmp/ld-out/passwd.png')
  assert.equal(resolveImagePath(dir, '/etc/hosts.png'), '/tmp/ld-out/hosts.png')
  assert.ok(resolveImagePath(dir, '..\\..\\windows\\evil.png').startsWith('/tmp/ld-out/'))
})

test('resolveImagePath 拒绝空名与非图片扩展名', () => {
  for (const bad of ['', '.', '..', 'passwd', 'a.txt', 'a.js']) {
    assert.throws(() => resolveImagePath('/tmp/ld-out', bad), /文件名无效|只能读取图片文件/, `应拒绝 ${JSON.stringify(bad)}`)
  }
})

test('contentTypeFor 按扩展名给类型', () => {
  assert.equal(contentTypeFor('a.png'), 'image/png')
  assert.equal(contentTypeFor('a.JPG'), 'image/jpeg')
  assert.equal(contentTypeFor('a.jpeg'), 'image/jpeg')
  assert.equal(contentTypeFor('a.webp'), 'image/webp')
  assert.equal(contentTypeFor('a.unknown'), 'application/octet-stream')
})
