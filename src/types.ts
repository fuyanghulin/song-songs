export type SectionKey = 'albums' | 'singles'

export interface Track {
  id: string
  title: string
  displayTitle: string
  fileName: string
  groupId: string
  groupName: string
  section: SectionKey
  year?: string
  note?: string
  pdfPage?: number
  index: number
}

export interface CatalogGroup {
  id: string
  name: string
  section: SectionKey
  date?: string
  year?: string
  count: number
  tracks: Track[]
}

export interface LyricLine {
  time: number
  text: string
}

export type RepeatMode = 'off' | 'all' | 'one'
