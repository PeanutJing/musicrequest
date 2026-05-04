const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

const sampleSongs = [
    { id: '1', title: 'Blinding Lights', artist: 'The Weeknd', source: 'Local', audioUrl: '/audio/blinding-lights.mp3' },
    { id: '2', title: 'Levitating', artist: 'Dua Lipa', source: 'Local', audioUrl: '/audio/levitating.mp3' },
    { id: '3', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', source: 'Local', audioUrl: '/audio/uptown-funk.mp3' },
    { id: '4', title: 'Shape of You', artist: 'Ed Sheeran', source: 'Local', audioUrl: '/audio/shape-of-you.mp3' },
    { id: '5', title: 'Can’t Stop', artist: 'Red Hot Chili Peppers', source: 'Local', audioUrl: '/audio/cant-stop.mp3' },
    { id: '6', title: 'Bad Guy', artist: 'Billie Eilish', source: 'Local', audioUrl: '/audio/bad-guy.mp3' },
    { id: '7', title: 'Senorita', artist: 'Shawn Mendes & Camila Cabello', source: 'Local', audioUrl: '/audio/senorita.mp3' },
    { id: '8', title: 'Dancing Queen', artist: 'ABBA', source: 'Local', audioUrl: '/audio/dancing-queen.mp3' },
    { id: '9', title: 'Watermelon Sugar', artist: 'Harry Styles', source: 'Local', audioUrl: '/audio/watermelon-sugar.mp3' },
    { id: '10', title: 'Rolling in the Deep', artist: 'Adele', source: 'Local', audioUrl: '/audio/rolling-in-the-deep.mp3' }
];

let queue = [];
let nextQueueId = 1;
let connectedCount = 0;
let currentlyPlaying = null;

function broadcastQueue() {
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', currentlyPlaying);
}

app.get('/api/queue', (req, res) => {
    res.json({ queue, currentlyPlaying });
});

app.post('/api/request', (req, res) => {
    const { title, artist, requestedBy, audioUrl } = req.body;
    if (!title || !artist) {
        return res.status(400).json({ error: 'Song title and artist are required.' });
    }

    const newItem = {
        id: String(nextQueueId++),
        title,
        artist,
        requestedBy: requestedBy || 'Guest',
        audioUrl: audioUrl || null,
        votes: 0,
        voters: []
    };

    queue.push(newItem);
    broadcastQueue();
    res.status(201).json(newItem);
});

app.get('/api/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) {
        return res.json([]);
    }

    const normalized = query.toLowerCase();

    const results = sampleSongs.filter(song => {
        return song.title.toLowerCase().includes(normalized) || song.artist.toLowerCase().includes(normalized);
    });

    return res.json(results);
});

app.post('/api/play', (req, res) => {
    if (queue.length === 0) {
        return res.status(400).json({ error: 'Queue is empty.' });
    }

    const firstItem = queue.shift();
    currentlyPlaying = {
        title: firstItem.title,
        artist: firstItem.artist,
        requestedBy: firstItem.requestedBy,
        audioUrl: firstItem.audioUrl
    };
    broadcastQueue();
    res.json({ success: true });
});

io.on('connection', socket => {
    connectedCount += 1;
    socket.emit('queueUpdated', queue);
    io.emit('viewerCount', connectedCount);

    socket.on('requestSong', payload => {
        const { title, artist, requestedBy, audioUrl } = payload;
        if (!title || !artist) {
            return;
        }

        const newItem = {
            id: String(nextQueueId++),
            title,
            artist,
            requestedBy: requestedBy || 'Guest',
            audioUrl: audioUrl || null,
            votes: 0,
            voters: []
        };
        queue.push(newItem);
        broadcastQueue();
    });

    socket.on('voteSkip', songId => {
        const item = queue.find(song => song.id === songId);
        if (!item || !socket.id) {
            return;
        }

        if (!item.voters.includes(socket.id)) {
            item.voters.push(socket.id);
            item.votes = item.voters.length;
            const skipThreshold = Math.max(1, Math.ceil(connectedCount / 2));

            if (item.votes >= skipThreshold) {
                queue = queue.filter(song => song.id !== songId);
            }
            broadcastQueue();
        }
    });

    socket.on('disconnect', () => {
        connectedCount = Math.max(0, connectedCount - 1);
        io.emit('viewerCount', connectedCount);
    });
});

server.listen(PORT, () => {
    console.log(`Music request app running on http://localhost:${PORT}`);
});
