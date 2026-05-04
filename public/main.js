const socket = io();

let deviceId = null;
let player = null;

/* ================= AUTH ================= */
async function checkAuth() {
    const res = await fetch('/api/auth-status');
    const data = await res.json();

    console.log('AUTH:', data);

    if (!data.authenticated) {
        document.getElementById('loginButton').style.display = 'inline';
    }
}

/* ================= SPOTIFY SDK ================= */
window.onSpotifyWebPlaybackSDKReady = () => {
    console.log('SDK READY');

    player = new Spotify.Player({
        name: 'Web Player',
        getOAuthToken: async cb => {
            console.log('GET TOKEN');

            const res = await fetch('/api/token');
            const data = await res.json();

            console.log('TOKEN:', data);

            cb(data.accessToken);
        }
    });

    player.addListener('ready', ({ device_id }) => {
        console.log('DEVICE READY:', device_id);
        deviceId = device_id;
    });

    player.addListener('initialization_error', e => console.error(e));
    player.addListener('authentication_error', e => console.error(e));
    player.addListener('account_error', e => console.error(e));
    player.addListener('playback_error', e => console.error(e));

    player.connect();
};

/* ================= PLAY BUTTON ================= */
document.getElementById('playButton').onclick = async () => {
    console.log('CLICK PLAY');

    if (!deviceId) {
        alert('Device not ready');
        return;
    }

    const res = await fetch('/api/queue');
    const data = await res.json();

    if (!data.queue.length) {
        alert('Queue empty');
        return;
    }

    const track = data.queue[0];

    console.log('PLAY TRACK:', track);

    await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            trackUri: track.uri,
            deviceId
        })
    });
};

/* ================= SOCKET ================= */
socket.on('queueUpdated', q => {
    console.log('QUEUE:', q);

    const list = document.getElementById('queueList');
    list.innerHTML = q.map(s => `<div>${s.title}</div>`).join('');
});

/* ================= INIT ================= */
checkAuth();