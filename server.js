const express = require('express');
const http = require('http');
const path = require('path');
const https = require('https');
const { Server } = require('socket.io');
const ytSearch = require('yt-search');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;
const START_DELAY_MS = 1500;
const DEFAULT_DURATION_SEC = 180;
const LYRICS_CACHE_TTL_MS = 60 * 60 * 1000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =========================
   STATE
========================= */
let queue = [];
let current = null;
let viewers = 0;
let playIdCounter = 0;
let endTimer = null;

/* =========================
   LYRICS CACHE
========================= */
const lyricsCache = new Map();

/* =========================
   HELPERS
========================= */
function clearEndTimer() {
    if (endTimer) {
        clearTimeout(endTimer);
        endTimer = null;
    }
}

function durationMs(track) {
    const sec = Number(track?.duration || DEFAULT_DURATION_SEC);
    return Math.max(5, sec) * 1000;
}

function skipThreshold() {
    return Math.max(1, Math.ceil(viewers / 2));
}

function sanitizeTrack(track) {
    return {
        id: String(track.id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
        videoId: String(track.videoId || ''),
        title: String(track.title || ''),
        artist: String(track.artist || ''),
        thumbnail: String(track.thumbnail || ''),
        requestedBy: String(track.requestedBy || 'Guest'),
        votes: Number(track.votes || 0),
        voters: Array.isArray(track.voters) ? track.voters : [],
        source: String(track.source || 'YouTube'),
        duration: Number(track.duration || DEFAULT_DURATION_SEC),
        startedAt: Number(track.startedAt || 0),
        endsAt: Number(track.endsAt || 0),
        playId: Number(track.playId || 0)
    };
}

function emitState() {
    io.emit('viewerCount', viewers);
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', current);
}

function startCurrent() {
    clearEndTimer();

    if (!queue.length) {
        current = null;
        emitState();
        return;
    }

    current = sanitizeTrack(queue[0]);
    current.votes = 0;
    current.voters = [];
    current.startedAt = Date.now() + START_DELAY_MS;
    current.endsAt = current.startedAt + durationMs(current);
    current.playId = ++playIdCounter;

    queue[0] = current;

    emitState();

    const msUntilEnd = Math.max(0, current.endsAt - Date.now());
    endTimer = setTimeout(() => {
        advanceQueue();
    }, msUntilEnd);
}

function advanceQueue() {
    clearEndTimer();

    if (queue.length) {
        queue.shift();
    }

    if (!queue.length) {
        current = null;
        emitState();
        return;
    }

    startCurrent();
}

async function searchYoutube(query) {
    const result = await ytSearch(query);
    const videos = Array.isArray(result?.videos) ? result.videos : [];

    return videos.slice(0, 10).map(v => ({
        id: v.videoId,
        videoId: v.videoId,
        title: v.title || '',
        artist: v.author?.name || v.author?.username || '',
        thumbnail: v.thumbnail || v.image || '',
        duration: Number(v.seconds || DEFAULT_DURATION_SEC),
        source: 'YouTube'
    }));
}

async function resolveRequestedTrack(payload) {
    const data = payload || {};

    if (data.videoId && data.title) {
        return sanitizeTrack({
            id: data.id,
            videoId: data.videoId,
            title: data.title,
            artist: data.artist || '',
            thumbnail: data.thumbnail || '',
            requestedBy: data.requestedBy || 'Guest',
            duration: Number(data.duration || DEFAULT_DURATION_SEC),
            source: data.source || 'YouTube'
        });
    }

    const query = `${String(data.title || '').trim()} ${String(data.artist || '').trim()}`.trim();
    if (!query) return null;

    const results = await searchYoutube(query);
    if (!results.length) return null;

    const best = results[0];
    return sanitizeTrack({
        id: data.id,
        videoId: best.videoId,
        title: best.title,
        artist: best.artist,
        thumbnail: best.thumbnail,
        requestedBy: data.requestedBy || 'Guest',
        duration: best.duration || DEFAULT_DURATION_SEC,
        source: 'YouTube'
    });
}

function httpsGetJson(urlStr) {
    return new Promise(resolve => {
        try {
            const url = new URL(urlStr);

            const req = https.get(
                {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    protocol: url.protocol,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0'
                    }
                },
                res => {
                    let raw = '';
                    res.setEncoding('utf8');

                    res.on('data', chunk => {
                        raw += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            return resolve(null);
                        }

                        try {
                            resolve(JSON.parse(raw));
                        } catch {
                            resolve(null);
                        }
                    });
                }
            );

            req.on('error', () => resolve(null));
            req.setTimeout(5000, () => {
                req.destroy();
                resolve(null);
            });
        } catch {
            resolve(null);
        }
    });
}

async function lookupLyrics(title, artist) {
    const titleSafe = String(title || '').trim();
    const artistSafe = String(artist || '').trim();

    if (!titleSafe) return null;

    const cacheKey = `${titleSafe.toLowerCase()}|${artistSafe.toLowerCase()}`;
    const cached = lyricsCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < LYRICS_CACHE_TTL_MS) {
        return cached.data;
    }

    const qTitle = encodeURIComponent(titleSafe);
    const qArtist = encodeURIComponent(artistSafe);

    let data = await httpsGetJson(
        `https://lrclib.net/api/get?track_name=${qTitle}&artist_name=${qArtist}`
    );

    if (!data || (!data.syncedLyrics && !data.plainLyrics)) {
        const searchData = await httpsGetJson(
            `https://lrclib.net/api/search?track_name=${qTitle}&artist_name=${qArtist}`
        );

        if (Array.isArray(searchData) && searchData.length > 0) {
            data = searchData.find(item => item && (item.syncedLyrics || item.plainLyrics)) || searchData[0] || null;
        }
    }

    const normalized = data
        ? {
            synced: String(data.syncedLyrics || ''),
            plain: String(data.plainLyrics || ''),
            source: 'lrclib'
        }
        : {
            synced: '',
            plain: '',
            source: 'none'
        };

    lyricsCache.set(cacheKey, {
        savedAt: Date.now(),
        data: normalized
    });

    return normalized;
}

/* =========================
   API
========================= */
app.get('/api/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json([]);

    try {
        const results = await searchYoutube(query);
        return res.json(results);
    } catch (err) {
        console.error('SEARCH ERROR:', err.message || err);
        return res.json([]);
    }
});

app.get('/api/lyrics', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const artist = String(req.query.artist || '').trim();

    if (!title) {
        return res.json({ synced: '', plain: '', source: 'none' });
    }

    try {
        const data = await lookupLyrics(title, artist);
        return res.json(data || { synced: '', plain: '', source: 'none' });
    } catch (err) {
        console.error('LYRICS ERROR:', err.message || err);
        return res.json({ synced: '', plain: '', source: 'none' });
    }
});

app.get('/api/queue', (req, res) => {
    res.json({
        queue,
        currentlyPlaying: current,
        viewers,
        skipThreshold: skipThreshold()
    });
});

/* =========================
   SOCKET.IO
========================= */
io.on('connection', socket => {
    viewers += 1;
    emitState();

    socket.emit('queueUpdated', queue);
    socket.emit('currentlyPlaying', current);

    socket.on('requestSong', async payload => {
        try {
            const track = await resolveRequestedTrack(payload);
            if (!track) return;

            queue.push(track);

            if (!current) {
                startCurrent();
            } else {
                emitState();
            }
        } catch (err) {
            console.error('REQUEST SONG ERROR:', err.message || err);
        }
    });

    socket.on('voteSkip', songId => {
        try {
            if (!current || !queue.length) return;

            const first = queue[0];
            if (!first) return;
            if (String(first.id) !== String(songId)) return;

            if (!first.voters.includes(socket.id)) {
                first.voters.push(socket.id);
                first.votes = first.voters.length;

                if (first.votes >= skipThreshold()) {
                    advanceQueue();
                    return;
                }

                emitState();
            }
        } catch (err) {
            console.error('VOTE SKIP ERROR:', err.message || err);
        }
    });

    socket.on('disconnect', () => {
        viewers = Math.max(0, viewers - 1);

        for (const item of queue) {
            if (!Array.isArray(item.voters)) continue;
            const idx = item.voters.indexOf(socket.id);
            if (idx !== -1) {
                item.voters.splice(idx, 1);
                item.votes = item.voters.length;
            }
        }

        if (current && Array.isArray(current.voters)) {
            const idx = current.voters.indexOf(socket.id);
            if (idx !== -1) {
                current.voters.splice(idx, 1);
                current.votes = current.voters.length;
            }
        }

        emitState();
    });
});

/* =========================
   ERROR GUARDS
========================= */
process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', err => {
    console.error('UNHANDLED REJECTION:', err);
});

/* =========================
   START
========================= */
server.listen(PORT, () => {
    console.log(`Music room running on http://localhost:${PORT}`);
});