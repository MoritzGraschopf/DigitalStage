import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer();
const wss = new WebSocketServer({ server });

const inConference = new Map();
const notInConference = new Map();
const rtcRooms = new Map();

function getRoom(confId){
    if(!rtcRooms.has(confId))
        rtcRooms.set(confId, new Map());

    return rtcRooms.get(confId);
}

function safeSend(ws, obj){
    if(ws && ws.readyState === 1)
        ws.send(JSON.stringify(obj));
}

function broadcastRoom(confId, exceptUserId, payload){
    const room = rtcRooms.get(confId);
    if(!room)
        return;

    for(const [uid, socket] of room.entries()){
        if(uid === exceptUserId)
            continue;
        safeSend(socket, payload);
    }
}

wss.on('connection', (ws) => {
    console.log('🔌 Client connected');

    ws.on('close', () => {
        if(ws.userId && ws.conferenceId){
            const room = rtcRooms.get(ws.conferenceId);
            if(room && room.has(ws.userId)){
                room.delete(ws.userId);
                broadcastRoom(ws.conferenceId, ws.userId, {
                    type: 'webrtc:peer-left',
                    userId: ws.userId
                })
            }
        }
    })

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (err) {
            console.error('Invalid JSON:', err);
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
            ws.userId = msg.userId;
            console.log(msg)
            return;
        }

        if (msg.type === 'conference') {
            wss.clients.forEach((client) => {
                if(!client.userId) return
                if (notInConference.has(client.userId)) {
                    client.send(JSON.stringify({
                        type: 'server:conference',
                        id: msg.id,
                        title: msg.title,
                        description: msg.description,
                        startAt: msg.startAt,
                        endDate: msg.endDate,
                        status: msg.status,
                        link: msg.link,
                        organizerId: msg.organizerId,
                        participants: msg.participants,
                    }));
                }
            })
        }

        if (msg.type === 'chatMessage') {
            wss.clients.forEach((client) => {
                if(!client.userId) return
                if (inConference.has(client.userId) && inConference.get(client.userId) === msg.conferenceId) {
                    client.send(JSON.stringify({
                        type: 'server:chatMessage',
                        id: msg.id,
                        message: msg.message,
                        userId: msg.userId,
                        conferenceId: msg.conferenceId,
                        user: msg.user,
                    }))
                    console.log(msg)
                }
            })
        }

        if(msg.type === 'webrtc:join'){
            const {userId, conferenceId, role} = msg;
            ws.userId = userId;
            ws.conferenceId = conferenceId;

            if(role === 'VIEWER'){
                safeSend(ws, {type: 'server:use-hls', conferenceId});
                return;
            }

            const room = getRoom(conferenceId);
            room.set(userId, ws);

            safeSend(ws, {
               type: 'webrtc:peers',
               conferenceId,
               peers: Array.from(room.keys()).filter((id) => id !== userId)
            });

            broadcastRoom(conferenceId, userId, {
               type: 'webrtc:peer-joined',
               userId
            });
        }

        if(msg.type === 'webrtc:offer' ||
            msg.type === 'webrtc:answer' ||
            msg.type === 'webrtc:candidate'
        ){
            const {to, conferenceId} = msg;
            const room = rtcRooms.get(conferenceId);
            if(!room)
                return;
            const target = room.get(to);
            if(!target)
                return;
            safeSend(target, msg);
        }

        if(msg.type === 'webrtc:leave'){
            const {userId, conferenceId} = msg;
            const room = rtcRooms.get(conferenceId);
            if(room && room.has(userId)){
                room.delete(userId);
                broadcastRoom(conferenceId, userId, {
                   type: 'webrtc:peer-left',
                   userId
                });
            }
        }
    });
});

server.listen(3001, () => {
    console.log('✅ WebSocket-Server läuft auf ws://localhost:3001');
});