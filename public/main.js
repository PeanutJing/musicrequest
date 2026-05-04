console.log('MAIN JS LOADED');

const socket = io();

/* =========================
   DOM
========================= */
const el = {
    searchInput: document.getElementById('searchInput'),
    searchButton: document.getElementById('searchButton'),
    searchResults: document.getElementById('searchResults'),
    previewPlayer: document.getElementById('previewPlayer'),
    queueList: document.getElementById('queueList'),
    manualForm: document.getElementById('manualRequestForm'),
    songTitle: document.getElementById('songTitle'),
    songArtist: document.getElementById('songArtist'),
    requestedBy: document.getElementById('requestedBy'),
    viewerCount: document.getElementById('viewerCount'),
    loginButton: document.getElementById('loginButton'),
    authStatus: document.getElementById('authStatus'),
    playButton: document.getElementById('playButton'),
    nowPlaying: document.getElementById('nowPlaying'),
    playerBar: document.getElementById('playerBar')
};

/* =========================
   STATE
========================= */
const state = {
    isAuthenticated: false,
    queue: [],
    currentlyPlaying: null,
    previewAudio: null,
    previewTrackId: null,
    deviceId: null,
    player: null,
    sdkReady: false,
    playerConnected: false
};

/* =========================
   HELPERS
========================= */
function setText(elm, value) {
    if (elm) elm.textContent = value;
}

function renderError(target, message) {
    if (!target) return;
    target.innerHTML = `<p class="empty error">${message}</p>`;
}

function encodeOrEmpty(value) {
    return encodeURIComponent(value || '');
}

/* =========================
   AUTH
========================= */
async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth-status', {
            credentials: 'include'
        });
        const data = await res.json();

        state.isAuthenticated = !!data.authenticated;
        updateAuthUI();

        console.log('AUTH STATUS:', data);
    } catch (err) {
        console.error('AUTH CHECK ERROR:', err);
        state.isAuthenticated = false;
        updateAuthUI();
    }
}

function updateAuthUI() {
    if (state.isAuthenticated) {
        if (el.loginButton) el.loginButton.style.display = 'none';
        if (el.authStatus) el.authStatus.textContent = '✓ Connected to Spotify';
        if (el.playButton) el.playButton.style.display = 'block';
    } else {
        if (el.loginButton) el.loginButton.style.display = 'inline-block';
        if (el.authStatus) el.authStatus.textContent = '';
        if (el.playButton) el.playButton.style.display = 'none';
    }
}

if (el.loginButton) {
    el.loginButton.addEventListener('click', () => {
        window.location.href = '/login';
    });
}

/* =========================
   SPOTIFY WEB PLAYBACK SDK
========================= */
function initSpotifyPlayer() {
    if (state.player || !window.Spotify) return;

    console.log('Initializing Spotify Player...');

    state.player = new Spotify.Player({
        name: 'Music Request Web Player',
        getOAuthToken: async cb => {
            try {
                console.log('GET TOKEN');

                const res = await fetch('/api/token', {
                    credentials: 'include'
                });

                const data = await res.json();
                console.log('TOKEN:', data);

                if (!res.ok || !data.accessToken) {
                    throw new Error(data.error || 'No access token');
                }

                cb(data.accessToken);
            } catch (err) {
                console.error('TOKEN FETCH ERROR:', err);
                cb('');
            }
        },
        volume: 0.8
    });

    state.player.addListener('ready', ({ device_id }) => {
        console.log('SDK READY, DEVICE:', device_id);
        state.deviceId = device_id;
        state.playerConnected = true;
    });

    state.player.addListener('not_ready', ({ device_id }) => {
        console.warn('SDK NOT READY:', device_id);
        if (state.deviceId === device_id) {
            state.deviceId = null;
        }
        state.playerConnected = false;
    });

    state.player.addListener('initialization_error', ({ message }) => {
        console.error('SDK INIT ERROR:', message);
    });

    state.player.addListener('authentication_error', ({ message }) => {
        console.error('SDK AUTH ERROR:', message);
    });

    state.player.addListener('account_error', ({ message }) => {
        console.error('SDK ACCOUNT ERROR:', message);
    });

    state.player.addListener('playback_error', ({ message }) => {
        console.error('SDK PLAYBACK ERROR:', message);
    });

    state.player.connect()
        .then(success => {
            console.log('PLAYER CONNECT RESULT:', success);
        })
        .catch(err => {
            console.error('PLAYER CONNECT FAILED:', err);
        });
}

window.onSpotifyWebPlaybackSDKReady = () => {
    console.log('SPOTIFY SDK READY');
    state.sdkReady = true;
    initSpotifyPlayer();
};

/* =========================
   SEARCH
========================= */
async function fetchSearch(query) {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        credentials: 'include'
    });

    if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`);
    }

    return res.json();
}

function renderSearchResults(results) {
    if (!el.searchResults) return;

    if (!results || results.length === 0) {
        renderError(el.searchResults, 'No search results. Try another query.');
        return;
    }

    el.searchResults.innerHTML = results.map(song => `
    <div class="search-item">
      <div class="search-item-info">
        <strong>${song.title}</strong>
        <span class="artist">by ${song.artist}</span>
        ${song.source ? `<div class="source">Source: ${song.source}</div>` : ''}
        ${song.preview_url
            ? `<div class="preview-label">Preview available</div>`
            : `<div class="preview-label no-preview">No preview available</div>`
        }
      </div>

      <div class="search-actions">
        ${song.preview_url ? `
          <button
            type="button"
            class="play-preview-btn"
            data-action="preview"
            data-id="${song.id}"
            data-preview="${encodeOrEmpty(song.preview_url)}"
            data-title="${encodeOrEmpty(song.title)}"
            data-artist="${encodeOrEmpty(song.artist)}"
          >
            Play preview
          </button>
        ` : ''}

        <button
          type="button"
          class="request-button"
          data-action="request"
          data-title="${encodeOrEmpty(song.title)}"
          data-artist="${encodeOrEmpty(song.artist)}"
          data-uri="${encodeOrEmpty(song.uri || '')}"
        >
          Request
        </button>
      </div>
    </div>
  `).join('');
}

if (el.searchButton) {
    el.searchButton.addEventListener('click', async () => {
        const query = el.searchInput?.value?.trim();
        if (!query) return;

        try {
            const results = await fetchSearch(query);
            renderSearchResults(results);
        } catch (err) {
            console.error('SEARCH ERROR:', err);
            renderError(el.searchResults, 'Search failed.');
        }
    });
}

if (el.searchInput) {
    el.searchInput.addEventListener('keypress', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            el.searchButton?.click();
        }
    });
}

/* =========================
   QUEUE / NOW PLAYING
========================= */
function renderQueue(queue) {
    if (!el.queueList) return;

    if (!queue || queue.length === 0) {
        el.queueList.innerHTML = '<p class="empty">No requests yet. Add a song to get started.</p>';
        return;
    }

    el.queueList.innerHTML = queue.map(item => `
    <div class="queue-item">
      <div class="queue-item-info">
        <strong>${item.title}</strong>
        <span class="artist">by ${item.artist}</span>
        <div class="meta">Requested by ${item.requestedBy}</div>
      </div>

      <div class="queue-item-actions">
        <button type="button" class="skip-button" data-id="${item.id}">Vote Skip</button>
        <span class="votes">Votes: ${item.votes}</span>
      </div>
    </div>
  `).join('');
}

function renderNowPlaying(track) {
    if (!el.nowPlaying) return;

    if (!track) {
        el.nowPlaying.innerHTML = '';
        return;
    }

    el.nowPlaying.innerHTML = `
    <div class="now-playing-card">
      <strong>Now Playing</strong>
      <div>${track.title || ''}</div>
      <div class="artist">${track.artist || ''}</div>
      ${track.requestedBy ? `<div class="meta">Requested by ${track.requestedBy}</div>` : ''}
    </div>
  `;
}

/* =========================
   PREVIEW PLAYER
========================= */
function playPreview(songId, previewUrl, title, artist) {
    if (!previewUrl) {
        renderError(el.previewPlayer, 'Preview not available for this track.');
        return;
    }

    if (state.previewTrackId === songId && state.previewAudio && !state.previewAudio.paused) {
        state.previewAudio.pause();
        if (el.previewPlayer) el.previewPlayer.innerHTML = '<p class="preview-paused">Paused</p>';
        return;
    }

    if (state.previewAudio) {
        state.previewAudio.pause();
        state.previewAudio = null;
    }

    const audio = new Audio(previewUrl);
    state.previewAudio = audio;
    state.previewTrackId = songId;

    if (el.previewPlayer) {
        el.previewPlayer.innerHTML = `
      <div class="preview-details">
        <strong>Preview</strong>
        <div>${title} <span class="artist">by ${artist}</span></div>
        <button type="button" id="togglePreviewBtn" class="pause-preview-btn">Pause</button>
      </div>
    `;
    }

    const toggleBtn = document.getElementById('togglePreviewBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            if (!state.previewAudio) return;
            if (state.previewAudio.paused) {
                state.previewAudio.play().catch(err => console.error('Preview play error:', err));
                toggleBtn.textContent = 'Pause';
            } else {
                state.previewAudio.pause();
                toggleBtn.textContent = 'Play';
            }
        });
    }

    audio.addEventListener('ended', () => {
        if (el.previewPlayer) el.previewPlayer.innerHTML = '<p class="preview-ended">Preview ended</p>';
    });

    audio.play().catch(error => {
        console.error('PREVIEW PLAY ERROR:', error);
        if (el.previewPlayer) {
            el.previewPlayer.innerHTML = `<p class="empty">Unable to play preview: ${error.message}</p>`;
        }
    });
}

/* =========================
   PLAY CURRENT QUEUE ITEM
========================= */
async function playCurrentTrack() {
    if (!state.isAuthenticated) {
        alert('Please login with Spotify first.');
        return;
    }

    if (!state.deviceId) {
        alert('Spotify player is not ready yet.');
        return;
    }

    if (!state.queue.length) {
        alert('Queue is empty. Add a song first.');
        return;
    }

    const track = state.queue[0];
    if (!track?.uri) {
        alert('This track has no Spotify URI.');
        return;
    }

    try {
        const res = await fetch('/api/play', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                trackUri: track.uri,
                deviceId: state.deviceId
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Failed to play track');
        }

        console.log('PLAY OK:', data);
    } catch (err) {
        console.error('PLAY ERROR:', err);
        alert(err.message);
    }
}

if (el.playButton) {
    el.playButton.addEventListener('click', playCurrentTrack);
}

/* =========================
   MANUAL REQUEST FORM
========================= */
if (el.manualForm) {
    el.manualForm.addEventListener('submit', event => {
        event.preventDefault();

        const title = el.songTitle?.value?.trim();
        const artist = el.songArtist?.value?.trim();
        const requestedBy = el.requestedBy?.value?.trim() || 'Guest';

        if (!title || !artist) return;

        socket.emit('requestSong', {
            title,
            artist,
            requestedBy
        });

        if (el.songTitle) el.songTitle.value = '';
        if (el.songArtist) el.songArtist.value = '';
        if (el.requestedBy) el.requestedBy.value = '';
    });
}

/* =========================
   SEARCH / QUEUE BUTTON CLICKS
========================= */
if (el.searchResults) {
    el.searchResults.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;

        const action = button.dataset.action;
        if (action === 'preview') {
            const songId = button.dataset.id;
            const previewUrl = decodeURIComponent(button.dataset.preview || '');
            const title = decodeURIComponent(button.dataset.title || '');
            const artist = decodeURIComponent(button.dataset.artist || '');

            playPreview(songId, previewUrl, title, artist);
        }

        if (action === 'request') {
            const title = decodeURIComponent(button.dataset.title || '');
            const artist = decodeURIComponent(button.dataset.artist || '');
            const uri = decodeURIComponent(button.dataset.uri || '');
            const requestedBy = el.requestedBy?.value?.trim() || 'Guest';

            socket.emit('requestSong', {
                title,
                artist,
                requestedBy,
                uri: uri || null
            });
        }
    });
}

if (el.queueList) {
    el.queueList.addEventListener('click', event => {
        const button = event.target.closest('button.skip-button');
        if (!button) return;

        const songId = button.dataset.id;
        socket.emit('voteSkip', songId);
    });
}

/* =========================
   SOCKET EVENTS
========================= */
socket.on('queueUpdated', queue => {
    state.queue = Array.isArray(queue) ? queue : [];
    renderQueue(state.queue);
});

socket.on('currentlyPlaying', track => {
    state.currentlyPlaying = track || null;
    renderNowPlaying(state.currentlyPlaying);
});

socket.on('viewerCount', count => {
    setText(el.viewerCount, `Viewers: ${count}`);
});

/* =========================
   INIT
========================= */
checkAuthStatus().then(() => {
    if (state.isAuthenticated) {
        updateAuthUI();
    }
});

fetch('/api/queue', {
    credentials: 'include'
})
    .then(res => res.json())
    .then(data => {
        state.queue = Array.isArray(data.queue) ? data.queue : [];
        state.currentlyPlaying = data.currentlyPlaying || null;
        renderQueue(state.queue);
        renderNowPlaying(state.currentlyPlaying);
    })
    .catch(err => {
        console.error('QUEUE INIT ERROR:', err);
    });

if (window.Spotify) {
    window.onSpotifyWebPlaybackSDKReady?.();
}