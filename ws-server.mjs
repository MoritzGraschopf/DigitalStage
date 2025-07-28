// ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('🟢 Client connected');

    ws.on('message', async (data) => {
        const msg = JSON.parse(data.toString());

        // Beispiel-Datenvalidierung
        if (!msg.message || !msg.userId || !msg.conferenceId || !msg.name) return;

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "chatMessage",
                    message: msg.message,
                    user: {
                        id: msg.userId,
                        name: msg.name,
                    }
                }));
            }
        });
    });

    ws.on('close', () => {
        console.log('❌ Client disconnected');
    });
});

server.listen(3001, () => {
    console.log('✅ WebSocket-Server läuft auf ws://localhost:3001');
});
