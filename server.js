require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const querystring = require('querystring');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(session({
    secret: 'dev-secret',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

/* ================= QUEUE ================= */
let queue = [];
let nextId = 1;
let connected = 0;

function broadcast() {
    io.emit('queueUpdated', queue);
}

/* ================= SPOTIFY LOGIN ================= */
app.get('/login', (req, res) => {
    const scope = 'streaming user-read-email user-modify-playback-state user-read-playback-state';

    const url = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
        client_id: process.env.SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: process.env.REDIRECT_URI,
        scope
    });

    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;

    try {
        const auth = Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
        ).toString('base64');

        const tokenRes = await axios.post('https://accounts.spotify.com/api/token',
            querystring.stringify({
                code,
                redirect_uri: process.env.REDIRECT_URI,
                grant_type: 'authorization_code'
            }),
            {
                headers: {
                    Authorization: 'Basic ' + auth,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        req.session.accessToken = tokenRes.data.access_token;

        console.log('LOGIN SUCCESS');

        res.redirect('/');
    } catch (err) {
        console.error('LOGIN ERROR', err.response?.data || err.message);
        res.send('Login error');
    }
});

/* ================= API ================= */

app.get('/api/token', (req, res) => {
    console.log('GET TOKEN');

    if (!req.session.accessToken) {
        console.log('NO TOKEN');
        return res.status(401).json({ error: 'Not logged in' });
    }

    res.json({ accessToken: req.session.accessToken });
});

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!req.session.accessToken });
});

app.get('/api/queue', (req, res) => {
    res.json({ queue });
});

/* ================= PLAY ================= */
app.post('/api/play', async (req, res) => {
    const { trackUri, deviceId } = req.body;

    console.log('PLAY REQUEST:', trackUri, deviceId);

    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    if (!deviceId) {
        return res.status(400).json({ error: 'No deviceId' });
    }

    try {
        await axios.put(
            `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
            { uris: [trackUri] },
            {
                headers: {
                    Authorization: `Bearer ${req.session.accessToken}`
                }
            }
        );

        console.log('PLAY SUCCESS');

        res.json({ success: true });
    } catch (err) {
        console.error('PLAY ERROR', err.response?.data || err.message);
        res.status(500).json({ error: 'Play failed' });
    }
});

/* ================= SOCKET ================= */
io.on('connection', socket => {
    connected++;
    io.emit('viewerCount', connected);

    socket.emit('queueUpdated', queue);

    socket.on('requestSong', data => {
        console.log('NEW REQUEST', data);

        queue.push({
            id: nextId++,
            title: data.title,
            artist: data.artist,
            uri: data.uri || null,
            votes: 0
        });

        broadcast();
    });

    socket.on('disconnect', () => {
        connected--;
        io.emit('viewerCount', connected);
    });
});

server.listen(PORT, () => {
    console.log('SERVER RUNNING:', PORT);
});