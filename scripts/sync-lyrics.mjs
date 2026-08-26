import { createDecipheriv } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const songsDirectory = join(projectRoot, 'songs')
const lyricsDirectory = join(projectRoot, 'lyrics')
const neteaseKey = Buffer.from("#14ljk_!\\]&0U<'(", 'utf8')
const force = process.argv.includes('--force')

const decryptNeteaseMetadata = (comment) => {
  const prefix = "163 key(Don't modify):"
  if (!comment?.startsWith(prefix)) return null

  try {
    const encrypted = Buffer.from(comment.slice(prefix.length), 'base64')
    const decipher = createDecipheriv('aes-128-ecb', neteaseKey, null)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
    return JSON.parse(decrypted.slice(decrypted.indexOf('{')))
  } catch {
    return null
  }
}

const readAudioMetadata = (filePath) => {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:format_tags=comment,title,artist,album', '-of', 'json', filePath],
    { encoding: 'utf8', windowsHide: true },
  )

  if (result.error?.code === 'ENOENT') {
    throw new Error('找不到 ffprobe，请先安装 FFmpeg 并将其加入 PATH。')
  }
  if (result.status !== 0) return null

  const format = JSON.parse(result.stdout).format ?? {}
  const tags = format.tags ?? {}
  const source = decryptNeteaseMetadata(tags.comment)
  return {
    album: source?.album ?? tags.album,
    artist: source?.artist?.map?.((item) => item[0]).join(' / ') ?? tags.artist,
    id: source?.musicId,
    title: source?.musicName ?? tags.title,
    duration: Number(format.duration),
  }
}

const normalizeTitle = (value = '') => value
  .normalize('NFKC')
  .replace(/^\s*(?:许嵩|vae)\s*[-—–]\s*/i, '')
  .replace(/\s*[-—–]\s*(?:许嵩|vae)\s*$/i, '')
  .replace(/\(\d+\)\s*$/i, '')
  .replace(/[《》\s·•,，.。'"“”‘’]/g, '')
  .toLowerCase()

const searchSong = async ({ duration, title }, fileTitle) => {
  const searchTitles = [...new Set([title, fileTitle].filter((item) => item && !/^\d+$/.test(item)))]
  const targetTitles = new Set(searchTitles.map(normalizeTitle).filter(Boolean))
  const candidates = new Map()

  for (const searchTitle of searchTitles) {
    const url = new URL('https://music.163.com/api/search/get')
    url.searchParams.set('s', searchTitle)
    url.searchParams.set('type', '1')
    url.searchParams.set('limit', '20')
    url.searchParams.set('offset', '0')

    const response = await fetch(url, {
      headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) continue

    const payload = await response.json()
    for (const song of payload.result?.songs ?? []) {
      if (!targetTitles.has(normalizeTitle(song.name))) continue
      const sourceText = [
        song.name,
        song.album?.name,
        ...(song.artists?.map((artist) => artist.name) ?? []),
      ].join(' ')
      if (!/(?:许嵩|vae|嵩哥)/i.test(sourceText)) continue
      const durationDelta = Math.abs(Number(song.duration) / 1000 - duration)
      if (!Number.isFinite(durationDelta) || durationDelta > 5) continue
      candidates.set(song.id, { ...song, durationDelta })
    }
  }

  const matches = [...candidates.values()].sort((left, right) => left.durationDelta - right.durationDelta)
  if (!matches.length) return { status: 'missing' }
  if (matches.length > 1 && matches[1].durationDelta - matches[0].durationDelta < 0.5) {
    return { status: 'ambiguous' }
  }
  return { status: 'matched', song: matches[0] }
}

const fetchLyric = async (musicId) => {
  const url = new URL('https://music.163.com/api/song/lyric')
  url.searchParams.set('id', String(musicId))
  url.searchParams.set('lv', '-1')
  url.searchParams.set('kv', '-1')
  url.searchParams.set('tv', '-1')

  const response = await fetch(url, {
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`歌词接口返回 HTTP ${response.status}`)

  const payload = await response.json()
  const lyric = payload.lrc?.lyric?.trim()
  const timedLineCount = lyric?.split(/\r?\n/).filter((line) => (
    /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?]/.test(line) && !/暂无歌词/.test(line)
  )).length ?? 0
  return timedLineCount >= 2 ? lyric : null
}

const files = (await readdir(songsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.mp3')
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))

await mkdir(lyricsDirectory, { recursive: true })

const summary = { created: [], existing: [], searched: [], noMatch: [], ambiguous: [], noLyric: [], failed: [] }

for (const fileName of files) {
  const title = basename(fileName, extname(fileName))
  const lyricPath = join(lyricsDirectory, `${title}.lrc`)

  if (!force) {
    try {
      const existing = await readFile(lyricPath, 'utf8')
      if (existing.trim()) {
        summary.existing.push(title)
        continue
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  try {
    const metadata = readAudioMetadata(join(songsDirectory, fileName))
    let musicId = metadata?.id
    if (!musicId) {
      const match = await searchSong(metadata ?? {}, title)
      if (match.status === 'missing') {
        summary.noMatch.push(title)
        continue
      }
      if (match.status === 'ambiguous') {
        summary.ambiguous.push(title)
        continue
      }
      musicId = match.song.id
      summary.searched.push(`${title} → ${match.song.name} (${match.song.id})`)
    }

    const lyric = await fetchLyric(musicId)
    if (!lyric) {
      summary.noLyric.push(title)
      continue
    }

    await writeFile(lyricPath, `${lyric}\n`, 'utf8')
    summary.created.push(title)
    console.log(`✓ ${title}`)
  } catch (error) {
    summary.failed.push(`${title}: ${error.message}`)
  }
}

// 同一音频常同时存在“歌曲名.mp3”和“许嵩 - 歌曲名.mp3”。远端匹配不唯一时，
// 仅在本地同名歌词内容唯一的情况下生成别名，避免把不同版本互相覆盖。
const lyricFiles = (await readdir(lyricsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.lrc')
const lyricsByNormalizedTitle = new Map()

for (const entry of lyricFiles) {
  const lyricTitle = basename(entry.name, extname(entry.name))
  const normalizedTitle = normalizeTitle(lyricTitle)
  const content = await readFile(join(lyricsDirectory, entry.name), 'utf8')
  if (!content.trim()) continue
  const entries = lyricsByNormalizedTitle.get(normalizedTitle) ?? []
  entries.push({ content, lyricTitle })
  lyricsByNormalizedTitle.set(normalizedTitle, entries)
}

const aliases = []
for (const fileName of files) {
  const title = basename(fileName, extname(fileName))
  const lyricPath = join(lyricsDirectory, `${title}.lrc`)
  try {
    if ((await readFile(lyricPath, 'utf8')).trim()) continue
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const candidates = lyricsByNormalizedTitle.get(normalizeTitle(title)) ?? []
  const uniqueContents = new Map(candidates.map((candidate) => [candidate.content, candidate]))
  if (uniqueContents.size !== 1) continue

  const [{ content, lyricTitle }] = uniqueContents.values()
  await writeFile(lyricPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  aliases.push(`${title} ← ${lyricTitle}`)
}

console.log('\n同步完成')
console.log(`新增：${summary.created.length}`)
console.log(`本地同曲别名：${aliases.length}`)
console.log(`已存在：${summary.existing.length}`)
console.log(`严格搜索匹配：${summary.searched.length}`)
console.log(`未匹配：${summary.noMatch.length}`)
console.log(`匹配不唯一：${summary.ambiguous.length}`)
console.log(`无时间轴歌词：${summary.noLyric.length}`)
console.log(`失败：${summary.failed.length}`)

for (const [label, items] of [
  ['本地同曲别名', aliases],
  ['严格搜索匹配', summary.searched],
  ['未匹配', summary.noMatch],
  ['匹配不唯一', summary.ambiguous],
  ['无时间轴歌词', summary.noLyric],
  ['失败', summary.failed],
]) {
  if (items.length) console.log(`\n${label}：\n- ${items.join('\n- ')}`)
}
