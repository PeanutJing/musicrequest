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
  progressText: document.getElementById('progressText')
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
  searchBusy: false
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

function updateSoundStatus() {
  if (!el.soundStatus) return;
  el.soundStatus.textContent = state.audioEnabled ? 'On' : 'Muted';
  el.enableSoundButton.textContent = state.audioEnabled ? 'ปิดเสียงเครื่องนี้' : 'เปิดเสียงเครื่องนี้';
}

function currentSkipThreshold() {
  return Math.max(1, Math.ceil(state.viewerCount / 2));
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

function playTrack(track) {
  if (!track || !track.videoId) return;

  if (!ensurePlayerReady()) {
    state.pendingPlay = track;
    return;
  }

  try {
    state.currentPlayId = Number(track.playId || 0);

    if (!state.audioEnabled) {
      state.player.mute();
    } else {
      state.player.unMute();
    }

    state.player.loadVideoById(track.videoId);
    state.player.playVideo();

    renderNowPlaying(track);
    updateSoundStatus();
  } catch (err) {
    console.error('PLAY TRACK ERROR:', err);
    state.pendingPlay = track;
  }
}

function startPendingIfAny() {
  if (state.pendingPlay && ensurePlayerReady()) {
    const pending = state.pendingPlay;
    state.pendingPlay = null;
    playTrack(pending);
  }
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
        startPendingIfAny();
      },
      onStateChange: event => {
        try {
          if (event.data === YT.PlayerState.ENDED) {
            if (state.currentPlayId) {
              socket.emit('trackEnded', { playId: state.currentPlayId });
            }
          }
        } catch (err) {
          console.error('YT STATE CHANGE ERROR:', err);
        }
      },
      onError: event => {
        console.error('YT ERROR:', event?.data);
        if (state.currentPlayId) {
          socket.emit('trackEnded', { playId: state.currentPlayId, reason: 'yt-error' });
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
  el.enableSoundButton.addEventListener('click', async () => {
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
      playTrack(state.current);
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

function renderAllFromState() {
  renderQueue(state.queue);
  renderNowPlaying(state.current);
  updateSoundStatus();
  updateProgress();
}

socket.on('connect', () => {
  console.log('SOCKET CONNECTED');
});

socket.on('queueUpdated', queue => {
  state.queue = Array.isArray(queue) ? queue : [];
  renderQueue(state.queue);
  updateProgress();
});

socket.on('currentlyPlaying', track => {
  state.current = track || null;
  renderNowPlaying(state.current);

  if (state.current && state.current.videoId) {
    if (!ensurePlayerReady()) {
      state.pendingPlay = state.current;
      return;
    }

    if (Number(state.currentPlayId) !== Number(state.current.playId)) {
      playTrack(state.current);
    }
  }
});

socket.on('play', track => {
  state.current = track || null;
  renderNowPlaying(state.current);

  if (!track || !track.videoId) return;

  if (!ensurePlayerReady()) {
    state.pendingPlay = track;
    return;
  }

  playTrack(track);
});

socket.on('stop', () => {
  state.current = null;
  state.currentPlayId = null;
  state.pendingPlay = null;

  try {
    if (state.player && typeof state.player.stopVideo === 'function') {
      state.player.stopVideo();
    }
  } catch (err) {
    console.error('STOP ERROR:', err);
  }

  renderNowPlaying(null);
  updateProgress();
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
}, 1000);

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
    renderAllFromState();

    if (state.current && state.current.videoId) {
      state.pendingPlay = state.current;
      startPendingIfAny();
    }
  } catch (err) {
    console.error('INITIAL LOAD ERROR:', err);
    renderAllFromState();
  }
}

updateSoundStatus();
initialLoad();