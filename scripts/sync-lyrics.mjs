#!/usr/bin/env node
/**
 * 为 songs/ 下缺少同名歌词的 MP3 补齐 lyrics/*.lrc。
 *
 * 歌词来源按可靠性排序：
 *   1. MP3 标签里的网易云 `163 key(Don't modify):...`（AES-128-ECB，支持 music: / dj: 两种载荷）
 *   2. 酷狗歌词库（按歌名 + 许嵩 + 时长匹配）
 *   3. QQ 音乐歌词库（同上）
 *   4. 网易云搜索（严格校验后才采用）
 *
 * 每个来源都必须通过「时长 + 演唱者 + 标题」校验，且歌词本身要带时间轴才会被写入。
 *
 * 用法：
 *   npm run lyrics:sync                 # 只补缺失的歌词
 *   npm run lyrics:sync -- --force      # 全部重新拉取
 *   npm run lyrics:sync -- --only 素颜   # 只处理指定歌曲（可重复传）
 *   npm run lyrics:sync -- --dry-run    # 只打印结果，不写文件
 */

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SONG_DIR = path.join(ROOT, 'songs')
const LYRIC_DIR = path.join(ROOT, 'lyrics')
const REPORT = path.join(ROOT, '.lyrics-sync-report.json')

const AES_KEY = Buffer.from("#14ljk_!\\]&0U<'(")
const KEY_PREFIX = "163 key(Don't modify):"
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const TIMESTAMP = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g
const DURATION_TOLERANCE = 5
const REQUEST_DELAY_MS = 500

// 早期歌曲/翻唱在网易云上只能靠人工确认对应曲目，这里登记已核实的歌曲 ID
const MANUAL_NETEASE_IDS = {
  自废的承诺: 1960321101,
  天空的遥远: 1365785107,
  布拉格广场: 210049,
  我愿意: 5244822,
  渲染离别: 1887074826,
}

// 歌名本身有歧义时，额外用这些关键词去搜（翻唱按原唱查）
const MANUAL_QUERIES = {
  暗号: ['暗号 周杰伦'],
  圣诞乱感觉: ['圣诞乱感觉 乱感觉'],
}

const argv = process.argv.slice(2)
const FORCE = argv.includes('--force')
const DRY_RUN = argv.includes('--dry-run')
const ONLY = argv.reduce((acc, arg, i) => (arg === '--only' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...args) => console.log(...args)

/* ------------------------------------------------------------------ 通用工具 */

const readTags = (file) => {
  try {
    const json = execFileSync('ffprobe', ['-v', 'quiet', '-show_format', '-print_format', 'json', file], {
      encoding: 'utf8',
    })
    const format = JSON.parse(json).format ?? {}
    return { tags: format.tags ?? {}, duration: Number(format.duration) || 0 }
  } catch {
    return { tags: {}, duration: 0 }
  }
}

const normalize = (value = '') =>
  String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_,，。！!？?~·'"’“”()（）[\]【】]/g, '')

/** 把 "歌曲名-许嵩"、版本后缀等去掉，得到适合搜索的关键词 */
const toKeyword = (name) =>
  name
    .replace(/[-—_]\s*(许嵩|vae)$/i, '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/\s*(独白版|特别版|即兴版|demo|合唱版|翻唱)\s*$/i, '')
    .trim()

const isVae = (value = '') => /许嵩|vae|嵩哥/i.test(value)

// 伴奏 / DJ 版 / 铃声片段等不是原曲，直接排除
const REJECT = /伴奏|纯音乐|instrumental|remix|dj|加快|慢摇|铃声|片段|翻自|cover/i

/** 比较歌名时先去掉 "(Demo)"、"[Live]" 这类后缀 */
const canon = (value = '') =>
  normalize(
    String(value)
      .replace(/[（(【[][^)）】\]]*[)）】\]]/g, '')
      .replace(/\b(live|remix|demo|version|ver)\b/gi, ''),
  )

const durationDelta = (candidate, duration) =>
  candidate.duration ? Math.abs(candidate.duration - duration) : Number.POSITIVE_INFINITY

const toSeconds = (duration) => {
  const value = Number(duration) || 0
  return value > 5000 ? value / 1000 : value
}

const isTimedLyric = (lyric) => {
  if (!lyric || /暂无歌词/.test(lyric)) return false
  const lines = lyric
    .split(/\r?\n/)
    .filter((line) => TIMESTAMP.test(line) && line.replace(TIMESTAMP, '').trim())
  TIMESTAMP.lastIndex = 0
  return lines.length >= 4
}

/* ------------------------------------------------------------------ 网易云 */

const decrypt163Key = (payload) => {
  const decipher = crypto.createDecipheriv('aes-128-ecb', AES_KEY, null)
  const plain = Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(plain.slice(plain.indexOf('{')))
}

const parseTag = (comment = '') => {
  const value = String(comment).trim()
  if (/^\d+_\d+$/.test(value)) return { id: Number(value.split('_')[0]), source: 'tag' }
  if (!value.startsWith(KEY_PREFIX)) return null
  try {
    const meta = decrypt163Key(value.slice(KEY_PREFIX.length))
    return {
      id: Number(meta.musicId ?? meta.mainMusic?.musicId ?? meta.program?.mainSong?.id) || null,
      name: meta.musicName ?? meta.mainMusic?.musicName ?? meta.programName ?? '',
      source: 'tag',
    }
  } catch {
    return null
  }
}

// 网易云限流很频繁：连续命中两次就熔断，避免整轮同步被退避拖死
let neteaseBlocked = false
let neteaseStrikes = 0

const neteaseFetch = async (url, attempt = 0) => {
  if (neteaseBlocked) throw new Error('网易云接口已熔断')

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  if (data?.code === 405 || /操作频繁/.test(data?.msg ?? '')) {
    neteaseStrikes += 1
    if (attempt < 2 && neteaseStrikes < 3) {
      await sleep(6000 * (attempt + 1))
      return neteaseFetch(url, attempt + 1)
    }
    neteaseBlocked = true
    throw new Error('网易云接口限流，本轮停止使用')
  }
  neteaseStrikes = 0
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return data
}

const neteaseSearch = async (keyword) => {
  // 注意：GET 版 search/get/web 很容易被限流，POST 版 search/get 稳定得多
  const res = await fetch('https://music.163.com/api/search/get', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://music.163.com/',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ s: keyword, type: '1', limit: '10', offset: '0' }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  if (data?.code === 405 || /操作频繁/.test(data?.msg ?? data?.message ?? '')) throw new Error('网易云搜索限流')
  return (data?.result?.songs ?? []).map((song) => ({
    id: song.id,
    name: song.name,
    artist: (song.artists ?? []).map((a) => a.name).join('/'),
    duration: (song.duration ?? 0) / 1000,
  }))
}

const fromNetease = async ({ id = null, keyword = null, duration }) => {
  let songId = id

  if (!songId && keyword) {
    const target = canon(keyword)
    const pick = (songs) =>
      songs
        .filter((song) => canon(song.name) === target)
        .filter((song) => isVae(song.artist) || durationDelta(song, duration) <= DURATION_TOLERANCE)
        .sort((a, b) => durationDelta(a, duration) - durationDelta(b, duration))

    // 先带「许嵩」搜，能有效压掉同名翻唱；再退回纯歌名
    for (const query of [`${keyword} 许嵩`, keyword]) {
      const ranked = pick(await neteaseSearch(query))
      if (ranked.length) {
        songId = ranked.find((song) => durationDelta(song, duration) <= DURATION_TOLERANCE)?.id ?? ranked[0].id
        break
      }
      await sleep(REQUEST_DELAY_MS)
    }
  }

  if (!songId) return null

  const data = await neteaseFetch(`https://music.163.com/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`)
  const lyric = data?.lrc?.lyric?.trim() ?? ''
  const translation = data?.tlyric?.lyric?.trim() ?? ''
  if (data?.pureMusic || !isTimedLyric(lyric)) return null

  return { lyric: mergeTranslation(lyric, translation), label: `网易云 ${songId}` }
}

const mergeTranslation = (lyric, translation) => {
  if (!translation) return lyric
  const map = new Map(
    translation
      .split(/\r?\n/)
      .map((line) => [line.match(TIMESTAMP)?.[0], line.replace(TIMESTAMP, '').trim()])
      .filter(([stamp, text]) => stamp && text),
  )
  if (!map.size) return lyric
  return lyric
    .split(/\r?\n/)
    .map((line) => {
      const stamp = line.match(TIMESTAMP)?.[0]
      const translated = stamp ? map.get(stamp) : null
      return translated ? `${line}\n${stamp}${translated}` : line
    })
    .join('\n')
}

/* ------------------------------------------------------------------ 酷狗 */

const kugouSearch = async (keyword) => {
  const url = `https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=${encodeURIComponent(keyword)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => null)
  return (data?.candidates ?? []).map((item) => ({
    id: item.id,
    accesskey: item.accesskey,
    name: item.song,
    artist: item.singer,
    duration: toSeconds(item.duration),
  }))
}

const kugouLyric = async (candidate) => {
  const url = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${candidate.id}&accesskey=${candidate.accesskey}&fmt=lrc&charset=utf8`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  const data = await res.json().catch(() => null)
  if (!data?.content) return null
  return Buffer.from(data.content, 'base64').toString('utf8').trim()
}

/** 按「歌名完全相同」筛选，再按演唱者与时长排序，逐条尝试取词 */
const pickLyric = async (candidates, keyword, duration, fetchLyric) => {
  const target = canon(keyword)
  const usable = candidates.filter((item) => canon(item.name) === target && !REJECT.test(item.name))
  if (!usable.length) return null

  const tiers = [
    usable.filter((item) => isVae(item.artist) && durationDelta(item, duration) <= DURATION_TOLERANCE),
    usable.filter((item) => isVae(item.artist)),
    usable.filter((item) => durationDelta(item, duration) <= DURATION_TOLERANCE),
  ]

  for (const tier of tiers) {
    for (const candidate of tier.sort((a, b) => durationDelta(a, duration) - durationDelta(b, duration)).slice(0, 3)) {
      const lyric = await fetchLyric(candidate)
      await sleep(REQUEST_DELAY_MS)
      if (isTimedLyric(lyric)) {
        return {
          lyric,
          label: `${candidate.name}/${candidate.artist} ${candidate.duration}s`,
          mismatch: durationDelta(candidate, duration) > DURATION_TOLERANCE,
        }
      }
    }
  }
  return null
}

const fromKugou = async (keyword, duration) => {
  const candidates = await kugouSearch(`${keyword} 许嵩`)
  if (!candidates.length) candidates.push(...(await kugouSearch(keyword)))
  const hit = await pickLyric(candidates, keyword, duration, kugouLyric)
  return hit && { ...hit, label: `酷狗 ${hit.label}` }
}

/* ------------------------------------------------------------------ QQ 音乐 */

const qqSearch = async (keyword) => {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=10&w=${encodeURIComponent(
    keyword,
  )}&format=json`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  return (data?.data?.song?.list ?? []).map((song) => ({
    mid: song.songmid ?? song.songMid,
    name: song.songname ?? song.name,
    artist: (song.singer ?? []).map((s) => s.name).join('/'),
    duration: Number(song.interval) || 0,
  }))
}

const qqLyric = async (mid) => {
  const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1&g_tk=5381`
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://y.qq.com/portal/player.html' },
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => null)
  return typeof data?.lyric === 'string' ? data.lyric.trim() : null
}

const fromQQ = async (keyword, duration) => {
  const candidates = await qqSearch(`${keyword} 许嵩`)
  const hit = await pickLyric(candidates, keyword, duration, (candidate) => qqLyric(candidate.mid))
  return hit && { ...hit, label: `QQ ${hit.label}` }
}

/* ------------------------------------------------------------------ 主流程 */

const listSongs = () =>
  fs
    .readdirSync(SONG_DIR)
    .filter((file) => file.toLowerCase().endsWith('.mp3'))
    .map((file) => file.replace(/\.mp3$/i, ''))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

const resolve = async (name, duration, tagInfo, sources) => {
  const altName = tagInfo?.name && !/^\d+$/.test(tagInfo.name) ? tagInfo.name : ''
  const keywords = [
    ...new Set([toKeyword(name), toKeyword(altName), ...(MANUAL_QUERIES[name] ?? [])].filter(Boolean)),
  ]

  if (sources.includes('netease-tag')) {
    const manualId = MANUAL_NETEASE_IDS[name]
    const ids = [manualId, tagInfo?.id].filter(Boolean)
    for (const id of ids) {
      const hit = await fromNetease({ id, duration })
      if (hit) return { ...hit, source: id === manualId ? '网易云人工核对' : '网易云标签' }
      await sleep(REQUEST_DELAY_MS)
    }
  }

  if (sources.includes('search')) {
    for (const keyword of keywords) {
      try {
        const hit = await fromNetease({ keyword, duration })
        if (hit) return { ...hit, source: '网易云搜索' }
      } catch (error) {
        log(`   ! 网易云搜索失败：${error.message}`)
      }

      for (const [source, label] of [
        [fromKugou, '酷狗'],
        [fromQQ, 'QQ 音乐'],
      ]) {
        try {
          const hit = await source(keyword, duration)
          if (hit) return { ...hit, source: label }
        } catch (error) {
          log(`   ! ${label} 失败：${error.message}`)
        }
        await sleep(REQUEST_DELAY_MS)
      }
    }
  }

  return null
}

const main = async () => {
  if (!fs.existsSync(LYRIC_DIR)) fs.mkdirSync(LYRIC_DIR, { recursive: true })

  const songs = listSongs().filter((name) => !ONLY.length || ONLY.includes(name))
  const pending = songs.filter((name) => FORCE || !fs.existsSync(path.join(LYRIC_DIR, `${name}.lrc`)))

  log(`共 ${songs.length} 首，待处理 ${pending.length} 首${FORCE ? '（--force）' : ''}\n`)

  const filled = []
  const failed = []
  const work = new Map(
    pending.map((name) => {
      const { tags, duration } = readTags(path.join(SONG_DIR, `${name}.mp3`))
      return [name, { duration, tagInfo: parseTag(tags.comment) }]
    }),
  )

  const run = async (names, sources, title) => {
    if (!names.length) return
    log(`\n=== ${title}（${names.length} 首）===`)
    for (const [index, name] of names.entries()) {
      const { duration, tagInfo } = work.get(name)
      const prefix = `[${index + 1}/${names.length}] ${name}`
      let result = null

      try {
        result = await resolve(name, duration, tagInfo, sources)
      } catch (error) {
        log(`${prefix} ! ${error.message}`)
      }

      if (!result) {
        log(`${prefix} ✗ 未找到可用歌词`)
        continue
      }

      if (!DRY_RUN) fs.writeFileSync(path.join(LYRIC_DIR, `${name}.lrc`), `${result.lyric}\n`, 'utf8')
      log(`${prefix} ✓ ${result.source}：${result.label}`)
      filled.push({ name, source: result.source, label: result.label, duration: Math.round(duration) })
    }
  }

  const withTag = pending.filter((name) => work.get(name).tagInfo?.id || MANUAL_NETEASE_IDS[name])
  await run(withTag, ['netease-tag'], '第一批：网易云标签 ID')

  const remaining = pending.filter((name) => !filled.some((item) => item.name === name))
  await run(remaining, ['search'], '第二批：酷狗 / QQ / 网易云搜索')

  const filledNames = new Set(filled.map((item) => item.name))
  for (const name of pending) {
    if (!filledNames.has(name)) failed.push({ name, duration: Math.round(work.get(name).duration) })
  }

  const report = { generatedAt: new Date().toISOString(), filled, failed }
  if (!DRY_RUN) fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  log(`\n补齐 ${filled.length} 首，失败 ${failed.length} 首`)
  if (failed.length) log(`\n未找到：\n${failed.map((item) => `- ${item.name}（${item.duration}s）`).join('\n')}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
