const express = require('express');
const http = require('http');
const path = require('path');
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

/* =========================
   HELPERS
========================= */
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
        startedAt: Number(track.startedAt || 0),
        playId: Number(track.playId || 0)
    };
}

function emitState() {
    io.emit('viewerCount', viewers);
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', current);
}

function startCurrent() {
    if (!queue.length) {
        current = null;
        io.emit('stop');
        emitState();
        return;
    }

    current = queue[0];
    current.votes = 0;
    current.voters = [];
    current.startedAt = Date.now();
    current.playId = ++playIdCounter;

    queue[0] = current;

    io.emit('play', current);
    emitState();
}

function advanceQueue() {
    if (queue.length) {
        queue.shift();
    }

    if (!queue.length) {
        current = null;
        io.emit('stop');
        emitState();
        return;
    }

    startCurrent();
}

function addToQueue(payload) {
    const item = sanitizeTrack(payload || {});
    if (!item.videoId || !item.title) return null;

    queue.push(item);

    if (!current) {
        startCurrent();
    } else {
        emitState();
    }

    return item;
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
        source: 'YouTube'
    }));
}

function currentSkipThreshold() {
    return Math.max(1, Math.ceil(viewers / 2));
}

/* =========================
   API
========================= */
app.get('/api/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
        return res.json([]);
    }

    try {
        const results = await searchYoutube(query);
        return res.json(results);
    } catch (err) {
        console.error('SEARCH ERROR:', err.message || err);
        return res.json([]);
    }
});

app.get('/api/queue', (req, res) => {
    res.json({
        queue,
        currentlyPlaying: current,
        viewers,
        skipThreshold: currentSkipThreshold()
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

    socket.on('requestSong', payload => {
        try {
            const added = addToQueue(payload);
            if (!added) return;
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

                const threshold = currentSkipThreshold();
                if (first.votes >= threshold) {
                    advanceQueue();
                    return;
                }

                emitState();
            }
        } catch (err) {
            console.error('VOTE SKIP ERROR:', err.message || err);
        }
    });

    socket.on('trackEnded', data => {
        try {
            if (!current) return;
            if (!data || Number(data.playId) !== Number(current.playId)) return;
            advanceQueue();
        } catch (err) {
            console.error('TRACK ENDED ERROR:', err.message || err);
        }
    });

    socket.on('disconnect', () => {
        viewers = Math.max(0, viewers - 1);

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