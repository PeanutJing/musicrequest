'use strict';

console.log('MAIN JS LOADED');

const socket = io();

const el = {
    searchForm: document.getElementById('searchForm'),
    searchInput: document.getElementById('searchInput'),
    searchButton: document.getElementById('searchButton'),
    searchResults: document.getElementById('searchResults'),
    queueList: document.getElementById('queueList'),
    viewerCount: document.getElementById('viewerCount'),
    authStatus: document.getElementById('authStatus'),
    nowPlaying: document.getElementById('nowPlaying'),
    queueMeta: document.getElementById('queueMeta'),
    currentVotesInfo: document.getElementById('currentVotesInfo'),
    enableSoundButton: document.getElementById('enableSoundButton'),
    playButton: document.getElementById('playButton'),
    volume: document.getElementById('volume'),
    soundStatus: document.getElementById('soundStatus'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    lyricsStatus: document.getElementById('lyricsStatus'),
    lyricsCurrentLine: document.getElementById('lyricsCurrentLine'),
    lyricsContent: document.getElementById('lyricsContent')
};

const state = {
    queue: [],
    current: null,
    viewerCount: 0,
    player: null,
    playerReady: false,
    currentPlayId: null,
    pendingPlay: null,
    audioEnabled: false,
    searchBusy: false,
    playTimer: null,
    lastCurrentSignature: '',
    lastLyricsSignature: '',
    lyrics: {
        lines: [],
        plain: '',
        source: 'none',
        activeIndex: -1,
        requestSeq: 0
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

function currentSkipThreshold() {
    return Math.max(1, Math.ceil(state.viewerCount / 2));
}

function updateSoundStatus() {
    if (!el.soundStatus) return;
    el.soundStatus.textContent = state.audioEnabled ? 'On' : 'Muted';
    el.enableSoundButton.textContent = state.audioEnabled ? 'ปิดเสียงเครื่องนี้' : 'เปิดเสียงเครื่องนี้';
}

function renderNowPlaying(track) {
    if (!track) {
        el.nowPlaying.innerHTML = `
      <div class="card-thai" style="padding: 1rem; background: rgba(253,250,245,0.75);">
        <strong style="color: var(--thai-red);">Now Playing</strong>
        <div style="margin-top: 0.35rem; opacity: 0.8;">ยังไม่มีเพลงกำลังเล่น</div>
      </div>
    `;
        el.currentVotesInfo.textContent = `Votes: 0 / ${currentSkipThreshold()}`;
        return;
    }

    const votes = Number(track.votes || 0);
    const threshold = currentSkipThreshold();

    el.nowPlaying.innerHTML = `
    <div class="card-thai" style="padding: 1rem; background: rgba(253,250,245,0.75); border-left-width: 5px;">
      <div style="display: flex; gap: 1rem; align-items: center;">
        <div style="width: 74px; height: 74px; border-radius: 16px; overflow: hidden; background: #f2eee8; flex-shrink: 0; box-shadow: 0 8px 18px rgba(0,0,0,0.08);">
          ${track.thumbnail ? `<img src="${escapeHtml(track.thumbnail)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : ''}
        </div>

        <div style="min-width: 0;">
          <div style="font-weight: 700; color: var(--thai-red); font-size: 1.02rem; line-height: 1.35;">${escapeHtml(track.title || '')}</div>
          <div style="opacity: 0.85; margin-top: 0.2rem;">by ${escapeHtml(track.artist || '')}</div>
          <div style="opacity: 0.72; margin-top: 0.2rem; font-size: 0.88rem;">Requested by ${escapeHtml(track.requestedBy || 'Guest')}</div>
          <div style="opacity: 0.72; margin-top: 0.2rem; font-size: 0.88rem;">Votes: ${votes} / ${threshold}</div>
        </div>
      </div>

      <div style="margin-top: 1rem; display: flex; gap: 0.75rem; flex-wrap: wrap;">
        <button id="voteSkipButton" class="btn-thai" type="button">Vote Skip</button>
      </div>
    </div>
  `;

    el.currentVotesInfo.textContent = `Votes: ${votes} / ${threshold}`;

    const voteBtn = document.getElementById('voteSkipButton');
    if (voteBtn) {
        voteBtn.onclick = () => {
            if (!state.current) return;
            socket.emit('voteSkip', state.current.id);
        };
    }
}

function renderQueue(queue) {
    const upcoming = Array.isArray(queue) ? queue.slice(1) : [];
    el.queueMeta.textContent = `${upcoming.length} เพลง`;

    if (!upcoming.length) {
        el.queueList.innerHTML = `
      <div style="padding: 1rem 0; color: rgba(45,45,45,0.7);">คิวว่าง</div>
    `;
        return;
    }

    el.queueList.innerHTML = upcoming.map((item, index) => `
    <div class="card-thai" style="padding: 0.95rem; display: grid; grid-template-columns: 60px 1fr; gap: 0.9rem; align-items: center; border-left-width: 3px;">
      <div style="width: 60px; height: 60px; border-radius: 14px; overflow: hidden; background: #f2eee8; box-shadow: 0 8px 18px rgba(0,0,0,0.06);">
        ${item.thumbnail ? `<img src="${escapeHtml(item.thumbnail)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : ''}
      </div>

      <div style="min-width: 0;">
        <div style="font-weight: 700; color: var(--thai-red); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${index + 2}. ${escapeHtml(item.title || '')}
        </div>
        <div style="opacity: 0.85; margin-top: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">by ${escapeHtml(item.artist || '')}</div>
        <div style="opacity: 0.7; margin-top: 0.15rem; font-size: 0.88rem;">Requested by ${escapeHtml(item.requestedBy || 'Guest')}</div>
      </div>
    </div>
  `).join('');
}

function renderSearchResults(results) {
    if (!Array.isArray(results) || results.length === 0) {
        el.searchResults.innerHTML = `
      <div style="padding: 1rem 0; color: rgba(45,45,45,0.7);">ไม่พบผลลัพธ์</div>
    `;
        return;
    }

    el.searchResults.innerHTML = results.map(song => `
    <div class="card-thai" style="padding: 1rem; display: grid; grid-template-columns: 72px 1fr auto; gap: 1rem; align-items: center;">
      <div style="width: 72px; height: 72px; border-radius: 16px; overflow: hidden; background: #f2eee8; box-shadow: 0 10px 20px rgba(0,0,0,0.08);">
        ${song.thumbnail ? `<img src="${escapeHtml(song.thumbnail)}" alt="" style="width:100%;height:100%;object-fit:cover;" />` : ''}
      </div>

      <div style="min-width: 0;">
        <div style="font-weight: 700; color: var(--thai-red); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(song.title || '')}</div>
        <div style="opacity: 0.85; margin-top: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">by ${escapeHtml(song.artist || '')}</div>
        <div style="opacity: 0.7; margin-top: 0.15rem; font-size: 0.88rem;">YouTube</div>
      </div>

      <div style="display: grid; gap: 0.5rem; justify-items: end;">
        <button
          class="btn-thai request-button"
          data-video-id="${escapeHtml(song.videoId || '')}"
          data-title="${escapeHtml(song.title || '')}"
          data-artist="${escapeHtml(song.artist || '')}"
          data-thumbnail="${escapeHtml(song.thumbnail || '')}"
          data-duration="${escapeHtml(song.duration || 180)}"
          type="button"
          style="padding: 0.55rem 1rem;"
        >
          Request
        </button>
      </div>
    </div>
  `).join('');
}

async function safeFetchJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Non-JSON response (${res.status})`);
    }

    const data = await res.json().catch(() => ({}));
    return { res, data };
}

async function fetchSearch(query) {
    const { res, data } = await safeFetchJson(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    return Array.isArray(data) ? data : [];
}

function ensurePlayerReady() {
    return !!(state.player && state.playerReady);
}

function updateProgress() {
    try {
        if (!ensurePlayerReady() || !state.current) return;
        if (typeof state.player.getCurrentTime !== 'function' || typeof state.player.getDuration !== 'function') return;

        const currentTime = Number(state.player.getCurrentTime() || 0);
        const duration = Number(state.player.getDuration() || 0);

        if (!duration || duration <= 0) {
            el.progressText.textContent = `${formatTime(currentTime)} / 0:00`;
            el.progressFill.style.width = '0%';
            return;
        }

        const pct = Math.max(0, Math.min(100, (currentTime / duration) * 100));
        el.progressFill.style.width = `${pct}%`;
        el.progressText.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    } catch (err) {
        console.error('PROGRESS ERROR:', err);
    }
}

function clearPlayTimer() {
    if (state.playTimer) {
        clearTimeout(state.playTimer);
        state.playTimer = null;
    }
}

function parseLRC(lrcText) {
    const lines = String(lrcText || '').split('\n');
    const out = [];

    for (const raw of lines) {
        const match = raw.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/);
        if (!match) continue;

        const mm = Number(match[1]);
        const ss = Number(match[2]);
        const ms = Number((match[3] || '0').padEnd(3, '0'));

        const text = String(match[4] || '').trim();
        if (!text) continue;

        out.push({
            time: (mm * 60) + ss + (ms / 1000),
            text
        });
    }

    return out.sort((a, b) => a.time - b.time);
}

function findActiveLyricIndex(lines, timeSec) {
    if (!Array.isArray(lines) || !lines.length) return -1;

    let activeIndex = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (timeSec >= lines[i].time) activeIndex = i;
        else break;
    }
    return activeIndex;
}

function renderLyricsEmpty(message) {
    el.lyricsStatus.textContent = 'ไม่มีเนื้อเพลง';
    el.lyricsCurrentLine.textContent = message || 'ไม่พบเนื้อเพลง';
    el.lyricsContent.innerHTML = `
    <div style="padding: 0.75rem 0; color: rgba(45,45,45,0.7); line-height: 1.7;">
      ${escapeHtml(message || 'ไม่พบเนื้อเพลง')}
    </div>
  `;
}

function renderLyricsSynced() {
    const lines = state.lyrics.lines || [];
    if (!lines.length) {
        renderLyricsEmpty('ไม่พบเนื้อเพลงแบบซิงก์');
        return;
    }

    const activeIndex = state.lyrics.activeIndex;
    const activeLine = activeIndex >= 0 ? lines[activeIndex].text : '—';

    el.lyricsStatus.textContent = 'เนื้อเพลงสด';
    el.lyricsCurrentLine.textContent = activeLine;

    el.lyricsContent.innerHTML = lines.map((line, index) => {
        const active = index === activeIndex;
        return `
      <div
        data-lyric-index="${index}"
        style="
          padding: 0.5rem 0.7rem;
          border-radius: 12px;
          margin-bottom: 0.35rem;
          transition: var(--transition);
          background: ${active ? 'rgba(179, 139, 89, 0.14)' : 'transparent'};
          color: ${active ? 'var(--thai-red)' : 'rgba(45,45,45,0.76)'};
          font-weight: ${active ? '700' : '400'};
          line-height: 1.7;
        "
      >
        ${escapeHtml(line.text)}
      </div>
    `;
    }).join('');

    if (activeIndex >= 0 && activeIndex !== state.lyrics.lastActiveIndex) {
        state.lyrics.lastActiveIndex = activeIndex;
        const activeEl = el.lyricsContent.querySelector(`[data-lyric-index="${activeIndex}"]`);
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }
}

function renderLyricsPlain() {
    const text = String(state.lyrics.plain || '').trim();
    if (!text) {
        renderLyricsEmpty('ไม่พบเนื้อเพลง');
        return;
    }

    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);

    el.lyricsStatus.textContent = 'เนื้อเพลง';
    el.lyricsCurrentLine.textContent = lines[0] || '—';

    el.lyricsContent.innerHTML = lines.map(line => `
    <div style="
      padding: 0.5rem 0.7rem;
      border-radius: 12px;
      margin-bottom: 0.35rem;
      background: rgba(179, 139, 89, 0.08);
      color: rgba(45,45,45,0.82);
      line-height: 1.7;
    ">
      ${escapeHtml(line)}
    </div>
  `).join('');
}

function updateLyricsDisplay() {
    if (!state.current) {
        el.lyricsStatus.textContent = 'รอเพลง';
        el.lyricsCurrentLine.textContent = '—';
        el.lyricsContent.innerHTML = `
      <div style="padding: 0.75rem 0; color: rgba(45,45,45,0.7); line-height: 1.7;">
        เลือกเพลงก่อน แล้วเนื้อเพลงจะขึ้นที่นี่
      </div>
    `;
        return;
    }

    if (state.lyrics.lines.length > 0) {
        if (!ensurePlayerReady()) {
            renderLyricsSynced();
            return;
        }

        const t = Number(state.player.getCurrentTime?.() || 0);
        state.lyrics.activeIndex = findActiveLyricIndex(state.lyrics.lines, t);
        renderLyricsSynced();
        return;
    }

    if (state.lyrics.plain) {
        renderLyricsPlain();
        return;
    }

    renderLyricsEmpty('ไม่พบเนื้อเพลงสำหรับเพลงนี้');
}

function actuallyStartTrack(track) {
    if (!track || !track.videoId) return;
    if (!ensurePlayerReady()) {
        state.pendingPlay = track;
        return;
    }

    try {
        const startedAt = Number(track.startedAt || Date.now());
        const offsetSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

        state.currentPlayId = Number(track.playId || 0);

        if (!state.audioEnabled) {
            state.player.mute();
        } else {
            state.player.unMute();
        }

        state.player.loadVideoById({
            videoId: track.videoId,
            startSeconds: offsetSeconds
        });

        state.player.playVideo();
        renderNowPlaying(track);
        updateSoundStatus();
    } catch (err) {
        console.error('PLAY TRACK ERROR:', err);
        state.pendingPlay = track;
    }
}

function scheduleTrackStart(track) {
    clearPlayTimer();

    if (!track || !track.videoId) return;

    const waitMs = Math.max(0, Number(track.startedAt || Date.now()) - Date.now());

    state.playTimer = setTimeout(() => {
        actuallyStartTrack(track);
    }, waitMs);
}

async function loadLyricsForTrack(track) {
    const signature = `${String(track?.title || '').toLowerCase()}|${String(track?.artist || '').toLowerCase()}`;
    if (!track || !track.title) {
        state.lyrics.lines = [];
        state.lyrics.plain = '';
        state.lyrics.source = 'none';
        state.lastLyricsSignature = '';
        updateLyricsDisplay();
        return;
    }

    if (signature === state.lastLyricsSignature) {
        updateLyricsDisplay();
        return;
    }

    state.lastLyricsSignature = signature;
    const requestSeq = ++state.lyrics.requestSeq;

    el.lyricsStatus.textContent = 'กำลังโหลดเนื้อเพลง...';
    el.lyricsCurrentLine.textContent = '—';
    el.lyricsContent.innerHTML = `
    <div style="padding: 0.75rem 0; color: rgba(45,45,45,0.7); line-height: 1.7;">
      กำลังค้นหาเนื้อเพลง...
    </div>
  `;

    try {
        const { res, data } = await safeFetchJson(
            `/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist || '')}`
        );

        if (requestSeq !== state.lyrics.requestSeq) return;
        if (!res.ok) throw new Error('lyrics request failed');

        const synced = String(data.synced || '');
        const plain = String(data.plain || '');
        state.lyrics.lines = synced ? parseLRC(synced) : [];
        state.lyrics.plain = plain;
        state.lyrics.source = String(data.source || 'none');

        if (state.lyrics.lines.length > 0) {
            state.lyrics.activeIndex = -1;
            updateLyricsDisplay();
            return;
        }

        if (state.lyrics.plain) {
            updateLyricsDisplay();
            return;
        }

        renderLyricsEmpty('ไม่พบเนื้อเพลงสำหรับเพลงนี้');
    } catch (err) {
        console.error('LYRICS ERROR:', err);
        if (requestSeq !== state.lyrics.requestSeq) return;
        state.lyrics.lines = [];
        state.lyrics.plain = '';
        state.lyrics.source = 'none';
        renderLyricsEmpty('ไม่พบเนื้อเพลงสำหรับเพลงนี้');
    }
}

function handleIncomingCurrent(track) {
    const sig = `${String(track?.id || '')}|${String(track?.playId || '')}|${String(track?.startedAt || '')}`;

    state.current = track || null;
    renderNowPlaying(state.current);

    if (!state.current || !state.current.videoId) {
        clearPlayTimer();
        state.lastCurrentSignature = '';
        updateLyricsDisplay();
        return;
    }

    loadLyricsForTrack(state.current);

    if (sig === state.lastCurrentSignature) {
        updateProgress();
        return;
    }

    state.lastCurrentSignature = sig;

    if (!ensurePlayerReady()) {
        state.pendingPlay = state.current;
        scheduleTrackStart(state.current);
        return;
    }

    scheduleTrackStart(state.current);
}

function initYouTubePlayer() {
    if (!window.YT || !window.YT.Player) return;
    if (state.player) return;

    state.player = new YT.Player('player', {
        height: '340',
        width: '100%',
        videoId: '',
        playerVars: {
            autoplay: 0,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            fs: 1
        },
        events: {
            onReady: () => {
                console.log('YT READY');
                state.playerReady = true;
                updateSoundStatus();
                updateLyricsDisplay();

                if (state.pendingPlay) {
                    scheduleTrackStart(state.pendingPlay);
                    state.pendingPlay = null;
                }
            },
            onStateChange: event => {
                try {
                    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) {
                        updateProgress();
                    }
                } catch (err) {
                    console.error('YT STATE CHANGE ERROR:', err);
                }
            },
            onError: event => {
                console.error('YT ERROR:', event?.data);
                if (state.current) {
                    loadLyricsForTrack(state.current);
                }
            }
        }
    });
}

window.onYouTubeIframeAPIReady = () => {
    console.log('YOUTUBE SDK READY');
    initYouTubePlayer();
};

if (window.YT && window.YT.Player) {
    initYouTubePlayer();
}

if (el.enableSoundButton) {
    el.enableSoundButton.addEventListener('click', () => {
        state.audioEnabled = !state.audioEnabled;
        updateSoundStatus();

        if (!ensurePlayerReady()) return;

        try {
            if (state.audioEnabled) {
                state.player.unMute();
                state.player.setVolume(Number(el.volume.value || 60));
                state.player.playVideo();
            } else {
                state.player.mute();
            }
        } catch (err) {
            console.error('AUDIO TOGGLE ERROR:', err);
        }
    });
}

if (el.playButton) {
    el.playButton.addEventListener('click', () => {
        if (state.current) {
            scheduleTrackStart(state.current);
        }
    });
}

if (el.volume) {
    el.volume.addEventListener('input', () => {
        try {
            if (state.player && typeof state.player.setVolume === 'function') {
                state.player.setVolume(Number(el.volume.value));
            }
        } catch (err) {
            console.error('VOLUME ERROR:', err);
        }
    });
}

if (el.searchForm) {
    el.searchForm.addEventListener('submit', async event => {
        event.preventDefault();

        const query = el.searchInput.value.trim();
        if (!query || state.searchBusy) return;

        state.searchBusy = true;
        el.searchResults.innerHTML = `
      <div style="padding: 1rem 0; color: rgba(45,45,45,0.7);">กำลังค้นหา...</div>
    `;

        try {
            const results = await fetchSearch(query);
            renderSearchResults(results);
        } catch (err) {
            console.error('SEARCH ERROR:', err);
            el.searchResults.innerHTML = `
        <div style="padding: 1rem 0; color: var(--thai-red);">ค้นหาไม่สำเร็จ</div>
      `;
        } finally {
            state.searchBusy = false;
        }
    });
}

if (el.searchResults) {
    el.searchResults.addEventListener('click', event => {
        const btn = event.target.closest('.request-button');
        if (!btn) return;

        const payload = {
            id: String(Date.now()),
            videoId: btn.dataset.videoId || '',
            title: btn.dataset.title || '',
            artist: btn.dataset.artist || '',
            thumbnail: btn.dataset.thumbnail || '',
            duration: Number(btn.dataset.duration || 180),
            requestedBy: 'Guest'
        };

        if (!payload.videoId || !payload.title) return;

        socket.emit('requestSong', payload);
    });
}

if (el.queueList) {
    el.queueList.addEventListener('click', event => {
        const btn = event.target.closest('.skip-button');
        if (!btn) return;
        socket.emit('voteSkip', btn.dataset.id);
    });
}

socket.on('connect', () => {
    console.log('SOCKET CONNECTED');
});

socket.on('queueUpdated', queue => {
    state.queue = Array.isArray(queue) ? queue : [];
    renderQueue(state.queue);
    updateProgress();
    updateLyricsDisplay();
});

socket.on('currentlyPlaying', track => {
    handleIncomingCurrent(track);
});

socket.on('viewerCount', count => {
    state.viewerCount = Number(count || 0);
    el.viewerCount.textContent = `Viewers: ${state.viewerCount}`;
    renderNowPlaying(state.current);
});

socket.on('connect_error', err => {
    console.error('SOCKET CONNECT ERROR:', err);
});

setInterval(() => {
    updateProgress();
    updateLyricsDisplay();

    try {
        if (!ensurePlayerReady() || !state.current) return;
        if (typeof state.player.getCurrentTime !== 'function') return;

        const expected = Math.max(0, (Date.now() - Number(state.current.startedAt || Date.now())) / 1000);
        const actual = Number(state.player.getCurrentTime() || 0);

        if (Math.abs(actual - expected) > 1.8) {
            state.player.seekTo(expected, true);
        }
    } catch (err) {
        console.error('DRIFT CORRECTION ERROR:', err);
    }
}, 2500);

window.addEventListener('error', event => {
    console.error('WINDOW ERROR:', event.error || event.message);
});

window.addEventListener('unhandledrejection', event => {
    console.error('UNHANDLED REJECTION:', event.reason);
});

async function initialLoad() {
    try {
        const { data } = await safeFetchJson('/api/queue');
        state.queue = Array.isArray(data.queue) ? data.queue : [];
        state.current = data.currentlyPlaying || null;
        state.viewerCount = Number(data.viewers || 0);

        el.viewerCount.textContent = `Viewers: ${state.viewerCount}`;
        renderQueue(state.queue);
        renderNowPlaying(state.current);
        updateSoundStatus();

        if (state.current && state.current.videoId) {
            state.pendingPlay = state.current;
            loadLyricsForTrack(state.current);
            scheduleTrackStart(state.current);
        } else {
            updateLyricsDisplay();
        }
    } catch (err) {
        console.error('INITIAL LOAD ERROR:', err);
        renderQueue([]);
        renderNowPlaying(null);
        updateLyricsDisplay();
    }
}

updateSoundStatus();
initialLoad();