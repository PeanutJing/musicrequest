require('dotenv').config();

const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const querystring = require('querystring');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const {
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SESSION_SECRET,
    REDIRECT_URI
} = process.env;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !REDIRECT_URI) {
    console.warn('Missing env vars: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, or REDIRECT_URI');
}

/* =========================
   TRUST PROXY FOR NGROK
========================= */
app.set('trust proxy', 1);

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(session({
    secret: SESSION_SECRET || 'dev-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,      // required for https/ngrok
        sameSite: 'none',   // required for cross-site cookie behavior
        httpOnly: true
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

/* =========================
   MEMORY STATE
========================= */
let queue = [];
let nextQueueId = 1;
let connectedCount = 0;
let currentlyPlaying = null;

/* =========================
   SAMPLE SONGS (fallback)
========================= */
const sampleSongs = [
    { id: '1', title: 'Blinding Lights', artist: 'The Weeknd', source: 'Local' },
    { id: '2', title: 'Levitating', artist: 'Dua Lipa', source: 'Local' },
    { id: '3', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', source: 'Local' },
    { id: '4', title: 'Shape of You', artist: 'Ed Sheeran', source: 'Local' },
    { id: '5', title: 'Can’t Stop', artist: 'Red Hot Chili Peppers', source: 'Local' },
    { id: '6', title: 'Bad Guy', artist: 'Billie Eilish', source: 'Local' },
    { id: '7', title: 'Señorita', artist: 'Shawn Mendes & Camila Cabello', source: 'Local' },
    { id: '8', title: 'Dancing Queen', artist: 'ABBA', source: 'Local' },
    { id: '9', title: 'Watermelon Sugar', artist: 'Harry Styles', source: 'Local' },
    { id: '10', title: 'Rolling in the Deep', artist: 'Adele', source: 'Local' }
];

/* =========================
   SPOTIFY APP TOKEN CACHE
========================= */
const appToken = {
    accessToken: null,
    expiresAt: 0
};

async function getAppAccessToken() {
    if (appToken.accessToken && Date.now() < appToken.expiresAt - 60_000) {
        return appToken.accessToken;
    }

    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        params.toString(),
        {
            headers: {
                Authorization: `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    appToken.accessToken = res.data.access_token;
    appToken.expiresAt = Date.now() + (res.data.expires_in * 1000);
    return appToken.accessToken;
}

async function spotifySearch(query) {
    const token = await getAppAccessToken();

    const res = await axios.get('https://api.spotify.com/v1/search', {
        headers: {
            Authorization: `Bearer ${token}`
        },
        params: {
            q: query,
            type: 'track',
            limit: 8
        }
    });

    const items = res.data?.tracks?.items || [];
    return items.map(track => ({
        id: track.id,
        title: track.name,
        artist: track.artists.map(a => a.name).join(', '),
        album: track.album?.name || '',
        preview_url: track.preview_url || null,
        uri: track.uri,
        source: 'Spotify'
    }));
}

/* =========================
   SESSION TOKEN HELPERS
========================= */
async function refreshSpotifyUserToken(req) {
    const refreshToken = req.session.spotifyRefreshToken;
    if (!refreshToken) {
        throw new Error('No refresh token in session');
    }

    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }),
        {
            headers: {
                Authorization: `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    req.session.spotifyAccessToken = res.data.access_token;
    req.session.spotifyAccessTokenExpiresAt = Date.now() + (res.data.expires_in * 1000);

    return req.session.spotifyAccessToken;
}

async function getValidUserToken(req) {
    const token = req.session.spotifyAccessToken;
    const expiresAt = req.session.spotifyAccessTokenExpiresAt || 0;

    if (token && Date.now() < expiresAt - 60_000) {
        return token;
    }

    if (req.session.spotifyRefreshToken) {
        return refreshSpotifyUserToken(req);
    }

    return null;
}

async function spotifyApiRequest(req, method, url, data = null, extraConfig = {}) {
    let token = await getValidUserToken(req);
    if (!token) {
        const err = new Error('Not authenticated with Spotify');
        err.statusCode = 401;
        throw err;
    }

    try {
        const res = await axios({
            method,
            url,
            data,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(extraConfig.headers || {})
            },
            ...extraConfig
        });

        return res;
    } catch (error) {
        if (error.response?.status === 401 && req.session.spotifyRefreshToken) {
            token = await refreshSpotifyUserToken(req);

            const retry = await axios({
                method,
                url,
                data,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...(extraConfig.headers || {})
                },
                ...extraConfig
            });

            return retry;
        }

        throw error;
    }
}

/* =========================
   BROADCAST
========================= */
function broadcastQueue() {
    io.emit('queueUpdated', queue);
    io.emit('currentlyPlaying', currentlyPlaying);
}

/* =========================
   AUTH ROUTES
========================= */
app.get('/login', (req, res) => {
    if (!SPOTIFY_CLIENT_ID || !REDIRECT_URI) {
        return res.status(500).send('Missing Spotify config.');
    }

    const scope = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state'
    ].join(' ');

    const authUrl = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: REDIRECT_URI,
        scope,
        show_dialog: true
    });

    res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
        console.error('Spotify callback error:', error);
        return res.status(400).send(`Spotify login denied: ${error}`);
    }

    if (!code) {
        return res.status(400).send('No authorization code received.');
    }

    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

    try {
        const tokenRes = await axios.post(
            'https://accounts.spotify.com/api/token',
            querystring.stringify({
                code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            }),
            {
                headers: {
                    Authorization: `Basic ${authHeader}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        req.session.spotifyAccessToken = tokenRes.data.access_token;
        req.session.spotifyRefreshToken = tokenRes.data.refresh_token;
        req.session.spotifyAccessTokenExpiresAt = Date.now() + (tokenRes.data.expires_in * 1000);

        console.log('OAuth success. Session set.');
        return res.redirect('/?authenticated=true');
    } catch (err) {
        console.error('OAuth FULL ERROR:', err.response?.data || err.message);
        return res.status(500).json({
            message: 'Authentication failed',
            error: err.response?.data || err.message
        });
    }
});

app.get('/api/auth-status', (req, res) => {
    res.json({
        authenticated: !!req.session.spotifyAccessToken
    });
});

app.get('/api/token', async (req, res) => {
    try {
        const token = await getValidUserToken(req);

        if (!token) {
            console.log('GET TOKEN -> NO TOKEN');
            return res.status(401).json({ error: 'Not logged in' });
        }

        console.log('GET TOKEN -> OK');
        return res.json({ accessToken: token });
    } catch (err) {
        console.error('TOKEN ERROR:', err.message);
        return res.status(500).json({ error: 'Failed to get token' });
    }
});

/* =========================
   DATA ROUTES
========================= */
app.get('/api/queue', (req, res) => {
    res.json({ queue, currentlyPlaying });
});

app.get('/api/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json([]);

    const normalized = query.toLowerCase();

    try {
        const spotifyResults = await spotifySearch(query);
        if (spotifyResults?.length) {
            return res.json(spotifyResults);
        }
    } catch (err) {
        console.error('Spotify search error:', err.response?.data || err.message);
    }

    const fallback = sampleSongs.filter(song =>
        song.title.toLowerCase().includes(normalized) ||
        song.artist.toLowerCase().includes(normalized)
    );

    return res.json(fallback);
});

/* =========================
   PLAY ROUTE
========================= */
app.post('/api/play', async (req, res) => {
    const { trackUri, deviceId } = req.body || {};

    console.log('PLAY REQUEST:', { trackUri, deviceId });

    if (!trackUri) {
        return res.status(400).json({ error: 'Track URI required.' });
    }

    if (!deviceId) {
        return res.status(400).json({ error: 'deviceId required.' });
    }

    try {
        const playRes = await spotifyApiRequest(
            req,
            'PUT',
            `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
            {
                uris: [trackUri]
            }
        );

        console.log('PLAY OK:', playRes.status);

        const nextItem = queue.shift();
        if (nextItem) {
            currentlyPlaying = {
                title: nextItem.title,
                artist: nextItem.artist,
                requestedBy: nextItem.requestedBy,
                uri: nextItem.uri || null
            };
        } else {
            currentlyPlaying = {
                title: 'Playing from Spotify',
                artist: '',
                requestedBy: ''
            };
        }

        broadcastQueue();
        return res.json({ success: true });
    } catch (err) {
        console.error('PLAY ERROR:', err.response?.data || err.message);
        return res.status(err.statusCode || 500).json({
            error: 'Failed to start playback.',
            details: err.response?.data || err.message
        });
    }
});

/* =========================
   OPTIONAL: DEVICES
========================= */
app.get('/api/devices', async (req, res) => {
    try {
        const r = await spotifyApiRequest(req, 'GET', 'https://api.spotify.com/v1/me/player/devices');
        return res.json(r.data.devices || []);
    } catch (err) {
        console.error('DEVICES ERROR:', err.response?.data || err.message);
        return res.status(err.statusCode || 500).json({
            error: 'Failed to get devices.',
            details: err.response?.data || err.message
        });
    }
});

/* =========================
   REQUEST ROUTE
========================= */
app.post('/api/request', (req, res) => {
    const { title, artist, requestedBy, uri } = req.body || {};

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
    return res.status(201).json(newItem);
});

/* =========================
   SOCKET.IO
========================= */
io.on('connection', socket => {
    connectedCount += 1;
    io.emit('viewerCount', connectedCount);

    socket.emit('queueUpdated', queue);
    socket.emit('currentlyPlaying', currentlyPlaying);

    socket.on('requestSong', payload => {
        const { title, artist, requestedBy, uri } = payload || {};
        if (!title || !artist) return;

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
        if (!item) return;

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

/* =========================
   START SERVER
========================= */
server.listen(PORT, () => {
    console.log(`Music request app running on http://localhost:${PORT}`);
});