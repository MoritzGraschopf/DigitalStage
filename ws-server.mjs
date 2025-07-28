import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

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


        // Initiale Verbindung → conferenceId speichern
        if (msg.type === 'init') {
            ws.conferenceId = msg.conferenceId;
            console.log(`🎯 Client joined conference ${ws.conferenceId}`);
            return;
        }

        // Neue Chatnachricht
        if (msg.type === 'chatMessage') {
            if (!msg.message || !msg.userId || !ws.conferenceId || !msg.conferenceId || !msg.name) return;
            console.log(msg)
            // Nur an Clients mit derselben conferenceId senden
            wss.clients.forEach((client) => {
                if (
                    client.readyState === 1 && // WebSocket.OPEN === 1
                    client.conferenceId === ws.conferenceId
                ) {
                    client.send(
                        JSON.stringify({
                            type: "chatMessage",
                            message: msg.message,
                            user: {
                                id: msg.userId,
                                name: msg.name,
                            }})
                    );
                }
            });
        }
    });
});

server.listen(3001, () => {
    console.log('✅ WebSocket-Server läuft auf ws://localhost:3001');
});
