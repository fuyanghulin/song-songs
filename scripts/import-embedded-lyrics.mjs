#!/usr/bin/env node
/**
 * 部分早期歌曲（多为网易云 DJ 节目）在流媒体上没有带时间轴的歌词，
 * 但 MP3 标签里的 163 key 载荷带有完整的 programDesc 歌词文本。
 *
 * 本脚本把这些文本抽出来写入 lyrics/*.lrc。由于文本本身没有时间码，
 * 时间轴按音频时长均匀估算（仅用于让播放器能滚动显示，并非精确对齐）。
 *
 * 用法：node scripts/import-embedded-lyrics.mjs [--force]
 */

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SONG_DIR = path.join(ROOT, 'songs')
const LYRIC_DIR = path.join(ROOT, 'lyrics')
const AES_KEY = Buffer.from("#14ljk_!\\]&0U<'(")
const KEY_PREFIX = "163 key(Don't modify):"
const FORCE = process.argv.includes('--force')

/** start：正片第一句（之前的简介/署名会被丢弃）；stripSinger：去掉 (Vae) 这类演唱者前缀 */
const SONGS = {
  '呆呆的梦': { start: '（飞机轰鸣起飞）' },
  '过大节': { start: '就这样过了一个节' },
  '花男子': { start: '无聊就照照镜子' },
  '加油 UP': { start: '零度全是冰水混合物' },
  '酒晓语令': { start: '孤单的人孤单假日恰恰恰' },
  '圣索菲亚教堂': { start: '踏着泥泞的脚步' },
  '碎语': { start: '现在是4月11日上午8点46分' },
  '相信世界相信爱': { start: '当世界落下满天尘埃', stripSinger: true },
  '寻风': { start: '繁华莫名其妙' },
  '寻风快乐': { start: '我知道上网不能获得什么那么' },
  '猪你生日快乐': { start: '猪你生日快乐唉' },
  'Q版火影': { start: '木叶的雨打的树叶滴答滴答' },
  'You will love Beijing': { start: '嘿，hello' },
}

const decrypt = (comment) => {
  const payload = comment.slice(KEY_PREFIX.length)
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null)
  const plain = Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(plain.slice(plain.indexOf('{')))
}

const readFormat = (file) => {
  const json = execFileSync('ffprobe', ['-v', 'quiet', '-show_format', '-print_format', 'json', file], {
    encoding: 'utf8',
  })
  const format = JSON.parse(json).format ?? {}
  return { duration: Number(format.duration) || 0, comment: format.tags?.comment ?? '' }
}

const toTimestamp = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `[${String(minutes).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}]`
}

const buildLyric = (text, { start, stripSinger = false }, duration) => {
  const all = text.split('\n').map((line) => line.trim())
  const from = all.findIndex((line) => line.includes(start))
  let lines = all.slice(from === -1 ? 0 : from).filter(Boolean)

  if (stripSinger) {
    lines = lines.map((line) => line.replace(/^[（(]?[^)）]{1,24}[)）]\s*/, '')).filter(Boolean)
  }

  const begin = 3
  const end = Math.max(begin + lines.length, duration - 5)
  const step = lines.length > 1 ? (end - begin) / (lines.length - 1) : 0

  return lines.map((line, index) => `${toTimestamp(begin + index * step)}${line}`).join('\n')
}

let written = 0
for (const [name, config] of Object.entries(SONGS)) {
  const target = path.join(LYRIC_DIR, `${name}.lrc`)
  if (!FORCE && fs.existsSync(target)) {
    console.log(`跳过（已存在）${name}`)
    continue
  }

  const { duration, comment } = readFormat(path.join(SONG_DIR, `${name}.mp3`))
  if (!comment.startsWith(KEY_PREFIX)) {
    console.log(`跳过（无内嵌歌词）${name}`)
    continue
  }

  const desc = (decrypt(comment).programDesc ?? '').replace(/\r/g, '')
  if (!desc.trim()) {
    console.log(`跳过（描述为空）${name}`)
    continue
  }

  const lyric = buildLyric(desc, config, duration)
  fs.writeFileSync(target, `${lyric}\n`, 'utf8')
  written += 1
  console.log(`✓ ${name}（${lyric.split('\n').length} 行，时间轴为估算）`)
}

console.log(`\n写入 ${written} 首内嵌歌词。`)
