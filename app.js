/* Sguessr - sito statico puro (niente npm) */
;(() => {
  'use strict'

  const SONGS = window.SONGS || []
  const DURATION_STEPS = [2, 5, 10, 15, 20, 30]
  const POINTS_BY_STEP = [6, 5, 4, 3, 2, 1]
  /** Chiavi localStorage (sync, sopravvivono a refresh e chiusura PWA) */
  const INTRO_KEY = 'songguesser_intro_seen'
  const PLAYED_KEY = 'songguesser_played_v3'
  const PLAYED_KEY_LEGACY = 'songguesser_played_ids'
  const PLAYED_KEY_LEGACY2 = 'songguesser_played_v2'
  const SESSION_KEY = 'songguesser_session_v1'
  /** Limite solo per ricerche generiche sul titolo; per artista si mostrano tutti i match */
  const SUGGEST_LIMIT_DEFAULT = 12

  // ---------- helpers canzoni ----------
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[''`´]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function displayName(song) {
    return song.title + ' - ' + song.artist
  }

  /** Token artista (nomi singoli, senza feat/&/,) per match tipo "guetta" → David Guetta */
  function artistNameTokens(artist) {
    return normalize(artist)
      .split(/\b(?:feat|ft|featuring|with|vs|x)\b/g)
      .join(' ')
      .split(/[&,;/]+/)
      .join(' ')
      .split(/\s+/)
      .filter((t) => t && t.length > 1)
  }

  function isCorrectGuess(guess, song) {
    const g = normalize(guess)
    if (!g) return false
    const title = normalize(song.title)
    const artist = normalize(song.artist)
    const full = normalize(song.title + ' ' + song.artist)
    const disp = normalize(displayName(song))
    if (g === title || g === full || g === disp) return true
    if (g.startsWith(title) && artist) {
      const first = artist.split(/\s+/)[0] || ''
      if (first && g.includes(first)) return true
    }
    return false
  }

  /**
   * Autocomplete: match su titolo E artista (anche pezzi di nome).
   * Cercando un artista compaiono TUTTE le sue canzoni del catalogo (scrollabili).
   */
  function filterSongs(query, limit) {
    const q = normalize(query)
    if (!q || q.length < 1) return []
    const qWords = q.split(/\s+/).filter(Boolean)

    const scored = []
    for (let i = 0; i < SONGS.length; i++) {
      const song = SONGS[i]
      const title = normalize(song.title)
      const artist = normalize(song.artist)
      const full = title + ' ' + artist
      const disp = normalize(displayName(song))
      const tokens = artistNameTokens(song.artist)
      let score = 0
      let artistHit = false

      if (title === q || full === q || disp === q) {
        score = 200
      } else if (title.startsWith(q)) {
        score = 100
      } else if (artist === q || artist.startsWith(q + ' ') || artist.startsWith(q)) {
        score = 96
        artistHit = true
      } else if (q.length >= 2 && tokens.some((t) => t === q || t.startsWith(q))) {
        // "sfera", "guetta", "bruno"…
        score = 94
        artistHit = true
      } else if (q.length >= 3 && artist.includes(q)) {
        score = 90
        artistHit = true
      } else if (title.includes(q)) {
        score = 70
      } else if (full.startsWith(q)) {
        score = 65
      } else if (qWords.length > 1 && qWords.every((w) => full.includes(w))) {
        score = 60
      } else if (full.includes(q)) {
        score = 40
      }

      if (score > 0) scored.push({ song, score, artistHit, title })
    }

    if (!scored.length) return []

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.title < b.title) return -1
      if (a.title > b.title) return 1
      return 0
    })

    // Match forti sull'artista: mostra TUTTE le canzoni (niente taglio)
    const strongArtist = scored.filter((x) => x.artistHit && x.score >= 90)
    if (limit == null && q.length >= 2 && strongArtist.length >= 1) {
      // Solo i brani dove l'artista matcha, ordinati per titolo
      strongArtist.sort((a, b) => {
        if (a.title < b.title) return -1
        if (a.title > b.title) return 1
        return 0
      })
      return strongArtist.map((x) => x.song)
    }

    const cap = limit == null ? SUGGEST_LIMIT_DEFAULT : limit
    return scored.slice(0, cap).map((x) => x.song)
  }

  function shuffle(arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    return a
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function hasSeenIntro() {
    try {
      return localStorage.getItem(INTRO_KEY) === '1'
    } catch (_) {
      return false
    }
  }

  function markIntroSeen() {
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch (_) {}
  }

  // ---------- storage helpers (sync, come l'intro che già funziona) ----------
  function lsGetRaw(key) {
    try {
      return localStorage.getItem(key)
    } catch (_) {
      return null
    }
  }

  function lsSetRaw(key, value) {
    try {
      localStorage.setItem(key, value)
      return true
    } catch (_) {
      return false
    }
  }

  function lsGetJSON(key, fallback) {
    const raw = lsGetRaw(key)
    if (raw == null || raw === '') return fallback
    try {
      return JSON.parse(raw)
    } catch (_) {
      return fallback
    }
  }

  function lsSetJSON(key, value) {
    try {
      return lsSetRaw(key, JSON.stringify(value))
    } catch (_) {
      return false
    }
  }

  function uniqueStrings(arr) {
    const seen = new Set()
    const out = []
    for (let i = 0; i < (arr || []).length; i++) {
      const v = String(arr[i] == null ? '' : arr[i])
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  }

  /** Chiave stabile brano (titolo base + artista) */
  function songStableKey(song) {
    if (!song) return ''
    let title = String(song.title || '')
    title = title.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    const dashParts = title.split(/\s*[-–—]\s*/)
    if (dashParts.length > 1) {
      const right = dashParts.slice(1).join(' ')
      if (
        /(radio|edit|remix|version|live|mix|remaster|extended|acoustic|instrumental|ao vivo|studio|from |explicit|clean|bonus)/i.test(
          right,
        )
      ) {
        title = dashParts[0]
      }
    }
    const t = normalize(title)
    const artist = String(song.artist || '')
      .split(/[;&]/)[0]
      .split(/\s*(?:,| feat\.? | ft\.? | featuring | with | x | vs\.? )\s*/i)[0]
    const a = normalize(artist).split(/\s+/).slice(0, 2).join(' ')
    if (!t) return ''
    return t + '|' + a
  }

  // ---------- brani già fatti (catalogo) ----------
  /** @type {{ ids: string[], keys: string[] }} */
  let playedMem = { ids: [], keys: [] }

  function readPlayedFromDisk() {
    const keysToTry = [PLAYED_KEY, PLAYED_KEY_LEGACY2, PLAYED_KEY_LEGACY]
    for (let i = 0; i < keysToTry.length; i++) {
      const raw = lsGetJSON(keysToTry[i], null)
      if (raw == null) continue
      if (Array.isArray(raw)) {
        return { ids: uniqueStrings(raw), keys: [] }
      }
      if (typeof raw === 'object') {
        return {
          ids: uniqueStrings([].concat(raw.ids || [])),
          keys: uniqueStrings([].concat(raw.keys || [])),
        }
      }
    }
    return { ids: [], keys: [] }
  }

  function writePlayedToDisk(data) {
    const payload = {
      v: 3,
      ids: uniqueStrings(data.ids),
      keys: uniqueStrings(data.keys),
      count: 0,
      updatedAt: Date.now(),
    }
    payload.count = payload.ids.length
    // Scrivi su più chiavi: se una fallisce le altre restano
    lsSetJSON(PLAYED_KEY, payload)
    lsSetJSON(PLAYED_KEY_LEGACY, payload.ids)
    lsSetJSON(PLAYED_KEY_LEGACY2, payload)
    return payload
  }

  function initPlayedStore() {
    playedMem = readPlayedFromDisk()
    // Arricchisci keys dagli id presenti nel catalogo
    const byId = new Map()
    for (let i = 0; i < SONGS.length; i++) {
      byId.set(String(SONGS[i].id), SONGS[i])
    }
    for (let i = 0; i < playedMem.ids.length; i++) {
      const song = byId.get(String(playedMem.ids[i]))
      if (!song) continue
      const k = songStableKey(song)
      if (k && playedMem.keys.indexOf(k) === -1) playedMem.keys.push(k)
    }
    writePlayedToDisk(playedMem)
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(function () {})
      }
    } catch (_) {}
    return playedMem
  }

  function getPlayedCount() {
    const idSet = new Set(playedMem.ids.map(String))
    const keySet = new Set(playedMem.keys)
    let n = 0
    for (let i = 0; i < SONGS.length; i++) {
      const s = SONGS[i]
      if (idSet.has(String(s.id)) || keySet.has(songStableKey(s))) n++
    }
    return n
  }

  function isSongPlayed(song) {
    if (!song) return false
    if (song.id != null && playedMem.ids.indexOf(String(song.id)) !== -1) return true
    const k = songStableKey(song)
    return !!(k && playedMem.keys.indexOf(k) !== -1)
  }

  /** @param {object|string} songOrId */
  function markSongPlayed(songOrId) {
    if (songOrId == null || songOrId === '') return false

    let song = null
    let id = ''
    if (typeof songOrId === 'object') {
      song = songOrId
      id = song.id != null ? String(song.id) : ''
    } else {
      id = String(songOrId)
      for (let i = 0; i < SONGS.length; i++) {
        if (String(SONGS[i].id) === id) {
          song = SONGS[i]
          break
        }
      }
    }

    const key = song ? songStableKey(song) : ''
    let changed = false
    if (id && playedMem.ids.indexOf(id) === -1) {
      playedMem.ids.push(id)
      changed = true
    }
    if (key && playedMem.keys.indexOf(key) === -1) {
      playedMem.keys.push(key)
      changed = true
    }
    if (changed) writePlayedToDisk(playedMem)
    return changed
  }

  function clearPlayedIds() {
    playedMem = { ids: [], keys: [] }
    try {
      localStorage.removeItem(PLAYED_KEY)
      localStorage.removeItem(PLAYED_KEY_LEGACY)
      localStorage.removeItem(PLAYED_KEY_LEGACY2)
    } catch (_) {}
  }

  function getUnplayedSongs() {
    return SONGS.filter(function (s) {
      return s && s.id != null && !isSongPlayed(s)
    })
  }

  function buildFreshPlaylist() {
    let available = getUnplayedSongs()
    if (!available.length) {
      clearPlayedIds()
      available = SONGS.slice()
    }
    return shuffle(available)
  }

  function catalogProgressLabel() {
    const total = SONGS.length
    const played = getPlayedCount()
    const left = Math.max(0, total - played)
    if (!total) return ''
    if (played <= 0) return total + ' brani nel catalogo'
    if (left <= 0) return 'Catalogo completato — prossima partita da capo'
    return played + ' fatte · ' + left + ' rimaste'
  }

  // ---------- sessione partita (playlist + punteggio + round) ----------
  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch (_) {}
  }

  function saveSession(state) {
    if (!state) return false
    if (state.phase !== 'play' && state.phase !== 'results') return false
    const playlist = state.playlist || []
    const payload = {
      v: 1,
      phase: state.phase,
      finished: !!state.finished,
      playlistIds: playlist.map(function (s) {
        return s && s.id != null ? String(s.id) : ''
      }).filter(Boolean),
      index: state.index | 0,
      stepIndex: state.stepIndex | 0,
      score: state.score | 0,
      revealed: !!state.revealed,
      revealKind: state.revealKind || null,
      lastGuessWrong: !!state.lastGuessWrong,
      rounds: (state.rounds || [])
        .map(function (r) {
          if (!r || !r.song || r.song.id == null) return null
          return {
            songId: String(r.song.id),
            result: r.result,
            stepIndex: r.stepIndex | 0,
            points: r.points | 0,
          }
        })
        .filter(Boolean),
      updatedAt: Date.now(),
    }
    return lsSetJSON(SESSION_KEY, payload)
  }

  /** @returns {object|null} pezzi di state da ripristinare, o null */
  function loadSession() {
    const raw = lsGetJSON(SESSION_KEY, null)
    if (!raw || !raw.playlistIds || !raw.playlistIds.length) return null

    const byId = new Map()
    for (let i = 0; i < SONGS.length; i++) {
      byId.set(String(SONGS[i].id), SONGS[i])
    }

    const playlist = []
    for (let i = 0; i < raw.playlistIds.length; i++) {
      const s = byId.get(String(raw.playlistIds[i]))
      if (s) playlist.push(s)
    }
    if (!playlist.length) {
      clearSession()
      return null
    }

    const rounds = []
    const rr = raw.rounds || []
    for (let i = 0; i < rr.length; i++) {
      const r = rr[i]
      if (!r) continue
      const song = byId.get(String(r.songId))
      if (!song) continue
      rounds.push({
        song: song,
        result: r.result,
        stepIndex: r.stepIndex | 0,
        points: r.points | 0,
      })
    }

    if (raw.finished || raw.phase === 'results') {
      return {
        phase: 'results',
        finished: true,
        playlist: playlist,
        index: raw.index | 0,
        stepIndex: 0,
        score: raw.score | 0,
        rounds: rounds,
        revealed: false,
        revealKind: null,
        lastGuessWrong: false,
        preview: null,
        loading: false,
        error: null,
      }
    }

    let index = raw.index | 0
    if (index < 0) index = 0
    if (index >= playlist.length) index = playlist.length - 1

    return {
      phase: 'play',
      finished: false,
      playlist: playlist,
      index: index,
      stepIndex: Math.min(Math.max(0, raw.stepIndex | 0), DURATION_STEPS.length - 1),
      score: raw.score | 0,
      rounds: rounds,
      revealed: !!raw.revealed,
      revealKind: raw.revealKind || null,
      lastGuessWrong: !!raw.lastGuessWrong,
      preview: null,
      loading: true,
      error: null,
    }
  }

  // ---------- music API (JSONP) ----------
  const previewCache = new Map()

  function scoreMatch(trackName, artistName, wantTitle, wantArtist) {
    const t = normalize(trackName)
    const a = normalize(artistName)
    const wt = normalize(wantTitle)
    const wa = normalize(wantArtist).split(/[&,]/)[0].trim()
    let s = 0
    if (t === wt) s += 100
    else if (t.startsWith(wt)) s += 80
    else if (t.includes(wt)) s += 50
    else return -100
    if (wa && (a.includes(wa) || wa.includes(a.split(' ')[0] || ''))) s += 40
    else if (wa) s -= 20
    if (/cover band|karaoke|tribute|lullaby|ringtone|slowed|sped up/i.test(trackName + ' ' + artistName)) {
      s -= 80
    } else if (/remix|instrumental|mixed\)|radio edit/i.test(trackName)) {
      s -= 15
    }
    return s
  }

  function jsonp(url, callbackParam) {
    callbackParam = callbackParam || 'callback'
    return new Promise((resolve, reject) => {
      const cbName = '__sg_jsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      const script = document.createElement('script')
      let timer = null
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        try {
          delete window[cbName]
        } catch (_) {
          window[cbName] = undefined
        }
        script.remove()
      }
      window[cbName] = (data) => {
        cleanup()
        resolve(data)
      }
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('JSONP timeout'))
      }, 10000)
      const sep = url.includes('?') ? '&' : '?'
      script.src = url + sep + callbackParam + '=' + cbName
      script.onerror = () => {
        cleanup()
        reject(new Error('JSONP network error'))
      }
      document.head.appendChild(script)
    })
  }

  async function searchItunes(query, wantTitle, wantArtist) {
    for (const country of ['it', 'us']) {
      try {
        const url =
          'https://itunes.apple.com/search?term=' +
          encodeURIComponent(query) +
          '&media=music&entity=song&limit=10&country=' +
          country
        const data = await jsonp(url)
        const ranked = (data.results || [])
          .filter((r) => r.previewUrl)
          .map((r) => ({
            r,
            s: scoreMatch(r.trackName || '', r.artistName || '', wantTitle, wantArtist),
          }))
          .filter((x) => x.s >= 100)
          .sort((a, b) => b.s - a.s)
        const best = ranked[0] && ranked[0].r
        if (best && best.previewUrl) {
          return {
            previewUrl: best.previewUrl,
            artworkUrl:
              (best.artworkUrl100 || '')
                .replace('100x100bb', '300x300bb')
                .replace('100x100', '300x300') || null,
            trackName: best.trackName || '',
            artistName: best.artistName || '',
            source: 'itunes',
          }
        }
      } catch (_) {}
    }
    return null
  }

  async function searchDeezer(query, wantTitle, wantArtist) {
    try {
      const url =
        'https://api.deezer.com/search?q=' +
        encodeURIComponent(query) +
        '&limit=10&output=jsonp'
      const data = await jsonp(url)
      const ranked = (data.data || [])
        .filter((r) => r.preview)
        .map((r) => ({
          r,
          s: scoreMatch(r.title || '', (r.artist && r.artist.name) || '', wantTitle, wantArtist),
        }))
        .filter((x) => x.s >= 100)
        .sort((a, b) => b.s - a.s)
      const best = ranked[0] && ranked[0].r
      if (best && best.preview) {
        return {
          previewUrl: best.preview,
          artworkUrl: (best.album && best.album.cover_medium) || null,
          trackName: best.title || '',
          artistName: (best.artist && best.artist.name) || '',
          source: 'deezer',
        }
      }
    } catch (_) {}
    return null
  }

  async function fetchPreview(song) {
    const key = song.searchQuery
    if (previewCache.has(key)) return previewCache.get(key)

    if (song.previewUrl && String(song.previewUrl).includes('itunes.apple.com')) {
      const cached = {
        previewUrl: song.previewUrl,
        artworkUrl: song.artworkUrl || null,
        trackName: song.title,
        artistName: song.artist,
        source: 'cache',
      }
      previewCache.set(key, cached)
      return cached
    }

    const live =
      (await searchItunes(song.searchQuery, song.title, song.artist)) ||
      (await searchDeezer(song.searchQuery, song.title, song.artist)) ||
      null
    previewCache.set(key, live)
    return live
  }

  // ---------- audio player ----------
  class ProgressiveAudioPlayer {
    constructor() {
      this.audio = new Audio()
      this.audio.preload = 'auto'
      this.maxSeconds = 2
      this.stopTimer = null
      this.onEndCallback = null
      this.onTimeCallback = null
      this.rafId = null
      this.audio.addEventListener('ended', () => {
        this.clearTimers()
        if (this.onEndCallback) this.onEndCallback()
      })
    }

    load(url) {
      this.stop()
      this.audio.src = url
      this.audio.load()
      return new Promise((resolve, reject) => {
        const onReady = () => {
          cleanup()
          resolve()
        }
        const onError = () => {
          cleanup()
          reject(new Error("Impossibile caricare l'audio"))
        }
        const cleanup = () => {
          this.audio.removeEventListener('canplaythrough', onReady)
          this.audio.removeEventListener('error', onError)
        }
        this.audio.addEventListener('canplaythrough', onReady, { once: true })
        this.audio.addEventListener('error', onError, { once: true })
      })
    }

    setMaxSeconds(s) {
      this.maxSeconds = s
    }

    onEnded(cb) {
      this.onEndCallback = cb
    }

    onTimeUpdate(cb) {
      this.onTimeCallback = cb
    }

    async play() {
      this.clearTimers()
      this.audio.currentTime = 0
      try {
        await this.audio.play()
      } catch (_) {
        throw new Error('play-blocked')
      }
      this.tick()
      this.stopTimer = setTimeout(() => {
        this.pause()
        if (this.onEndCallback) this.onEndCallback()
      }, this.maxSeconds * 1000)
    }

    pause() {
      this.clearTimers()
      this.audio.pause()
    }

    stop() {
      this.pause()
      this.audio.currentTime = 0
      if (this.onTimeCallback) this.onTimeCallback(0)
    }

    isPlaying() {
      return !this.audio.paused && !this.audio.ended
    }

    tick = () => {
      if (this.audio.paused) return
      if (this.onTimeCallback) this.onTimeCallback(this.audio.currentTime)
      if (this.audio.currentTime >= this.maxSeconds) {
        this.pause()
        if (this.onEndCallback) this.onEndCallback()
        return
      }
      this.rafId = requestAnimationFrame(this.tick)
    }

    clearTimers() {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer)
        this.stopTimer = null
      }
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId)
        this.rafId = null
      }
    }
  }

  // ---------- game ----------
  class Game {
    constructor() {
      this.player = new ProgressiveAudioPlayer()
      this.listeners = []
      this.state = this.initialState()
    }

    initialState() {
      return {
        phase: 'boot', // boot | intro | play | results
        playlist: [],
        index: 0,
        stepIndex: 0,
        score: 0,
        rounds: [],
        preview: null,
        loading: false,
        error: null,
        finished: false,
        lastGuessWrong: false,
        revealed: false,
        /** 'skipped' | 'correct' | null */
        revealKind: null,
      }
    }

    subscribe(fn) {
      this.listeners.push(fn)
      fn(this.state)
      return () => {
        this.listeners = this.listeners.filter((l) => l !== fn)
      }
    }

    emit() {
      this.listeners.forEach((fn) => fn(this.state))
    }

    set(partial) {
      Object.assign(this.state, partial)
      this.emit()
      // Persisti partita a ogni cambio di stato rilevante
      if (this.state.phase === 'play' || this.state.phase === 'results') {
        saveSession(this.state)
      }
    }

    getState() {
      return this.state
    }

    currentSong() {
      return this.state.playlist[this.state.index] || null
    }

    currentDuration() {
      return DURATION_STEPS[this.state.stepIndex] || 30
    }

    canSkipMore() {
      return this.state.stepIndex < DURATION_STEPS.length - 1
    }

    totalSongs() {
      return this.state.playlist.length
    }

    showIntro() {
      this.set({ phase: 'intro' })
    }

    /**
     * @param {{ fresh?: boolean }} [opts]
     * fresh:true = nuova partita (ignora sessione salvata, tiene i brani già fatti)
     */
    async start(opts) {
      markIntroSeen()
      this.player.stop()
      const forceNew = !!(opts && opts.fresh)

      if (!forceNew) {
        const restored = loadSession()
        if (restored) {
          if (restored.phase === 'results') {
            this.state = Object.assign(this.initialState(), restored)
            this.emit()
            return
          }
          const keepStep = restored.stepIndex | 0
          const keepRevealed = !!restored.revealed
          const keepKind = restored.revealKind || null
          const keepWrong = !!restored.lastGuessWrong
          this.state = Object.assign(this.initialState(), restored)
          this.state.phase = 'play'
          this.state.loading = true
          this.state.revealed = false
          this.emit()
          saveSession(this.state)
          await this.loadCurrentRound()
          // loadCurrentRound azzera step/reveal: re-applica progresso sessione
          this.set({
            stepIndex: keepStep,
            revealed: keepRevealed,
            revealKind: keepKind,
            lastGuessWrong: keepWrong,
          })
          if (keepRevealed) {
            this.player.setMaxSeconds(30)
          } else {
            this.player.setMaxSeconds(DURATION_STEPS[keepStep] || 30)
          }
          return
        }
      }

      clearSession()
      const base = this.initialState()
      base.phase = 'play'
      base.playlist = buildFreshPlaylist()
      base.loading = true
      this.state = base
      this.emit()
      saveSession(this.state)
      await this.loadCurrentRound()
    }

    async loadCurrentRound() {
      const song = this.currentSong()
      if (!song) {
        this.set({ finished: true, phase: 'results', loading: false })
        return
      }
      this.set({
        loading: true,
        error: null,
        preview: null,
        stepIndex: 0,
        lastGuessWrong: false,
        revealed: false,
        revealKind: null,
        phase: 'play',
      })
      this.player.stop()
      try {
        const preview = await fetchPreview(song)
        if (!preview) {
          // Audio non disponibile: passa automaticamente al prossimo brano
          await this.advanceToNext()
          return
        }
        await this.player.load(preview.previewUrl)
        this.player.setMaxSeconds(DURATION_STEPS[0])
        this.set({ preview, loading: false, error: null })
      } catch (_) {
        // Errore caricamento audio: passa automaticamente al prossimo brano
        await this.advanceToNext()
      }
    }

    async playClip() {
      if (this.state.loading) return
      // In reveal: sempre i 30s interi; altrimenti solo i secondi sbloccati
      const max = this.state.revealed ? 30 : this.currentDuration()
      this.player.setMaxSeconds(max)
      await this.player.play()
    }

    /** Riproduce il preview completo (~30s) da capo */
    async playFullPreview() {
      this.player.stop()
      this.player.setMaxSeconds(30)
      try {
        await this.player.play()
      } catch (_) {
        // autoplay bloccato: l'utente puo' premere play
      }
    }

    pause() {
      this.player.pause()
    }

    async skip() {
      if (!this.canSkipMore() || this.state.revealed) return
      this.player.stop()
      const next = this.state.stepIndex + 1
      this.set({ stepIndex: next, lastGuessWrong: false })
      this.player.setMaxSeconds(DURATION_STEPS[next])
      try {
        await this.player.play()
      } catch (_) {}
    }

    /**
     * @returns {'wrong'|'correct'|false}
     */
    guess(text) {
      const song = this.currentSong()
      if (!song || this.state.revealed) return false
      if (isCorrectGuess(text, song)) {
        this.player.stop()
        const points = POINTS_BY_STEP[this.state.stepIndex] || 1
        this.state.rounds.push({
          song,
          result: 'correct',
          stepIndex: this.state.stepIndex,
          points,
        })
        this.state.score += points
        markSongPlayed(song)
        // Salva subito (prima del reveal) così un refresh non perde punti/brano
        saveSession(this.state)
        writePlayedToDisk(playedMem)
        return 'correct'
      }
      this.set({ lastGuessWrong: true })
      return 'wrong'
    }

    /**
     * Dopo risposta giusta: mostra soluzione e ascolta i 30s interi.
     * Next (di nuovo) = brano successivo.
     */
    async revealAfterCorrect() {
      this.set({
        revealed: true,
        lastGuessWrong: false,
        revealKind: 'correct',
      })
      // Lascia al browser un frame per montare la UI di reveal
      await new Promise((r) => requestAnimationFrame(() => r()))
      await this.playFullPreview()
    }

    /**
     * Primo tap su Next: rivela la soluzione + ascolta i 30s.
     * Secondo tap (gia revealed): passa al brano successivo (anche a meta ascolto).
     */
    async next() {
      const song = this.currentSong()
      if (!song) return

      // Sempre memorizza il brano come "fatto" (anche se l'audio non c'era)
      markSongPlayed(song)
      writePlayedToDisk(playedMem)

      if (this.state.revealed) {
        await this.advanceToNext()
        return
      }

      this.player.stop()
      // Evita di duplicare la round se già registrata (es. correct → reveal → next)
      const alreadyLogged = this.state.rounds.some(
        (r) => r && r.song && String(r.song.id) === String(song.id),
      )
      if (!alreadyLogged) {
        this.state.rounds.push({
          song,
          result: 'skipped',
          stepIndex: this.state.stepIndex,
          points: 0,
        })
      }
      this.set({
        revealed: true,
        lastGuessWrong: false,
        revealKind: alreadyLogged ? this.state.revealKind || 'skipped' : 'skipped',
      })
      saveSession(this.state)
      await new Promise((r) => requestAnimationFrame(() => r()))
      // Se non c'è preview (errore audio), vai diretto al brano successivo
      if (!this.state.preview) {
        await this.advanceToNext()
        return
      }
      await this.playFullPreview()
    }

    async advanceToNext() {
      this.player.stop()
      const cur = this.currentSong()
      if (cur) markSongPlayed(cur)
      const nextIndex = this.state.index + 1
      if (nextIndex >= this.state.playlist.length) {
        this.set({
          finished: true,
          phase: 'results',
          index: nextIndex,
          revealed: false,
          revealKind: null,
        })
        // Sessione conclusa: la prossima apertura riparte dai non-giocati
        clearSession()
        return
      }
      this.set({ index: nextIndex, revealed: false, revealKind: null, stepIndex: 0 })
      await this.loadCurrentRound()
    }
  }

  // ---------- UI icons (SVG inline) ----------
  const ICO = {
    // Stella punti (al posto della coppa)
    star:
      '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.72 5.52 6.1.89-4.41 4.3 1.04 6.06L12 16.5l-5.45 2.87 1.04-6.06-4.41-4.3 6.1-.89L12 2.6z"/></svg>',
    check:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
    play:
      '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5z"/></svg>',
    pause:
      '<svg class="ico ico-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7V5zm6.5 0H17v14h-3.5V5z"/></svg>',
    seek:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l8 6-8 6V6z"/><path d="M13 6l8 6-8 6V6z"/></svg>',
    nextTrack:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l9 6-9 6V6z"/><path d="M18 6v12"/></svg>',
    note:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.5"/><circle cx="17" cy="16" r="2.5"/></svg>',
    refresh:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.4L3 16"/><path d="M3 21v-5h5"/></svg>',
    nextMini:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l9 6-9 6V6z"/><path d="M18 6v12"/></svg>',
    download:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    upload:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    disk:
      '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  }

  // ---------- UI ----------
  const app = document.getElementById('app')
  const game = new Game()
  let selectedSuggestion = null
  let playProgress = 0
  let draftGuess = ''
  let outsideClickHandler = null

  function nextIncrement(step) {
    const cur = DURATION_STEPS[step] || 30
    const next = DURATION_STEPS[step + 1] || 30
    return next - cur
  }

  /** Dialog di conferma integrata (no window.confirm) */
  function showConfirm(opts) {
    return new Promise((resolve) => {
      const root = document.createElement('div')
      root.className = 'modal-root'
      root.setAttribute('role', 'dialog')
      root.setAttribute('aria-modal', 'true')
      root.innerHTML =
        '<div class="modal-backdrop" data-act="cancel"></div>' +
        '<div class="modal-card">' +
        '<div class="modal-icon">' +
        (opts.icon || ICO.refresh) +
        '</div>' +
        '<h2>' +
        escapeHtml(opts.title || 'Conferma') +
        '</h2>' +
        '<p>' +
        escapeHtml(opts.message || '') +
        '</p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel">' +
        escapeHtml(opts.cancelLabel || 'Annulla') +
        '</button>' +
        '<button type="button" class="btn btn-primary" data-act="ok">' +
        escapeHtml(opts.okLabel || 'Conferma') +
        '</button>' +
        '</div>' +
        '</div>'

      const close = (val) => {
        document.removeEventListener('keydown', onKey)
        root.remove()
        resolve(val)
      }

      const onKey = (e) => {
        if (e.key === 'Escape') close(false)
        if (e.key === 'Enter') close(true)
      }

      root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]')
        if (!act) return
        close(act.getAttribute('data-act') === 'ok')
      })

      document.addEventListener('keydown', onKey)
      document.body.appendChild(root)
      const okBtn = root.querySelector('[data-act="ok"]')
      if (okBtn) okBtn.focus()
    })
  }

  async function confirmRestart() {
    const ok = await showConfirm({
      title: 'Nuova partita?',
      message:
        'Il punteggio di questa sessione verr\u00e0 azzerato. I brani gi\u00e0 fatti restano memorizzati e non si ripeteranno.',
      okLabel: 'Ricomincia',
      cancelLabel: 'Annulla',
      icon: ICO.refresh,
    })
    if (!ok) return
    draftGuess = ''
    selectedSuggestion = null
    playProgress = 0
    clearSession()
    await game.start({ fresh: true })
  }

  function showDataModal() {
    return new Promise((resolve) => {
      const playedCount = getPlayedCount()
      const totalCatalog = SONGS.length
      const state = game.getState()

      let sessionInfo = 'Nessuna partita attiva'
      if (state.phase === 'play') {
        const roundNum = state.index + 1
        const totalRounds = game.totalSongs()
        sessionInfo = 'Partita in corso: Round ' + roundNum + '/' + totalRounds + ' · ' + state.score + ' pt'
      } else if (state.phase === 'results') {
        sessionInfo = 'Partita completata · Punteggio: ' + state.score + ' pt'
      }

      const root = document.createElement('div')
      root.className = 'modal-root'
      root.setAttribute('role', 'dialog')
      root.setAttribute('aria-modal', 'true')

      root.innerHTML =
        '<div class="modal-backdrop" data-act="cancel"></div>' +
        '<div class="modal-card modal-card-data">' +
        '<div class="modal-icon">' +
        ICO.disk +
        '</div>' +
        '<h2>Salvataggi e Dati</h2>' +
        '<p>Esporta i tuoi progressi o importa una partita salvata per riprenderla.</p>' +
        '<div class="data-info-box">' +
        '<div class="data-info-row"><span>Brani fatti nel catalogo</span><strong>' +
        playedCount +
        ' / ' +
        totalCatalog +
        '</strong></div>' +
        '<div class="data-info-row"><span>Stato sessione</span><strong>' +
        escapeHtml(sessionInfo) +
        '</strong></div>' +
        '</div>' +
        '<div class="modal-data-actions">' +
        '<button type="button" class="btn btn-secondary btn-data-act" id="export-btn">' +
        ICO.download +
        '<span>Esporta Salvataggio (.json)</span>' +
        '</button>' +
        '<button type="button" class="btn btn-primary btn-data-act" id="import-btn">' +
        ICO.upload +
        '<span>Importa Salvataggio (.json)</span>' +
        '</button>' +
        '<input type="file" id="import-file-input" accept=".json,application/json" style="display:none" />' +
        '</div>' +
        '<p id="data-status-msg" class="data-status-msg" hidden></p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="cancel">Chiudi</button>' +
        '</div>' +
        '</div>'

      const statusMsg = root.querySelector('#data-status-msg')
      const importInput = root.querySelector('#import-file-input')
      const exportBtn = root.querySelector('#export-btn')
      const importBtn = root.querySelector('#import-btn')

      const close = () => {
        document.removeEventListener('keydown', onKey)
        root.remove()
        resolve()
      }

      const onKey = (e) => {
        if (e.key === 'Escape') close()
      }

      root.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act="cancel"]')
        if (act) close()
      })

      exportBtn.addEventListener('click', () => {
        try {
          const played = readPlayedFromDisk()
          const session = lsGetJSON(SESSION_KEY, null)
          const payload = {
            appName: 'Sguessr',
            version: 3,
            exportedAt: new Date().toISOString(),
            played: played,
            session: session,
            introSeen: hasSeenIntro(),
          }
          const str = JSON.stringify(payload, null, 2)
          const blob = new Blob([str], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          const d = new Date().toISOString().slice(0, 10)
          a.href = url
          a.download = 'sguessr-salvataggio-' + d + '.json'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)

          if (statusMsg) {
            statusMsg.hidden = false
            statusMsg.className = 'data-status-msg success'
            statusMsg.textContent = 'Salvataggio scaricato con successo!'
          }
        } catch (_) {
          if (statusMsg) {
            statusMsg.hidden = false
            statusMsg.className = 'data-status-msg error'
            statusMsg.textContent = 'Errore durante l\'esportazione del file.'
          }
        }
      })

      importBtn.addEventListener('click', () => {
        if (importInput) importInput.click()
      })

      if (importInput) {
        importInput.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0]
          if (!file) return
          if (statusMsg) {
            statusMsg.hidden = false
            statusMsg.className = 'data-status-msg info'
            statusMsg.textContent = 'Caricamento salvataggio...'
          }
          try {
            const text = await file.text()
            let data = null
            try {
              data = JSON.parse(text)
            } catch (_) {
              throw new Error('Il file selezionato non è un JSON valido.')
            }

            if (!data || typeof data !== 'object') {
              throw new Error('Contenuto del file non valido.')
            }

            let playedData = null
            if (data.played && (Array.isArray(data.played.ids) || Array.isArray(data.played.keys))) {
              playedData = data.played
            } else if (Array.isArray(data.ids)) {
              playedData = { ids: data.ids, keys: data.keys || [] }
            } else if (data.songguesser_played_v3) {
              playedData = data.songguesser_played_v3
            }

            let sessionData = data.session || data.songguesser_session_v1 || null

            if (!playedData && !sessionData) {
              throw new Error('Il file non contiene un salvataggio Sguessr valido.')
            }

            if (playedData) {
              playedMem = {
                ids: uniqueStrings([].concat(playedData.ids || [])),
                keys: uniqueStrings([].concat(playedData.keys || [])),
              }
              writePlayedToDisk(playedMem)
            }

            if (sessionData) {
              lsSetJSON(SESSION_KEY, sessionData)
            }

            if (data.introSeen) {
              markIntroSeen()
            }

            initPlayedStore()
            game.player.stop()

            if (statusMsg) {
              statusMsg.className = 'data-status-msg success'
              statusMsg.textContent = 'Partita importata! Ripristino in corso...'
            }

            setTimeout(async () => {
              close()
              await game.start()
            }, 600)
          } catch (err) {
            if (statusMsg) {
              statusMsg.hidden = false
              statusMsg.className = 'data-status-msg error'
              statusMsg.textContent = err.message || 'Errore durante l\'importazione.'
            }
          }
        })
      }

      document.addEventListener('keydown', onKey)
      document.body.appendChild(root)
    })
  }

  const LOGO_HTML =
    '<div class="logo-mark"><img src="pwa-192.png" alt="Sguessr" width="96" height="96" decoding="async" /></div>'

  function renderLoading(msg) {
    const screen = document.createElement('div')
    screen.className = 'screen home'
    screen.innerHTML =
      '<div class="home-content">' +
      LOGO_HTML +
      '<p class="status">' +
      escapeHtml(msg || 'Caricamento...') +
      '</p>' +
      '</div>'
    return screen
  }

  function setPlayIcon(el, playing) {
    if (!el) return
    el.innerHTML = playing ? ICO.pause : ICO.play
  }

  function render() {
    const state = game.getState()
    const existingInput = document.querySelector('#guess-input')
    if (existingInput) draftGuess = existingInput.value

    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler)
      outsideClickHandler = null
    }

    app.innerHTML = ''

    if (state.phase === 'boot') {
      app.appendChild(renderLoading('Caricamento...'))
      return
    }

    if (state.phase === 'intro') {
      app.appendChild(renderHome())
      return
    }

    if (state.phase === 'results' || state.finished) {
      draftGuess = ''
      selectedSuggestion = null
      app.appendChild(renderResults(state))
      return
    }

    if (state.phase === 'play') {
      app.appendChild(renderPlay(state))
      return
    }

    app.appendChild(renderHome())
  }

  function renderHome() {
    const remaining = getUnplayedSongs().length
    const played = getPlayedCount()
    const hint = catalogProgressLabel() || 'Pronto a mettere alla prova le tue orecchie?'
    const screen = document.createElement('div')
    screen.className = 'screen home'
    screen.innerHTML =
      '<header class="topbar topbar-home">' +
      '<div style="flex:1"></div>' +
      '<div class="topbar-right">' +
      '<button type="button" class="round-pill-btn" id="data-manage-btn" title="Esporta o importa salvataggio partita">' +
      (played > 0
        ? '<div class="round-pill catalog-pill" title="Brani gi\u00e0 fatti (salvati sul dispositivo)">' +
          played +
          ' fatte</div>'
        : '<div class="round-pill catalog-pill" title="Catalogo canzoni">' +
          SONGS.length +
          ' brani</div>') +
      '</button>' +
      '</div>' +
      '</header>' +
      '<div class="home-content">' +
      LOGO_HTML +
      '<h1 class="brand-title">Sguessr</h1>' +
      '<p class="tagline">Ascolta un pezzo sempre pi\u00f9 lungo. Indovina il brano prima di tutti.</p>' +
      '<ul class="rules">' +
      '<li><span>1</span> Parti da soli <strong>2 secondi</strong></li>' +
      '<li><span>2</span> Sblocca pi\u00f9 audio e alza la posta</li>' +
      '<li><span>3</span> Indovina il titolo e fai punti</li>' +
      '</ul>' +
      '<button class="btn btn-primary btn-lg" id="start-btn">Gioca ora</button>' +
      '<p class="hint">' +
      escapeHtml(hint) +
      '</p>' +
      (played > 0 && remaining > 0
        ? '<p class="hint hint-sub">I brani gi\u00e0 fatti non si ripetono, anche dopo aver chiuso l\u2019app.</p>'
        : '') +
      '</div>'

    screen.querySelector('#start-btn').addEventListener('click', async () => {
      const btn = screen.querySelector('#start-btn')
      btn.disabled = true
      btn.textContent = 'Ci siamo...'
      await game.start()
    })

    const dataBtn = screen.querySelector('#data-manage-btn')
    if (dataBtn) {
      dataBtn.addEventListener('click', () => {
        showDataModal()
      })
    }
    return screen
  }

  function renderPlay(state) {
    const screen = document.createElement('div')
    screen.className = 'screen play'
    const song = game.currentSong()
    const revealed = state.revealed
    const duration = revealed ? 30 : game.currentDuration()
    const step = state.stepIndex
    const total = game.totalSongs()
    const round = state.index + 1

    const stepsHtml = DURATION_STEPS.map((s, i) => {
      let cls = 'step locked'
      if (revealed || i < step) cls = 'step done'
      else if (i === step) cls = 'step current'
      return '<div class="' + cls + '" title="' + s + 's"><span>' + s + 's</span></div>'
    }).join('')

    let statusHtml = ''
    if (state.loading) {
      statusHtml = '<p class="status">Caricamento brano...</p>'
    } else if (state.error) {
      statusHtml = '<p class="status error">' + escapeHtml(state.error) + '</p>'
    } else if (revealed && song) {
      const skipped = state.revealKind === 'skipped'
      statusHtml =
        '<div class="reveal">' +
        '<p class="reveal-label">' +
        (skipped ? 'Soluzione' : 'Indovinato') +
        '</p>' +
        '<p class="reveal-title">' +
        escapeHtml(song.title) +
        '</p>' +
        '<p class="reveal-artist">' +
        escapeHtml(song.artist) +
        '</p>' +
        '<p class="reveal-hint">Ascolta il pezzo · Next per continuare</p>' +
        '</div>'
    } else {
      statusHtml = '<p class="status">Ascolta e indovina!</p>'
    }

    const artHtml =
      state.preview && state.preview.artworkUrl
        ? '<img src="' +
          escapeHtml(state.preview.artworkUrl) +
          '" alt="" class="art' +
          (revealed ? '' : ' blur-art') +
          '" draggable="false" ondragstart="return false;" oncontextmenu="return false;" />'
        : '<div class="art placeholder">' + ICO.note + '</div>'

    const inc = nextIncrement(step)
    const playing = game.player.isPlaying()
    const catalogDone = getPlayedCount()

    screen.innerHTML =
      '<header class="topbar">' +
      '<button type="button" class="btn-score" id="score-btn" title="Ricomincia la partita">' +
      ICO.star +
      '<span class="score-num">' +
      state.score +
      '</span></button>' +
      '<div class="topbar-right">' +
      '<button type="button" class="round-pill-btn" id="data-manage-btn" title="Esporta o importa salvataggio partita">' +
      '<div class="round-pill" title="Round in questa partita">' +
      round +
      ' / ' +
      total +
      '</div>' +
      (catalogDone > 0
        ? '<div class="round-pill catalog-pill" title="Brani gi\u00e0 fatti (salvati sul dispositivo)">' +
          catalogDone +
          ' fatte</div>'
        : '') +
      '</button>' +
      '</div>' +
      '</header>' +
      '<div class="stage">' +
      '<div class="vinyl' +
      (playing ? ' spinning' : '') +
      '" id="vinyl"><div class="vinyl-inner">' +
      artHtml +
      '</div></div>' +
      '<div class="timer-row">' +
      '<span id="time-cur">0.0</span>' +
      '<div class="progress-track">' +
      '<div class="progress-fill" id="progress-fill" style="width:0%"></div>' +
      '<div class="progress-cap" style="left:' +
      (duration / 30) * 100 +
      '%"></div>' +
      '</div>' +
      '<span>' +
      duration +
      '.0s</span>' +
      '</div>' +
      '<div class="steps">' +
      stepsHtml +
      '</div>' +
      statusHtml +
      (!revealed && state.lastGuessWrong
        ? '<p class="wrong-msg">Sbagliato! Riprova o sblocca pi\u00f9 secondi.</p>'
        : '') +
      '</div>' +
      '<div class="controls">' +
      '<button class="btn btn-play" id="play-btn" ' +
      (state.loading ? 'disabled' : '') +
      ' aria-label="Play"><span id="play-icon">' +
      (playing ? ICO.pause : ICO.play) +
      '</span></button>' +
      '<button class="btn btn-secondary btn-ctrl" id="skip-btn" ' +
      (state.loading || revealed || !game.canSkipMore() ? 'disabled' : '') +
      ' aria-label="Ascolta di piu" title="Ascolta +' +
      inc +
      's">' +
      ICO.seek +
      '<span class="ctrl-label">+' +
      inc +
      's</span></button>' +
      '<button class="btn ' +
      (revealed ? 'btn-primary' : 'btn-ghost') +
      ' btn-ctrl" id="next-btn" ' +
      (state.loading ? 'disabled' : '') +
      ' aria-label="' +
      (revealed ? 'Prossima canzone' : 'Mostra soluzione') +
      '" title="' +
      (revealed ? 'Prossima canzone' : 'Mostra soluzione e ascolta i 30s') +
      '">' +
      ICO.nextTrack +
      (revealed ? '<span class="ctrl-label">Next</span>' : '') +
      '</button>' +
      '</div>' +
      '<div class="guess-area' +
      (revealed ? ' hidden' : '') +
      '">' +
      '<div class="input-wrap">' +
      '<input type="text" id="guess-input" placeholder="Scrivi il titolo della canzone..." autocomplete="off" autocorrect="off" spellcheck="false" ' +
      (state.loading || revealed ? 'disabled' : '') +
      ' />' +
      '<ul class="suggestions" id="suggestions" hidden></ul>' +
      '</div>' +
      '<button class="btn btn-primary btn-icon" id="guess-btn" ' +
      (state.loading || revealed ? 'disabled' : '') +
      ' aria-label="Indovina" title="Indovina">' +
      ICO.check +
      '</button>' +
      '</div>'

    wirePlayScreen(screen, state)
    return screen
  }

  function wirePlayScreen(screen, state) {
    const playBtn = screen.querySelector('#play-btn')
    const skipBtn = screen.querySelector('#skip-btn')
    const nextBtn = screen.querySelector('#next-btn')
    const guessBtn = screen.querySelector('#guess-btn')
    const scoreBtn = screen.querySelector('#score-btn')
    const dataBtn = screen.querySelector('#data-manage-btn')
    const input = screen.querySelector('#guess-input')
    const suggestions = screen.querySelector('#suggestions')
    const vinyl = screen.querySelector('#vinyl')
    const progressFill = screen.querySelector('#progress-fill')
    const timeCur = screen.querySelector('#time-cur')

    if (scoreBtn) {
      scoreBtn.addEventListener('click', () => {
        confirmRestart()
      })
    }

    if (dataBtn) {
      dataBtn.addEventListener('click', () => {
        showDataModal()
      })
    }

    game.player.onTimeUpdate((t) => {
      playProgress = t
      if (progressFill) progressFill.style.width = Math.min(100, (t / 30) * 100) + '%'
      if (timeCur) timeCur.textContent = t.toFixed(1)
      if (vinyl) vinyl.classList.toggle('spinning', game.player.isPlaying())
      setPlayIcon(screen.querySelector('#play-icon'), game.player.isPlaying())
    })

    game.player.onEnded(() => {
      if (vinyl) vinyl.classList.remove('spinning')
      setPlayIcon(screen.querySelector('#play-icon'), false)
    })

    if (progressFill) {
      progressFill.style.width = Math.min(100, (playProgress / 30) * 100) + '%'
    }

    if (playBtn) {
      playBtn.addEventListener('click', async () => {
        if (game.player.isPlaying()) {
          game.pause()
          if (vinyl) vinyl.classList.remove('spinning')
          setPlayIcon(screen.querySelector('#play-icon'), false)
          return
        }
        try {
          await game.playClip()
          if (vinyl) vinyl.classList.add('spinning')
          setPlayIcon(screen.querySelector('#play-icon'), true)
        } catch (_) {}
      })
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', async () => {
        await game.skip()
        if (vinyl) vinyl.classList.add('spinning')
      })
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', async () => {
        // Se stiamo andando alla prossima canzone, blocca il doppio tap
        if (state.revealed) {
          nextBtn.disabled = true
          draftGuess = ''
          selectedSuggestion = null
          playProgress = 0
        } else {
          // Inizio reveal: azzera progress per i 30s da capo
          playProgress = 0
        }
        await game.next()
        // Aggiorna icona play se l'autoplay e' partito sulla schermata reveal
        const vin = document.querySelector('#vinyl')
        const ico = document.querySelector('#play-icon')
        if (game.player.isPlaying()) {
          if (vin) vin.classList.add('spinning')
          setPlayIcon(ico, true)
        }
      })
    }

    const submitGuess = async () => {
      if (!input) return
      const value = selectedSuggestion ? displayName(selectedSuggestion) : input.value.trim()
      if (!value) return
      const result = game.guess(value)
      if (result === 'wrong') {
        input.classList.add('shake')
        setTimeout(() => input.classList.remove('shake'), 350)
        return
      }
      if (result === 'correct') {
        selectedSuggestion = null
        draftGuess = ''
        input.value = ''
        playProgress = 0
        // Mostra soluzione + ascolto completo 30s (Next = prossima)
        await game.revealAfterCorrect()
        const vin = document.querySelector('#vinyl')
        const ico = document.querySelector('#play-icon')
        if (game.player.isPlaying()) {
          if (vin) vin.classList.add('spinning')
          setPlayIcon(ico, true)
        }
      }
    }

    if (guessBtn) guessBtn.addEventListener('click', submitGuess)

    if (input) {
      input.value = draftGuess
      if (state.lastGuessWrong) {
        input.focus()
        const len = input.value.length
        input.setSelectionRange(len, len)
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          submitGuess()
        }
        if (e.key === 'Escape' && suggestions) suggestions.hidden = true
      })
      input.addEventListener('input', () => {
        selectedSuggestion = null
        draftGuess = input.value
        if (!suggestions) return
        const matches = filterSongs(input.value)
        if (!matches.length || !input.value.trim()) {
          suggestions.hidden = true
          suggestions.innerHTML = ''
          return
        }
        suggestions.hidden = false
        const countNote =
          matches.length > SUGGEST_LIMIT_DEFAULT
            ? '<li class="suggestions-more" role="presentation">' +
              matches.length +
              ' brani — scorri per vederli tutti</li>'
            : ''
        suggestions.innerHTML =
          countNote +
          matches
            .map(
              (s) =>
                '<li data-id="' +
                escapeHtml(String(s.id)) +
                '" role="option"><strong>' +
                escapeHtml(s.title) +
                '</strong><span>' +
                escapeHtml(s.artist) +
                '</span></li>',
            )
            .join('')
        suggestions.querySelectorAll('li[data-id]').forEach((li) => {
          li.addEventListener('mousedown', (e) => {
            e.preventDefault()
            const id = li.getAttribute('data-id')
            const song = matches.find((m) => String(m.id) === String(id))
            if (!song) return
            selectedSuggestion = song
            input.value = displayName(song)
            draftGuess = input.value
            suggestions.hidden = true
            input.focus()
          })
        })
      })
    }

    outsideClickHandler = (e) => {
      if (!suggestions || !input) return
      const t = e.target
      if (!input.contains(t) && !suggestions.contains(t)) suggestions.hidden = true
    }
    document.addEventListener('click', outsideClickHandler)
  }

  function renderResults(state) {
    const screen = document.createElement('div')
    screen.className = 'screen results'
    const correct = state.rounds.filter((r) => r.result === 'correct').length
    const total = state.rounds.length
    const maxScore = total * 6
    const progress = catalogProgressLabel()
    const played = getPlayedCount()

    const rows = state.rounds
      .map((r) => {
        const ok = r.result === 'correct'
        const icon = ok ? ICO.check : ICO.nextMini
        const pts = r.points > 0 ? '+' + r.points : '0'
        const when = ok ? 'a ' + DURATION_STEPS[r.stepIndex] + 's' : 'saltata'
        return (
          '<li><span class="r-icon' +
          (ok ? ' ok' : '') +
          '">' +
          icon +
          '</span><span class="r-info"><strong>' +
          escapeHtml(r.song.title) +
          '</strong><small>' +
          escapeHtml(r.song.artist) +
          ' / ' +
          when +
          '</small></span><span class="r-pts">' +
          pts +
          '</span></li>'
        )
      })
      .join('')

    screen.innerHTML =
      '<header class="topbar topbar-results">' +
      '<div style="flex:1"></div>' +
      '<div class="topbar-right">' +
      '<button type="button" class="round-pill-btn" id="data-manage-btn" title="Esporta o importa salvataggio partita">' +
      (played > 0
        ? '<div class="round-pill catalog-pill" title="Brani gi\u00e0 fatti">' +
          played +
          ' fatte</div>'
        : '') +
      '</button>' +
      '</div>' +
      '</header>' +
      '<div class="results-content">' +
      LOGO_HTML +
      '<h1 class="brand-title">Che partita!</h1>' +
      '<div class="big-score">' +
      state.score +
      '<small> / ' +
      maxScore +
      '</small></div>' +
      '<p class="tagline">Hai indovinato <strong>' +
      correct +
      '</strong> su <strong>' +
      total +
      '</strong> brani</p>' +
      (progress
        ? '<p class="hint">' + escapeHtml(progress) + '</p>'
        : '') +
      '<ul class="result-list">' +
      rows +
      '</ul>' +
      '<button class="btn btn-primary btn-lg" id="restart-btn">Ancora una volta</button>' +
      '</div>'

    screen.querySelector('#restart-btn').addEventListener('click', async () => {
      clearSession()
      await game.start({ fresh: true })
    })

    const dataBtn = screen.querySelector('#data-manage-btn')
    if (dataBtn) {
      dataBtn.addEventListener('click', () => {
        showDataModal()
      })
    }
    return screen
  }

  game.subscribe(render)

  // Avvio: carica brani fatti + riprendi partita salvata (stesso meccanismo dell'intro)
  ;(async function boot() {
    initPlayedStore()

    if (hasSeenIntro()) {
      // Riprende sessione se c'è, altrimenti nuova playlist dai non-giocati
      await game.start()
    } else {
      game.showIntro()
    }
  })()

  // Salva anche quando l'utente chiude/nasconde la PWA
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        const st = game.getState()
        if (st && (st.phase === 'play' || st.phase === 'results')) {
          saveSession(st)
          writePlayedToDisk(playedMem)
        }
      }
    })
    window.addEventListener('pagehide', function () {
      const st = game.getState()
      if (st && (st.phase === 'play' || st.phase === 'results')) {
        saveSession(st)
        writePlayedToDisk(playedMem)
      }
    })
  } catch (_) {}

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          try {
            reg.update()
          } catch (_) {}
        })
        .catch(() => {})
    })
  }
})()
