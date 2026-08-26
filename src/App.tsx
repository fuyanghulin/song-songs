import {
  ChevronDown,
  Disc3,
  ListMusic,
  Menu,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { albumGroups, allTracks, catalogGroups, singleGroups } from './catalog'
import { findActiveLyric, parseLrc } from './lyrics'
import type { CatalogGroup, LyricLine, RepeatMode, Track } from './types'

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

const mediaBaseUrl = (import.meta.env.VITE_MEDIA_BASE_URL || import.meta.env.BASE_URL).replace(/\/?$/, '/')

const assetUrl = (directory: 'songs' | 'lyrics', fileName: string, extension: 'mp3' | 'lrc') =>
  `${mediaBaseUrl}${directory}/${encodeURIComponent(fileName)}.${extension}`

const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, '')

const defaultDocumentTitle = '留声 · 许嵩音乐集'

interface SidebarProps {
  selectedGroupId: string
  onSelectGroup: (group: CatalogGroup) => void
  open: boolean
  onClose: () => void
}

function Sidebar({ selectedGroupId, onSelectGroup, open, onClose }: SidebarProps) {
  const renderSection = (label: string, groups: CatalogGroup[]) => (
    <section className="nav-section" aria-labelledby={`nav-${label}`}>
      <p className="nav-eyebrow" id={`nav-${label}`}>{label}</p>
      <div className="nav-list">
        {groups.map((group) => (
          <button
            className={`nav-item ${selectedGroupId === group.id ? 'is-active' : ''}`}
            key={group.id}
            onClick={() => {
              onSelectGroup(group)
              onClose()
            }}
            type="button"
          >
            <span className="nav-item-copy">
              <span className="nav-item-name">{group.name}</span>
              {group.date && <span className="nav-item-date">{group.date}</span>}
            </span>
            <span className="nav-item-count">{group.tracks.length}</span>
          </button>
        ))}
      </div>
    </section>
  )

  return (
    <>
      <button
        className={`sidebar-scrim ${open ? 'is-visible' : ''}`}
        aria-label="关闭分类菜单"
        onClick={onClose}
        type="button"
      />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="歌曲分类">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">半</span>
          <span>
            <strong>留声</strong>
            <small>VAE SONGBOOK</small>
          </span>
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="关闭分类菜单" type="button">
            <X size={20} />
          </button>
        </div>

        <nav className="sidebar-scroll">
          {renderSection('专辑', albumGroups)}
          {renderSection('单曲集', singleGroups)}
        </nav>

        <div className="catalog-footnote">
          <span>曲目总录</span>
          <strong>{allTracks.length}</strong>
          <small>{albumGroups.length} 张专辑 · {singleGroups.length} 组单曲</small>
        </div>
      </aside>
    </>
  )
}

interface LyricsPanelProps {
  track: Track
  lyrics: LyricLine[]
  activeIndex: number
  status: 'idle' | 'loading' | 'ready' | 'missing'
  onSeek: (time: number) => void
  mobileOpen: boolean
  onMobileClose: () => void
}

function LyricsPanel({ track, lyrics, activeIndex, status, onSeek, mobileOpen, onMobileClose }: LyricsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeIndex < 0 || !scrollRef.current) return
    const activeElement = scrollRef.current.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`)
    if (!activeElement) return
    const target = activeElement.offsetTop - scrollRef.current.clientHeight * 0.38
    scrollRef.current.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex])

  return (
    <aside className={`lyrics-panel ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="歌词">
      <div className="lyrics-header">
        <div>
          <p className="section-kicker">正在播放</p>
          <h2>{track.displayTitle}</h2>
          <p>{track.groupName} · 许嵩</p>
        </div>
        <button className="icon-button lyrics-close" onClick={onMobileClose} aria-label="关闭歌词" type="button">
          <ChevronDown size={22} />
        </button>
      </div>

      <div className="lyrics-rule" />
      <div className="lyrics-scroll" ref={scrollRef}>
        {status === 'loading' && (
          <div className="lyrics-state">
            <span className="loading-line" />
            <span className="loading-line short" />
            <span className="loading-line" />
          </div>
        )}
        {status === 'missing' && (
          <div className="lyrics-state lyrics-missing">
            <Music2 size={24} strokeWidth={1.5} />
            <strong>歌词尚未就位</strong>
            <p>把「{track.fileName}.lrc」放入 lyrics 目录，刷新后即可逐行同步。</p>
          </div>
        )}
        {status === 'ready' && lyrics.map((line, index) => (
          <button
            className={`lyric-line ${index === activeIndex ? 'is-active' : ''}`}
            data-lyric-index={index}
            key={`${line.time}-${index}`}
            onClick={() => onSeek(line.time)}
            type="button"
          >
            {line.text}
          </button>
        ))}
      </div>
    </aside>
  )
}

interface PlayerBarProps {
  track: Track
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  repeatMode: RepeatMode
  shuffle: boolean
  audioMissing: boolean
  onToggle: () => void
  onPrevious: () => void
  onNext: () => void
  onSeek: (time: number) => void
  onVolume: (volume: number) => void
  onToggleMute: () => void
  onCycleRepeat: () => void
  onToggleShuffle: () => void
  lyricsOpen: boolean
  onToggleLyrics: () => void
  onOpenLyrics: () => void
}

function PlayerBar({
  track,
  isPlaying,
  currentTime,
  duration,
  volume,
  repeatMode,
  shuffle,
  audioMissing,
  onToggle,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onToggleMute,
  onCycleRepeat,
  onToggleShuffle,
  lyricsOpen,
  onToggleLyrics,
  onOpenLyrics,
}: PlayerBarProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <footer className="player-bar" aria-label="音乐播放器">
      <div className="player-track">
        <div className={`mini-cover ${isPlaying ? 'is-spinning' : ''}`} aria-hidden="true">
          <span>{track.title.slice(0, 1)}</span>
        </div>
        <button className="player-track-copy" onClick={onOpenLyrics} type="button">
          <strong>{track.displayTitle}</strong>
          <span>{audioMissing ? '音频文件尚未放入' : `${track.groupName} · 许嵩`}</span>
        </button>
      </div>

      <div className="player-center">
        <div className="player-controls">
          <button
            className={`mobile-lyrics-button ${lyricsOpen ? 'is-active' : ''}`}
            onClick={onToggleLyrics}
            aria-label={lyricsOpen ? '关闭歌词' : '查看歌词'}
            aria-pressed={lyricsOpen}
            type="button"
          >
            词
          </button>
          <button className={`control-button auxiliary ${shuffle ? 'is-active' : ''}`} onClick={onToggleShuffle} aria-label="随机播放" aria-pressed={shuffle} type="button">
            <Shuffle size={17} />
          </button>
          <button className="control-button" onClick={onPrevious} aria-label="上一首" type="button">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="play-button" onClick={onToggle} aria-label={isPlaying ? '暂停' : '播放'} type="button">
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button className="control-button" onClick={onNext} aria-label="下一首" type="button">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button className={`control-button auxiliary ${repeatMode !== 'off' ? 'is-active' : ''}`} onClick={onCycleRepeat} aria-label={`循环模式：${repeatMode}`} type="button">
            {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <div className="progress-row">
          <span>{formatTime(currentTime)}</span>
          <input
            aria-label="播放进度"
            className="range progress-range"
            max={duration || 0}
            min="0"
            onChange={(event) => onSeek(Number(event.target.value))}
            style={{ '--range-fill': `${progress}%` } as React.CSSProperties}
            type="range"
            value={Math.min(currentTime, duration || 0)}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="player-volume">
        <button className="icon-button lyrics-trigger" onClick={onOpenLyrics} aria-label="查看歌词" type="button">
          <ListMusic size={19} />
        </button>
        <button className="icon-button" onClick={onToggleMute} aria-label={volume === 0 ? '取消静音' : '静音'} type="button">
          <VolumeIcon size={18} />
        </button>
        <input
          aria-label="音量"
          className="range volume-range"
          max="1"
          min="0"
          onChange={(event) => onVolume(Number(event.target.value))}
          step="0.01"
          style={{ '--range-fill': `${volume * 100}%` } as React.CSSProperties}
          type="range"
          value={volume}
        />
      </div>
    </footer>
  )
}

function App() {
  const initialGroup = catalogGroups[0]
  const [selectedGroup, setSelectedGroup] = useState(initialGroup)
  const [currentTrack, setCurrentTrack] = useState(initialGroup.tracks[0])
  const [query, setQuery] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.82)
  const [previousVolume, setPreviousVolume] = useState(0.82)
  const [shuffle, setShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off')
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [lyricStatus, setLyricStatus] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')
  const [audioMissing, setAudioMissing] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const shouldAutoplayRef = useRef(false)

  const visibleTracks = useMemo(() => {
    const normalized = normalizeSearch(query)
    if (!normalized) return selectedGroup.tracks
    return allTracks.filter((track) =>
      normalizeSearch(`${track.displayTitle}${track.groupName}${track.year ?? ''}`).includes(normalized),
    )
  }, [query, selectedGroup])

  const activeLyricIndex = useMemo(
    () => findActiveLyric(lyrics, currentTime),
    [lyrics, currentTime],
  )

  useEffect(() => {
    document.title = `留声-${currentTrack.displayTitle}`

    return () => {
      document.title = defaultDocumentTitle
    }
  }, [currentTrack.displayTitle])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    setCurrentTime(0)
    setDuration(0)
    setAudioMissing(false)
    setLyrics([])
    setLyricStatus('loading')

    audio.src = assetUrl('songs', currentTrack.fileName, 'mp3')
    audio.load()
    if (shouldAutoplayRef.current) {
      void audio.play().catch(() => {
        setIsPlaying(false)
      })
    }

    const controller = new AbortController()
    fetch(assetUrl('lyrics', currentTrack.fileName, 'lrc'), { signal: controller.signal })
      .then(async (response) => {
        const contentType = response.headers.get('content-type') ?? ''
        if (!response.ok || contentType.includes('text/html')) throw new Error('missing lyric')
        const text = await response.text()
        const parsed = parseLrc(text)
        if (!parsed.length) throw new Error('empty lyric')
        setLyrics(parsed)
        setLyricStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLyricStatus('missing')
      })

    return () => controller.abort()
  }, [currentTrack])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const selectTrack = useCallback((track: Track, autoplay = true) => {
    if (track.id === currentTrack.id) {
      if (autoplay) {
        const audio = audioRef.current
        if (audio?.paused) void audio.play().catch(() => setAudioMissing(true))
        else audio?.pause()
      }
      return
    }
    shouldAutoplayRef.current = autoplay
    setCurrentTrack(track)
  }, [currentTrack.id])

  const queue = visibleTracks.length ? visibleTracks : selectedGroup.tracks

  const playNext = useCallback((forceWrap = false) => {
    if (!queue.length) return
    if (shuffle && queue.length > 1) {
      const choices = queue.filter((track) => track.id !== currentTrack.id)
      selectTrack(choices[Math.floor(Math.random() * choices.length)])
      return
    }
    const currentIndex = queue.findIndex((track) => track.id === currentTrack.id)
    const nextIndex = currentIndex + 1
    if (nextIndex < queue.length) selectTrack(queue[nextIndex])
    else if (forceWrap || repeatMode === 'all') selectTrack(queue[0])
    else setIsPlaying(false)
  }, [currentTrack.id, queue, repeatMode, selectTrack, shuffle])

  const playPrevious = useCallback(() => {
    const audio = audioRef.current
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const currentIndex = queue.findIndex((track) => track.id === currentTrack.id)
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1
    if (queue[previousIndex]) selectTrack(queue[previousIndex])
  }, [currentTrack.id, queue, selectTrack])

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => {
        setAudioMissing(true)
        setNotice(`找不到 songs/${currentTrack.fileName}.mp3`)
      })
    } else {
      audio.pause()
    }
  }, [currentTrack.fileName])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
      if (event.code === 'Space') {
        event.preventDefault()
        togglePlayback()
      } else if (event.code === 'ArrowRight' && audioRef.current) {
        audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5)
      } else if (event.code === 'ArrowLeft' && audioRef.current) {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePlayback])

  const handleEnded = () => {
    const audio = audioRef.current
    if (repeatMode === 'one' && audio) {
      audio.currentTime = 0
      void audio.play()
      return
    }
    playNext(false)
  }

  const seek = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time
    setCurrentTime(time)
  }

  const changeVolume = (nextVolume: number) => {
    if (audioRef.current) audioRef.current.volume = nextVolume
    setVolume(nextVolume)
    if (nextVolume > 0) setPreviousVolume(nextVolume)
  }

  const toggleMute = () => changeVolume(volume === 0 ? previousVolume || 0.82 : 0)

  const selectGroup = (group: CatalogGroup) => {
    setSelectedGroup(group)
    setQuery('')
  }

  const cycleRepeat = () => {
    setRepeatMode((mode) => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off')
  }

  return (
    <div className="app-shell">
      <Sidebar
        selectedGroupId={selectedGroup.id}
        onSelectGroup={selectGroup}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开分类菜单" type="button">
            <Menu size={21} />
          </button>
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索歌曲、专辑或年份"
              aria-label="搜索歌曲"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="清空搜索" type="button">
                <X size={16} />
              </button>
            )}
          </label>
          <div className="topbar-meta">
            <span>本地曲库</span>
            <i />
            <strong>{allTracks.length} 首</strong>
          </div>
        </header>

        <section className="collection-hero">
          <div className="hero-disc" aria-hidden="true">
            <div className="hero-disc-grooves" />
            <div className="hero-disc-label">
              <span>{selectedGroup.name.slice(0, 1)}</span>
              <small>VAE</small>
            </div>
          </div>
          <div className="hero-copy">
            <p className="section-kicker">{selectedGroup.section === 'albums' ? '专辑选集' : '单曲辑录'}</p>
            <h1>{query ? '搜索结果' : selectedGroup.name}</h1>
            <p className="hero-description">
              {query
                ? `找到 ${visibleTracks.length} 首与「${query}」相关的曲目。`
                : selectedGroup.date
                  ? `${selectedGroup.date} 发行 · 收录 ${selectedGroup.tracks.length} 首作品`
                  : `按目录归档 · 共 ${selectedGroup.tracks.length} 首作品`}
            </p>
          </div>
          <button
            className="hero-play"
            disabled={!visibleTracks.length}
            onClick={() => visibleTracks[0] && selectTrack(visibleTracks[0])}
            type="button"
          >
            <Play size={18} fill="currentColor" />
            播放本辑
          </button>
        </section>

        <section className="track-section" aria-labelledby="track-heading">
          <div className="track-heading-row">
            <div>
              <p className="section-kicker">曲目</p>
              <h2 id="track-heading">{query ? '全库检索' : '播放列表'}</h2>
            </div>
            <span>{visibleTracks.length} TRACKS</span>
          </div>

          <div className="track-table">
            <div className="track-table-head" aria-hidden="true">
              <span>#</span>
              <span>歌曲</span>
              <span>归档</span>
              <span>文件</span>
            </div>
            {visibleTracks.map((track, index) => {
              const active = currentTrack.id === track.id
              return (
                <button
                  className={`track-row ${active ? 'is-current' : ''}`}
                  key={track.id}
                  onClick={() => selectTrack(track)}
                  type="button"
                >
                  <span className="track-index">
                    <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="row-play">{active && isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</span>
                  </span>
                  <span className="track-title-cell">
                    <strong>{track.displayTitle}</strong>
                    <small>许嵩{track.note ? ` · ${track.note}` : ''}</small>
                  </span>
                  <span className="track-archive">{query ? track.groupName : (track.year ?? '未标注')}</span>
                  <span className="track-file">{track.fileName}.mp3</span>
                </button>
              )
            })}
            {!visibleTracks.length && (
              <div className="empty-search">
                <Disc3 size={30} strokeWidth={1.3} />
                <strong>没有找到相关曲目</strong>
                <p>换一个歌名、专辑名或年份试试。</p>
              </div>
            )}
          </div>
        </section>
      </main>

      <LyricsPanel
        track={currentTrack}
        lyrics={lyrics}
        activeIndex={activeLyricIndex}
        status={lyricStatus}
        onSeek={seek}
        mobileOpen={lyricsOpen}
        onMobileClose={() => setLyricsOpen(false)}
      />

      <PlayerBar
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        repeatMode={repeatMode}
        shuffle={shuffle}
        audioMissing={audioMissing}
        onToggle={togglePlayback}
        onPrevious={playPrevious}
        onNext={() => playNext(true)}
        onSeek={seek}
        onVolume={changeVolume}
        onToggleMute={toggleMute}
        onCycleRepeat={cycleRepeat}
        onToggleShuffle={() => setShuffle((value) => !value)}
        lyricsOpen={lyricsOpen}
        onToggleLyrics={() => setLyricsOpen((value) => !value)}
        onOpenLyrics={() => setLyricsOpen(true)}
      />

      <audio
        ref={audioRef}
        preload="metadata"
        onCanPlay={() => setAudioMissing(false)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={handleEnded}
        onError={() => {
          setAudioMissing(true)
          setIsPlaying(false)
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onVolumeChange={(event) => setVolume(event.currentTarget.volume)}
      />

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

export default App
