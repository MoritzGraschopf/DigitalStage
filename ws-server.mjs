import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

const inConference = new Map();
const notInConference = new Map();

wss.on('connection', (ws) => {
    console.log('🔌 Client connected');

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (err) {
            console.error('❌ Invalid JSON:', err);
            return;
        }

        if (msg.type === 'init') {
            if (msg.inConference) {
                if (notInConference.has(msg.userId)) notInConference.delete(msg.userId);
                inConference.set(msg.userId, msg.conferenceId);
            } else {
                if (inConference.has(msg.userId)) inConference.delete(msg.userId);
                notInConference.set(msg.userId, msg.conferenceId);
            }
            console.log(msg)
            return;
        }

        if (msg.type === 'conference') {
            wss.clients.forEach((client) => {
                client.
            })
        }
    });
});

server.listen(3001, () => {
    console.log('✅ WebSocket-Server läuft auf ws://localhost:3001');
});
