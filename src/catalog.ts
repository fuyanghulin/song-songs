import catalogMarkdown from '../许嵩歌曲目录.md?raw'
import type { CatalogGroup, SectionKey, Track } from './types'

const slugify = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[《》（），、；：·\s]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

const cleanSectionName = (heading: string) =>
  heading.replace(/^[一二三四五六七八九十]+、/, '').trim()

const parseGroupHeading = (heading: string, section: SectionKey) => {
  const value = heading.replace(/^\d+\.\s*/, '').trim()
  if (section === 'albums') {
    const match = value.match(/^《(.+?)》\（(.+?)，\s*(\d+)\s*首\）$/)
    if (match) {
      return { name: match[1], date: match[2], count: Number(match[3]) }
    }
  }

  const match = value.match(/^(.+?)\（(\d+)\s*首\）$/)
  return match
    ? { name: match[1], count: Number(match[2]) }
    : { name: value, count: 0 }
}

const extractVariant = (note?: string) => {
  if (!note || note === '-') return ''
  const parts = note.split(/[；;]/).map((part) => part.trim())
  const label = parts.find((part) => /版|demo|翻唱/i.test(part))
  return label ?? ''
}

const parseCatalog = () => {
  const groups: CatalogGroup[] = []
  const lines = catalogMarkdown.split(/\r?\n/)
  let section: SectionKey | null = null
  let currentGroup: CatalogGroup | null = null

  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)$/)
    if (sectionMatch) {
      const sectionName = cleanSectionName(sectionMatch[1])
      section = sectionName.includes('专辑') ? 'albums' : sectionName.includes('单曲') ? 'singles' : null
      currentGroup = null
      continue
    }

    const groupMatch = line.match(/^###\s+(.+)$/)
    if (groupMatch && section) {
      const parsed = parseGroupHeading(groupMatch[1], section)
      const id = `${section}-${slugify(parsed.name)}`
      currentGroup = {
        id,
        name: parsed.name,
        section,
        date: 'date' in parsed ? parsed.date : undefined,
        year: 'date' in parsed ? parsed.date?.slice(0, 4) : undefined,
        count: parsed.count,
        tracks: [],
      }
      groups.push(currentGroup)
      continue
    }

    if (!currentGroup || !/^\|\s*\d+\s*\|/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    const title = cells[1]?.replace(/^《|》$/g, '')
    if (!title) continue
    const note = currentGroup.section === 'singles' ? cells[2] : undefined
    const pageValue = currentGroup.section === 'singles' ? cells[3] : cells[2]
    const track: Track = {
      id: `${currentGroup.id}-${String(currentGroup.tracks.length + 1).padStart(2, '0')}`,
      title,
      displayTitle: title,
      fileName: title,
      groupId: currentGroup.id,
      groupName: currentGroup.name,
      section: currentGroup.section,
      year: currentGroup.year ?? note?.match(/\d{4}/)?.[0],
      note: note && note !== '-' ? note : undefined,
      pdfPage: Number(pageValue) || undefined,
      index: currentGroup.tracks.length + 1,
    }
    currentGroup.tracks.push(track)
  }

  const titleCount = groups.flatMap((group) => group.tracks).reduce<Record<string, number>>((acc, track) => {
    acc[track.title] = (acc[track.title] ?? 0) + 1
    return acc
  }, {})

  groups.forEach((group) => {
    group.tracks.forEach((track) => {
      if (titleCount[track.title] > 1) {
        const variant = extractVariant(track.note)
        if (variant) {
          track.displayTitle = `${track.title}（${variant}）`
          track.fileName = track.displayTitle
        }
      }
    })
  })

  return groups
}

export const catalogGroups = parseCatalog()
export const allTracks = catalogGroups.flatMap((group) => group.tracks)
export const albumGroups = catalogGroups.filter((group) => group.section === 'albums')
export const singleGroups = catalogGroups.filter((group) => group.section === 'singles')

