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
const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SESSION_SECRET
} = process.env;

const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/callback`;

/* ===================== MIDDLEWARE ===================== */
app.use(express.json());

app.use(session({
    secret: SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
}));

app.use(express.static(path.join(__dirname, 'public')));

/* ===================== MEMORY STORE ===================== */
let queue = [];
let nextQueueId = 1;
let connectedCount = 0;
let currentlyPlaying = null;

/* ===================== SPOTIFY TOKEN (APP) ===================== */
let appToken = { accessToken: null, expiresAt: 0 };

async function getAppToken() {
    if (appToken.accessToken && Date.now() < appToken.expiresAt - 60000) {
        return appToken.accessToken;
    }

    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const res = await axios.post('https://accounts.spotify.com/api/token',
        querystring.stringify({ grant_type: 'client_credentials' }),
        {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    appToken.accessToken = res.data.access_token;
    appToken.expiresAt = Date.now() + res.data.expires_in * 1000;

    return appToken.accessToken;
}

/* ===================== SPOTIFY SEARCH ===================== */
async function spotifySearch(query) {
    const token = await getAppToken();

    const res = await axios.get('https://api.spotify.com/v1/search', {
        headers: { Authorization: `Bearer ${token}` },
        params: { q: query, type: 'track', limit: 8 }
    });

    return res.data.tracks.items.map(track => ({
        id: track.id,
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        preview_url: track.preview_url,
        uri: track.uri,
        source: 'Spotify'
    }));
}

/* ===================== USER TOKEN ===================== */
async function refreshUserToken(req) {
    const refreshToken = req.session.spotifyRefreshToken;
    if (!refreshToken) return null;

    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const res = await axios.post('https://accounts.spotify.com/api/token',
        querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }),
        {
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    req.session.spotifyAccessToken = res.data.access_token;
    return res.data.access_token;
}

/* ===================== HELPER ===================== */
function broadcast() {
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', currentlyPlaying);
}

/* ===================== AUTH ===================== */
app.get('/login', (req, res) => {
    const scope = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-modify-playback-state',
        'user-read-playback-state'
    ].join(' ');

    const url = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope
    });

    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.sendStatus(400);

    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    try {
        const tokenRes = await axios.post('https://accounts.spotify.com/api/token',
            querystring.stringify({
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            }),
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        req.session.spotifyAccessToken = tokenRes.data.access_token;
        req.session.spotifyRefreshToken = tokenRes.data.refresh_token;

        res.redirect('/');
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.sendStatus(500);
    }
});

/* ===================== API ===================== */
app.get('/api/token', (req, res) => {
    if (!req.session.spotifyAccessToken) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    res.json({ accessToken: req.session.spotifyAccessToken });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.spotifyAccessToken });
});

app.get('/api/queue', (req, res) => {
    res.json({ queue, currentlyPlaying });
});

app.get('/api/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);

    try {
        const results = await spotifySearch(q);
        res.json(results);
    } catch {
        res.json([]);
    }
});

/* ===================== PLAY (สำคัญสุด) ===================== */
app.post('/api/play', async (req, res) => {
    let token = req.session.spotifyAccessToken;
    const { trackUri, deviceId } = req.body;

    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    if (!trackUri || !deviceId) return res.status(400).json({ error: 'Missing data' });

    try {
        // activate device ก่อน
        await axios.put('https://api.spotify.com/v1/me/player', {
            device_ids: [deviceId],
            play: false
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // play
        await axios.put(
            `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
            { uris: [trackUri] },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

    } catch (err) {
        // token expired → refresh
        if (err.response?.status === 401) {
            try {
                token = await refreshUserToken(req);

                await axios.put(
                    `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
                    { uris: [trackUri] },
                    { headers: { Authorization: `Bearer ${token}` } }
                );

            } catch (e) {
                return res.status(500).json({ error: 'Playback failed after refresh' });
            }
        } else {
            console.error(err.response?.data || err.message);
            return res.status(500).json({ error: 'Playback failed' });
        }
    }

    const current = queue.shift();
    if (current) {
        currentlyPlaying = current;
    }

    broadcast();
    res.json({ success: true });
});

/* ===================== SOCKET ===================== */
io.on('connection', socket => {
    connectedCount++;
    io.emit('viewerCount', connectedCount);

    socket.emit('queueUpdated', queue);

    socket.on('requestSong', data => {
        if (!data.title || !data.artist) return;

        queue.push({
            id: String(nextQueueId++),
            title: data.title,
            artist: data.artist,
            uri: data.uri || null,
            requestedBy: data.requestedBy || 'Guest',
            votes: 0,
            voters: []
        });

        broadcast();
    });

    socket.on('voteSkip', id => {
        const item = queue.find(q => q.id === id);
        if (!item) return;

        if (!item.voters.includes(socket.id)) {
            item.voters.push(socket.id);
            item.votes = item.voters.length;

            const threshold = Math.ceil(connectedCount / 2);
            if (item.votes >= threshold) {
                queue = queue.filter(q => q.id !== id);
            }

            broadcast();
        }
    });

    socket.on('disconnect', () => {
        connectedCount--;
        io.emit('viewerCount', connectedCount);
    });
});

/* ===================== START ===================== */
server.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
});