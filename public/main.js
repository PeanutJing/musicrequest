const socket = io();
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchResults = document.getElementById('searchResults');
const previewPlayer = document.getElementById('previewPlayer');
const queueList = document.getElementById('queueList');
const manualRequestForm = document.getElementById('manualRequestForm');
const songTitle = document.getElementById('songTitle');
const songArtist = document.getElementById('songArtist');
const requestedBy = document.getElementById('requestedBy');
const viewerCount = document.getElementById('viewerCount');
const loginButton = document.getElementById('loginButton');
const authStatus = document.getElementById('authStatus');
const playButton = document.getElementById('playButton');
const nowPlaying = document.getElementById('nowPlaying');
const playerBar = document.getElementById('playerBar');

let playingAudio = null;
let currentPreviewId = null;
let isAuthenticated = false;
let currentQueue = [];
let currentlyPlayingTrack = null;

async function checkAuthStatus() {
    const response = await fetch('/api/auth-status');
    const data = await response.json();
    isAuthenticated = data.authenticated;
    updateAuthUI();
}

function updateAuthUI() {
    if (isAuthenticated) {
        loginButton.style.display = 'none';
        authStatus.textContent = '✓ Connected to Spotify';
        playButton.style.display = 'block';
    } else {
        loginButton.style.display = 'inline-block';
        authStatus.textContent = '';
        playButton.style.display = 'none';
    }
}

loginButton.addEventListener('click', () => {
    window.location.href = '/login';
});

playButton.addEventListener('click', async () => {
    if (currentQueue.length === 0) {
        alert('Queue is empty. Add a song first.');
        return;
    }

    const trackUri = currentQueue[0].uri;
    if (!trackUri) {
        alert('Song does not have a Spotify URI.');
        return;
    }

    try {
        const response = await fetch('/api/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackUri })
        });
        const data = await response.json();
        if (!response.ok) {
            alert('Failed to play: ' + (data.error || 'Unknown error'));
        } else {
            alert('Now playing on Spotify!');
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
});

function renderNowPlaying(currentlyPlaying) {
    nowPlaying.innerHTML = '';
    if (currentlyPlaying) {
        nowPlaying.innerHTML = `
            <div class="now-playing-card">
                <strong>Now Playing on Spotify:</strong>
                <div>${currentlyPlaying.title}</div>
                <div class="artist">by ${currentlyPlaying.artist}</div>
                <div class="meta">Requested by ${currentlyPlaying.requestedBy}</div>
            </div>
        `;
    }
}

function renderPlayerBar() {
    if (currentPreviewId && playingAudio && !playingAudio.paused) {
        const duration = playingAudio.duration || 30;
        const current = playingAudio.currentTime || 0;
        const percent = (current / duration * 100).toFixed(1);

        playerBar.innerHTML = `
            <div class="mini-player">
                <div class="mini-player-info">
                    <span class="mini-player-title">Preview Playing</span>
                </div>
                <div class="mini-progress-bar">
                    <div class="mini-progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="mini-player-time">${Math.floor(current)}s / ${Math.floor(duration)}s</div>
            </div>
        `;
    } else {
        playerBar.innerHTML = '';
    }
}

function renderQueue(queue) {
    queueList.innerHTML = '';

    if (queue.length === 0) {
        queueList.innerHTML = '<p class="empty">No requests yet. Add a song to get started.</p>';
        return;
    }

    queue.forEach(item => {
        const entry = document.createElement('div');
        entry.className = 'queue-item';
        entry.innerHTML = `
      <div>
        <strong>${item.title}</strong> <span class="artist">by ${item.artist}</span>
        <div class="meta">Requested by ${item.requestedBy}</div>
      </div>
      <div class="actions">
        <button class="skip-button" data-id="${item.id}">Vote Skip</button>
        <span class="votes">Votes: ${item.votes}</span>
      </div>
    `;
        queueList.appendChild(entry);
    });
}

function renderSearchResults(results) {
    searchResults.innerHTML = '';

    if (results.length === 0) {
        searchResults.innerHTML = '<p class="empty">No search results. Try another query.</p>';
        return;
    }

    results.forEach(song => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `
      <div>
        <strong>${song.title}</strong> <span class="artist">by ${song.artist}</span>
        ${song.source ? `<div class="source">Source: ${song.source}</div>` : ''}
        ${song.preview_url ? `<div class="preview-label">Preview available</div>` : `<div class="preview-label no-preview">No preview available</div>`}
      </div>
      <div class="search-actions">
        ${song.preview_url ? `<button class="play-button" data-id="${song.id}" data-preview="${encodeURIComponent(song.preview_url)}" data-title="${encodeURIComponent(song.title)}" data-artist="${encodeURIComponent(song.artist)}">Play preview</button>` : ''}
        <button class="request-button" data-title="${encodeURIComponent(song.title)}" data-artist="${encodeURIComponent(song.artist)}" data-uri="${encodeURIComponent(song.uri || '')}">Request</button>
      </div>
    `;
        searchResults.appendChild(item);
    });
}

async function fetchSearch(query) {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    return response.json();
}

async function fetchQueue() {
    const response = await fetch('/api/queue');
    const data = await response.json();
    currentQueue = data.queue || [];
    currentlyPlayingTrack = data.currentlyPlaying;
    renderQueue(currentQueue);
    renderNowPlaying(currentlyPlayingTrack);
}

searchButton.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    const results = await fetchSearch(query);
    renderSearchResults(results);
});

searchInput.addEventListener('keypress', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        searchButton.click();
    }
});

manualRequestForm.addEventListener('submit', event => {
    event.preventDefault();
    const title = songTitle.value.trim();
    const artist = songArtist.value.trim();
    const requestedByValue = requestedBy.value.trim() || 'Guest';

    if (!title || !artist) return;

    socket.emit('requestSong', { title, artist, requestedBy: requestedByValue });
    songTitle.value = '';
    songArtist.value = '';
    requestedBy.value = '';
});

searchResults.addEventListener('click', event => {
    const button = event.target.closest('button.request-button');
    if (!button) return;
    const title = decodeURIComponent(button.dataset.title);
    const artist = decodeURIComponent(button.dataset.artist);
    const uri = decodeURIComponent(button.dataset.uri);
    const requestedByValue = requestedBy.value.trim() || 'Guest';

    socket.emit('requestSong', { title, artist, requestedBy: requestedByValue, uri: uri || null });
});

searchResults.addEventListener('click', event => {
    const button = event.target.closest('button.play-button');
    if (!button) return;

    const previewUrl = decodeURIComponent(button.dataset.preview);
    const title = decodeURIComponent(button.dataset.title);
    const artist = decodeURIComponent(button.dataset.artist);
    const songId = button.dataset.id;

    playPreview(songId, previewUrl, title, artist);
});

queueList.addEventListener('click', event => {
    const button = event.target.closest('button.skip-button');
    if (!button) return;
    const songId = button.dataset.id;
    socket.emit('voteSkip', songId);
});

socket.on('queueUpdated', queue => {
    renderQueue(queue);
});

function playPreview(songId, previewUrl, title, artist) {
    if (!previewUrl) {
        previewPlayer.innerHTML = '<p class="empty">Preview not available for this track.</p>';
        return;
    }

    if (currentPreviewId === songId && playingAudio && !playingAudio.paused) {
        playingAudio.pause();
        previewPlayer.innerHTML = `<p class="preview-paused">Paused</p>`;
        renderPlayerBar();
        return;
    }

    if (playingAudio) {
        playingAudio.pause();
    }

    playingAudio = new Audio(previewUrl);
    playingAudio.crossOrigin = 'anonymous';

    playingAudio.addEventListener('timeupdate', () => renderPlayerBar());
    playingAudio.addEventListener('ended', () => {
        previewPlayer.innerHTML = '<p class="preview-ended">Preview ended</p>';
        playerBar.innerHTML = '';
    });

    playingAudio.play().catch(error => {
        previewPlayer.innerHTML = `<p class="empty">Unable to play preview: ${error.message}</p>`;
    });
    currentPreviewId = songId;

    previewPlayer.innerHTML = `
    <div class="preview-details">
      <strong>Preview:</strong>
      <div>${title} <span class="artist">by ${artist}</span></div>
      <button class="pause-preview-btn" onclick="document.querySelector('#previewPlayer [onclick]') ? playingAudio.pause() : playingAudio.play()">Pause</button>
    </div>
  `;
}

socket.on('queueUpdated', data => {
    currentQueue = data;
    renderQueue(currentQueue);
});

socket.on('currentlyPlaying', data => {
    currentlyPlayingTrack = data;
    renderNowPlaying(currentlyPlayingTrack);
});

socket.on('viewerCount', count => {
    viewerCount.textContent = `Viewers: ${count}`;
});

checkAuthStatus();
fetchQueue();
