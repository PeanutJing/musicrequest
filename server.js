require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const axios = require('axios');
const querystring = require('querystring');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

const sampleSongs = [
    { id: '1', title: 'Blinding Lights', artist: 'The Weeknd', source: 'Local' },
    { id: '2', title: 'Levitating', artist: 'Dua Lipa', source: 'Local' },
    { id: '3', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', source: 'Local' },
    { id: '4', title: 'Shape of You', artist: 'Ed Sheeran', source: 'Local' },
    { id: '5', title: 'Can’t Stop', artist: 'Red Hot Chili Peppers', source: 'Local' },
    { id: '6', title: 'Bad Guy', artist: 'Billie Eilish', source: 'Local' },
    { id: '7', title: 'Senorita', artist: 'Shawn Mendes & Camila Cabello', source: 'Local' },
    { id: '8', title: 'Dancing Queen', artist: 'ABBA', source: 'Local' },
    { id: '9', title: 'Watermelon Sugar', artist: 'Harry Styles', source: 'Local' },
    { id: '10', title: 'Rolling in the Deep', artist: 'Adele', source: 'Local' }
];

const spotifyToken = {
    accessToken: null,
    expiresAt: 0
};

async function getSpotifyAccessToken() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return null;
    }

    if (spotifyToken.accessToken && Date.now() < spotifyToken.expiresAt - 60000) {
        return spotifyToken.accessToken;
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    const response = await axios.post('https://accounts.spotify.com/api/token', params.toString(), {
        headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    spotifyToken.accessToken = response.data.access_token;
    spotifyToken.expiresAt = Date.now() + response.data.expires_in * 1000;
    return spotifyToken.accessToken;
}

async function spotifySearch(query) {
    const token = await getSpotifyAccessToken();
    if (!token) {
        return null;
    }

    const response = await axios.get('https://api.spotify.com/v1/search', {
        headers: {
            Authorization: `Bearer ${token}`
        },
        params: {
            q: query,
            type: 'track',
            limit: 8
        }
    });

    if (!response.data || !response.data.tracks || !Array.isArray(response.data.tracks.items)) {
        return null;
    }

    return response.data.tracks.items.map(track => ({
        id: track.id,
        title: track.name,
        artist: track.artists.map(artist => artist.name).join(', '),
        album: track.album.name,
        preview_url: track.preview_url || null,
        uri: track.uri,
        source: 'Spotify'
    }));
}

let queue = [];
let nextQueueId = 1;
let connectedCount = 0;
let currentlyPlaying = null;
let spotifyAccessToken = null;

function broadcastQueue() {
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', currentlyPlaying);
}

app.get('/login', (req, res) => {
    const scopes = [
        'user-read-private',
        'user-read-email',
        'user-modify-playback-state',
        'user-read-playback-state'
    ];

    const authUrl = 'https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            client_id: SPOTIFY_CLIENT_ID,
            response_type: 'code',
            redirect_uri: REDIRECT_URI,
            scope: scopes.join(' ')
        });

    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        return res.status(400).send('No authorization code received.');
    }

    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code'
        }), {
            headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        req.session.spotifyAccessToken = response.data.access_token;
        req.session.spotifyRefreshToken = response.data.refresh_token;
        spotifyAccessToken = response.data.access_token;

        res.redirect('/?authenticated=true');
    } catch (error) {
        console.error('OAuth error:', error.message);
        res.status(500).send('Authentication failed.');
    }
});

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.spotifyAccessToken });
});

app.get('/api/queue', (req, res) => {
    res.json({ queue, currentlyPlaying });
});

app.post('/api/play', async (req, res) => {
    if (!req.session.spotifyAccessToken) {
        return res.status(401).json({ error: 'Not authenticated with Spotify.' });
    }

    const { trackUri } = req.body;

    if (!trackUri) {
        return res.status(400).json({ error: 'Track URI required.' });
    }

    try {
        await axios.put('https://api.spotify.com/v1/me/player/play', {
            uris: [trackUri]
        }, {
            headers: {
                'Authorization': `Bearer ${req.session.spotifyAccessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const firstItem = queue[0];
        if (firstItem) {
            currentlyPlaying = {
                title: firstItem.title,
                artist: firstItem.artist,
                requestedBy: firstItem.requestedBy
            };
            broadcastQueue();
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Playback error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to start playback.' });
    }
});

app.get('/api/devices', async (req, res) => {
    if (!req.session.spotifyAccessToken) {
        return res.status(401).json({ error: 'Not authenticated.' });
    }

    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/devices', {
            headers: {
                'Authorization': `Bearer ${req.session.spotifyAccessToken}`
            }
        });
        res.json(response.data.devices || []);
    } catch (error) {
        console.error('Devices error:', error.message);
        res.status(500).json({ error: 'Failed to get devices.' });
    }
});

app.post('/api/request', (req, res) => {
    const { title, artist, requestedBy, uri } = req.body;
    if (!title || !artist) {
        return res.status(400).json({ error: 'Song title and artist are required.' });
    }

    const newItem = {
        id: String(nextQueueId++),
        title,
        artist,
        requestedBy: requestedBy || 'Guest',
        uri: uri || null,
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

    let results = [];
    const normalized = query.toLowerCase();

    try {
        const spotifyResults = await spotifySearch(query);
        if (spotifyResults && spotifyResults.length > 0) {
            results = spotifyResults;
        }
    } catch (err) {
        console.error('Spotify search error:', err.message || err);
    }

    if (results.length === 0) {
        results = sampleSongs.filter(song => {
            return song.title.toLowerCase().includes(normalized) || song.artist.toLowerCase().includes(normalized);
        });
    }

    return res.json(results);
});

io.on('connection', socket => {
    connectedCount += 1;
    socket.emit('queueUpdated', queue);
    io.emit('viewerCount', connectedCount);

    socket.on('requestSong', payload => {
        const { title, artist, requestedBy, uri } = payload;
        if (!title || !artist) {
            return;
        }

        const newItem = {
            id: String(nextQueueId++),
            title,
            artist,
            requestedBy: requestedBy || 'Guest',
            uri: uri || null,
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
