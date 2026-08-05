import type { LyricLine } from './types'

const timestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

export const parseLrc = (source: string): LyricLine[] => {
  const result: LyricLine[] = []

  source.split(/\r?\n/).forEach((line) => {
    const text = line.replace(timestampPattern, '').trim()
    const matches = [...line.matchAll(timestampPattern)]
    matches.forEach((match) => {
      const minutes = Number(match[1])
      const seconds = Number(match[2])
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0')}`) : 0
      result.push({ time: minutes * 60 + seconds + fraction, text: text || '· · ·' })
    })
  })

  return result.sort((a, b) => a.time - b.time)
}

export const findActiveLyric = (lyrics: LyricLine[], currentTime: number) => {
  let active = -1
  for (let index = 0; index < lyrics.length; index += 1) {
    if (lyrics[index].time <= currentTime) active = index
    else break
  }
  return active
}
