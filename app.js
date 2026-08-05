/* Song Guesser - sito statico puro (niente npm) */
;(() => {
  'use strict'

  const SONGS = window.SONGS || []
  const DURATION_STEPS = [2, 5, 10, 15, 20, 30]
  const POINTS_BY_STEP = [6, 5, 4, 3, 2, 1]
  const INTRO_KEY = 'songguesser_intro_seen'
  /**
   * Progresso catalogo (PWA-safe):
   * - localStorage (sync)
   * - IndexedDB (più stabile su iOS/Android PWA)
   * - memoria in-process
   * Salva sia id che "chiavi stabili" titolo|artista così sopravvive a rebuild del catalogo.
   */
  const PLAYED_KEY = 'songguesser_played_v2'
  const PLAYED_KEY_LEGACY = 'songguesser_played_ids'
  const IDB_NAME = 'songguesser_db'
  const IDB_STORE = 'kv'
  const IDB_PLAYED = 'played'
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

  // ---------- progresso persistente (localStorage + IndexedDB) ----------
  function uniqueStrings(arr) {
    const seen = new Set()
    const out = []
    for (let i = 0; i < (arr || []).length; i++) {
      const v = String(arr[i] || '')
      if (!v || seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return out
  }

  /** Chiave stabile brano (sopravvive a cambi id / titoli con "Radio Edit") */
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
    let artist = String(song.artist || '')
      .split(/[;&]/)[0]
      .split(/\s*(?:,| feat\.? | ft\.? | featuring | with | x | vs\.? )\s*/i)[0]
    const a = normalize(artist).split(/\s+/).slice(0, 2).join(' ')
    return t + '|' + a
  }

  function emptyPlayed() {
    return { v: 2, ids: [], keys: [], count: 0, updatedAt: 0 }
  }

  function normalizePlayed(raw) {
    if (!raw) return emptyPlayed()
    if (Array.isArray(raw)) {
      const ids = uniqueStrings(raw.map(String))
      return { v: 2, ids, keys: [], count: ids.length, updatedAt: Date.now() }
    }
    if (typeof raw === 'object') {
      const ids = uniqueStrings([].concat(raw.ids || []).map(String))
      const keys = uniqueStrings([].concat(raw.keys || []).map(String))
      return {
        v: 2,
        ids,
        keys,
        count: Math.max(ids.length, keys.length),
        updatedAt: Number(raw.updatedAt) || Date.now(),
      }
    }
    return emptyPlayed()
  }

  function mergePlayed(a, b) {
    const ids = uniqueStrings([].concat((a && a.ids) || [], (b && b.ids) || []))
    const keys = uniqueStrings([].concat((a && a.keys) || [], (b && b.keys) || []))
    return {
      v: 2,
      ids,
      keys,
      count: Math.max(ids.length, keys.length),
      updatedAt: Math.max(
        Number((a && a.updatedAt) || 0),
        Number((b && b.updatedAt) || 0),
        Date.now(),
      ),
    }
  }

  /** Stato in memoria (fonte di verità durante la sessione) */
  let playedState = emptyPlayed()
  let playedReady = false

  function readLocalStoragePlayed() {
    try {
      const raw = localStorage.getItem(PLAYED_KEY)
      if (raw) return normalizePlayed(JSON.parse(raw))
    } catch (_) {}
    // migrazione da chiave legacy
    try {
      const legacy = localStorage.getItem(PLAYED_KEY_LEGACY)
      if (legacy) return normalizePlayed(JSON.parse(legacy))
    } catch (_) {}
    return emptyPlayed()
  }

  function writeLocalStoragePlayed(store) {
    const payload = {
      v: 2,
      ids: uniqueStrings(store.ids),
      keys: uniqueStrings(store.keys),
      count: 0,
      updatedAt: Date.now(),
    }
    payload.count = Math.max(payload.ids.length, payload.keys.length)
    const json = JSON.stringify(payload)
    try {
      localStorage.setItem(PLAYED_KEY, json)
      // tieni anche la legacy in sync per vecchie build
      localStorage.setItem(PLAYED_KEY_LEGACY, JSON.stringify(payload.ids))
    } catch (_) {
      try {
        const trimmed = {
          v: 2,
          ids: payload.ids.slice(-800),
          keys: payload.keys.slice(-800),
          count: 0,
          updatedAt: Date.now(),
        }
        trimmed.count = Math.max(trimmed.ids.length, trimmed.keys.length)
        localStorage.setItem(PLAYED_KEY, JSON.stringify(trimmed))
        localStorage.setItem(PLAYED_KEY_LEGACY, JSON.stringify(trimmed.ids))
      } catch (__) {}
    }
    return payload
  }

  function openPlayedIdb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('no idb'))
        return
      }
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('idb open failed'))
    })
  }

  function idbGetPlayed(db) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const store = tx.objectStore(IDB_STORE)
        const req = store.get(IDB_PLAYED)
        req.onsuccess = () => resolve(normalizePlayed(req.result))
        req.onerror = () => reject(req.error)
      } catch (e) {
        reject(e)
      }
    })
  }

  function idbSetPlayed(db, data) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        const req = store.put(data, IDB_PLAYED)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => resolve()
      } catch (e) {
        reject(e)
      }
    })
  }

  function idbClearPlayed(db) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        const store = tx.objectStore(IDB_STORE)
        const req = store.delete(IDB_PLAYED)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      } catch (e) {
        reject(e)
      }
    })
  }

  function persistPlayedNow() {
    playedState = writeLocalStoragePlayed(playedState)
    // IndexedDB in background (non blocca UI)
    openPlayedIdb()
      .then((db) =>
        idbSetPlayed(db, playedState).finally(() => {
          try {
            db.close()
          } catch (_) {}
        }),
      )
      .catch(() => {})
  }

  /**
   * Carica progresso da localStorage + IndexedDB (merge).
   * Da chiamare PRIMA di game.start() all'avvio PWA.
   */
  async function initPlayedStore() {
    let merged = readLocalStoragePlayed()

    // Arricchisci keys dagli id già noti nel catalogo
    const byId = new Map(SONGS.map((s) => [String(s.id), s]))
    for (let i = 0; i < merged.ids.length; i++) {
      const song = byId.get(String(merged.ids[i]))
      if (song) {
        const k = songStableKey(song)
        if (k && merged.keys.indexOf(k) === -1) merged.keys.push(k)
      }
    }

    try {
      const db = await openPlayedIdb()
      try {
        const fromIdb = await idbGetPlayed(db)
        merged = mergePlayed(merged, fromIdb)
        // riscrivi entrambe le fonti allineate
        merged = writeLocalStoragePlayed(merged)
        await idbSetPlayed(db, merged)
      } finally {
        try {
          db.close()
        } catch (_) {}
      }
    } catch (_) {
      merged = writeLocalStoragePlayed(merged)
    }

    playedState = merged
    playedReady = true

    // Chiedi storage persistente (riduce evizioni iOS/Android)
    try {
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {})
      }
    } catch (_) {}

    return playedState
  }

  function getPlayedIds() {
    if (!playedReady) {
      playedState = mergePlayed(playedState, readLocalStoragePlayed())
    }
    return playedState.ids.slice()
  }

  function getPlayedCount() {
    if (!playedReady) {
      playedState = mergePlayed(playedState, readLocalStoragePlayed())
    }
    // Conta quanti brani del catalogo attuale risultano già fatti
    let n = 0
    const idSet = new Set(playedState.ids.map(String))
    const keySet = new Set(playedState.keys)
    for (let i = 0; i < SONGS.length; i++) {
      const s = SONGS[i]
      if (idSet.has(String(s.id)) || keySet.has(songStableKey(s))) n++
    }
    return n
  }

  /** @param {string|object} songOrId */
  function markSongPlayed(songOrId) {
    if (songOrId == null || songOrId === '') return

    let song = null
    let id = ''
    if (typeof songOrId === 'object') {
      song = songOrId
      id = song.id != null ? String(song.id) : ''
    } else {
      id = String(songOrId)
      song = SONGS.find((s) => String(s.id) === id) || null
    }

    const key = song ? songStableKey(song) : ''
    let changed = false

    if (id && playedState.ids.indexOf(id) === -1) {
      playedState.ids.push(id)
      changed = true
    }
    if (key && playedState.keys.indexOf(key) === -1) {
      playedState.keys.push(key)
      changed = true
    }

    if (!changed && id && playedState.ids.indexOf(id) !== -1) return

    playedState.count = Math.max(playedState.ids.length, playedState.keys.length)
    playedState.updatedAt = Date.now()
    persistPlayedNow()
  }

  function clearPlayedIds() {
    playedState = emptyPlayed()
    try {
      localStorage.removeItem(PLAYED_KEY)
      localStorage.removeItem(PLAYED_KEY_LEGACY)
    } catch (_) {}
    openPlayedIdb()
      .then((db) =>
        idbClearPlayed(db).finally(() => {
          try {
            db.close()
          } catch (_) {}
        }),
      )
      .catch(() => {})
  }

  function isSongPlayed(song) {
    if (!song) return false
    const idSet = new Set(playedState.ids.map(String))
    const keySet = new Set(playedState.keys)
    if (song.id != null && idSet.has(String(song.id))) return true
    const k = songStableKey(song)
    return !!(k && keySet.has(k))
  }

  function getUnplayedSongs() {
    if (!playedReady) {
      playedState = mergePlayed(playedState, readLocalStoragePlayed())
    }
    return SONGS.filter((s) => s && s.id != null && !isSongPlayed(s))
  }

  /** Playlist di brani non ancora giocati; se finiti, ricomincia il catalogo */
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
    if (left <= 0) return 'Catalogo completato — al prossimo avvio si ricomincia'
    return played + ' fatte · ' + left + ' nuove rimaste'
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

    async start() {
      markIntroSeen()
      this.player.stop()
      const base = this.initialState()
      base.phase = 'play'
      base.playlist = buildFreshPlaylist()
      base.loading = true
      this.state = base
      this.emit()
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
          this.set({
            loading: false,
            error: 'Audio non disponibile per questo brano. Passa alla successiva.',
          })
          return
        }
        await this.player.load(preview.previewUrl)
        this.player.setMaxSeconds(DURATION_STEPS[0])
        this.set({ preview, loading: false, error: null })
      } catch (_) {
        this.set({
          loading: false,
          error: 'Non riesco a caricare l\'audio. Controlla la connessione o passa avanti.',
        })
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
        return
      }
      this.set({ index: nextIndex, revealed: false, revealKind: null })
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
      message: 'Il punteggio di questa sessione verr\u00e0 azzerato.',
      okLabel: 'Ricomincia',
      cancelLabel: 'Annulla',
      icon: ICO.refresh,
    })
    if (!ok) return
    draftGuess = ''
    selectedSuggestion = null
    playProgress = 0
    game.start()
  }

  const LOGO_HTML =
    '<div class="logo-mark"><img src="pwa-192.png" alt="Song Guesser" width="96" height="96" decoding="async" /></div>'

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
      '<div class="home-content">' +
      LOGO_HTML +
      '<h1 class="brand-title">Song Guesser</h1>' +
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
          '" />'
        : '<div class="art placeholder">' + ICO.note + '</div>'

    const inc = nextIncrement(step)
    const playing = game.player.isPlaying()

    screen.innerHTML =
      '<header class="topbar">' +
      '<button type="button" class="btn-score" id="score-btn" title="Ricomincia la partita">' +
      ICO.star +
      '<span class="score-num">' +
      state.score +
      '</span></button>' +
      '<div class="round-pill">' +
      round +
      ' / ' +
      total +
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
        ? '<p class="wrong-msg">Nope! Riprova o sblocca pi\u00f9 secondi.</p>'
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
      await game.start()
    })
    return screen
  }

  game.subscribe(render)

  // Avvio: carica progresso salvato PRIMA di creare la playlist, poi intro/partita
  ;(async function boot() {
    try {
      await initPlayedStore()
    } catch (_) {
      // anche se IDB fallisce, localStorage è già stato letto
      try {
        playedState = mergePlayed(playedState, readLocalStoragePlayed())
        playedReady = true
      } catch (__) {}
    }

    if (hasSeenIntro()) {
      await game.start()
    } else {
      game.showIntro()
    }
  })()

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          // Forza controllo aggiornamenti ad ogni apertura PWA
          try {
            reg.update()
          } catch (_) {}
        })
        .catch(() => {})
    })
  }
})()
