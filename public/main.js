const socket = io();

/* ===================== DOM ===================== */
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

/* ===================== STATE ===================== */
let state = {
    isAuthenticated: false,
    queue: [],
    currentlyPlaying: null,
    previewAudio: null,
    previewId: null,
    deviceId: null,
    player: null
};

/* ===================== AUTH ===================== */
async function checkAuth() {
    const res = await fetch('/api/auth-status');
    const data = await res.json();
    state.isAuthenticated = data.authenticated;
    updateAuthUI();
}

function updateAuthUI() {
    el.loginButton.style.display = state.isAuthenticated ? 'none' : 'inline-block';
    el.authStatus.textContent = state.isAuthenticated ? '✓ Connected to Spotify' : '';
    el.playButton.style.display = state.isAuthenticated ? 'block' : 'none';
}

el.loginButton.onclick = () => location.href = '/login';

/* ===================== SPOTIFY SDK ===================== */
window.onSpotifyWebPlaybackSDKReady = () => {
    state.player = new Spotify.Player({
        name: 'Web Music Player',
        getOAuthToken: async cb => {
            const res = await fetch('/api/token');
            const data = await res.json();
            cb(data.accessToken);
        },
        volume: 0.5
    });

    state.player.addListener('ready', ({ device_id }) => {
        console.log('Spotify Ready:', device_id);
        state.deviceId = device_id;
    });

    state.player.addListener('player_state_changed', s => {
        if (!s) return;

        const current = s.track_window.current_track;
        if (current) {
            renderNowPlaying({
                title: current.name,
                artist: current.artists.map(a => a.name).join(', ')
            });
        }
    });

    state.player.connect();
};

/* ===================== PLAY ===================== */
el.playButton.onclick = async () => {
    if (!state.queue.length) return alert('Queue empty');

    const track = state.queue[0];
    if (!track.uri) return alert('No Spotify URI');

    try {
        await fetch('/api/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trackUri: track.uri,
                deviceId: state.deviceId
            })
        });
    } catch (err) {
        alert(err.message);
    }
};

/* ===================== SEARCH ===================== */
async function search(q) {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    return res.json();
}

el.searchButton.onclick = async () => {
    const q = el.searchInput.value.trim();
    if (!q) return;
    renderSearch(await search(q));
};

el.searchInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') el.searchButton.click();
});

/* ===================== RENDER ===================== */
function renderSearch(list) {
    if (!list.length) {
        el.searchResults.innerHTML = '<p>No results</p>';
        return;
    }

    el.searchResults.innerHTML = list.map(s => `
        <div class="search-item">
            <div>
                <strong>${s.title}</strong> by ${s.artist}
            </div>
            <div>
                ${s.preview_url ? `<button data-action="preview" data-id="${s.id}" data-url="${encodeURIComponent(s.preview_url)}">Preview</button>` : ''}
                <button data-action="request" 
                    data-title="${encodeURIComponent(s.title)}" 
                    data-artist="${encodeURIComponent(s.artist)}"
                    data-uri="${encodeURIComponent(s.uri || '')}">
                    Request
                </button>
            </div>
        </div>
    `).join('');
}

function renderQueue() {
    if (!state.queue.length) {
        el.queueList.innerHTML = '<p>No songs</p>';
        return;
    }

    el.queueList.innerHTML = state.queue.map(q => `
        <div class="queue-item">
            <div>
                <strong>${q.title}</strong> by ${q.artist}
            </div>
            <div>
                <button data-skip="${q.id}">Skip</button>
                <span>${q.votes}</span>
            </div>
        </div>
    `).join('');
}

function renderNowPlaying(track) {
    if (!track) {
        el.nowPlaying.innerHTML = '';
        return;
    }

    el.nowPlaying.innerHTML = `
        <div>
            <strong>Now Playing</strong><br/>
            ${track.title}<br/>
            ${track.artist}
        </div>
    `;
}

/* ===================== PREVIEW ===================== */
function playPreview(id, url) {
    if (state.previewId === id && state.previewAudio) {
        state.previewAudio.pause();
        state.previewId = null;
        return;
    }

    if (state.previewAudio) state.previewAudio.pause();

    const audio = new Audio(url);
    audio.play();

    state.previewAudio = audio;
    state.previewId = id;
}

/* ===================== EVENTS ===================== */
el.searchResults.onclick = e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.dataset.action === 'preview') {
        playPreview(btn.dataset.id, decodeURIComponent(btn.dataset.url));
    }

    if (btn.dataset.action === 'request') {
        socket.emit('requestSong', {
            title: decodeURIComponent(btn.dataset.title),
            artist: decodeURIComponent(btn.dataset.artist),
            uri: decodeURIComponent(btn.dataset.uri),
            requestedBy: el.requestedBy.value || 'Guest'
        });
    }
};

el.queueList.onclick = e => {
    const id = e.target.dataset.skip;
    if (id) socket.emit('voteSkip', id);
};

el.manualForm.onsubmit = e => {
    e.preventDefault();

    socket.emit('requestSong', {
        title: el.songTitle.value,
        artist: el.songArtist.value,
        requestedBy: el.requestedBy.value || 'Guest'
    });

    el.songTitle.value = '';
    el.songArtist.value = '';
};

/* ===================== SOCKET ===================== */
socket.on('queueUpdated', q => {
    state.queue = q;
    renderQueue();
});

socket.on('currentlyPlaying', t => {
    state.currentlyPlaying = t;
    renderNowPlaying(t);
});

socket.on('viewerCount', c => {
    el.viewerCount.textContent = `Viewers: ${c}`;
});

/* ===================== INIT ===================== */
checkAuth();
fetch('/api/queue')
    .then(r => r.json())
    .then(d => {
        state.queue = d.queue || [];
        renderQueue();
    });