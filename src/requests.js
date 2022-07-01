const { randomBytes, createHash } = require('crypto');
const { createReadStream, existsSync, lstatSync } = require('fs');
const { parse } = require('querystring');
const { bold, green, blue } = require('./utils/colors.js');

const { Http2ServerResponse } = require('http2');
const { WebSocket } = require('./utils/websocket.js');

const contentTypes = {
    "html": "text/html; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "ico": "image/vnd.microsoft.icon; charset=utf-8",
    "ttf": "fonts/ttf; charset=utf-8"
};

const basePath = './src/frontend';

// createHash('sha256').update('').digest('hex')

/**
 * Handles an http request
 * @param {string} method
 * @param {string} path
 * @param {object} cookies
 * @param {string} data
 * @param {Http2ServerResponse} response
 */
const request = (method, path, cookies, data, response) => {
    if(method === 'GET' && path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        createReadStream(`${basePath}/index.html`).pipe(response);
        return;
    }

    if(path.includes('..') || !existsSync(`${basePath}/${path}`) || !lstatSync(`${basePath}/${path}`).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        createReadStream(`${basePath}/404.html`).pipe(response);
        return;
    }

    response.writeHead(200, { 'Content-Type': contentTypes[path.slice(path.lastIndexOf('.') + 1)] || 'text/plain; charset=utf-8' });
    createReadStream(`${basePath}/${path}`).pipe(response);
};

const webSockets = {};
const messagesToLoad = 35;
global.webSockets = webSockets;

global.updateClients = () => {
    for (const [x, ws] of Object.entries(webSockets)) {
        ws.send(JSON.stringify({
            type: 'reload',
        }));
    }
}

const websocket = (request, socket) => {
    if(request.url !== '/ws/' || (request.headers.upgrade || '').toLowerCase() !== 'websocket') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.end();
        return;
    }

    let webSocket = new WebSocket(socket, request.headers['sec-websocket-key'] || '');

    if (db.ipBans.includes(webSocket.getIp())) {
        webSocket.close();
        return;
    }

    console.log(bold(green(`New socket connected: ${webSocket.getIp()}`)));

    let webSocketId = randomBytes(8).toString('base64');
    webSocket.data = {
        sessionID: '',
        lastMessage: -2,
    };

    webSockets[webSocketId] = webSocket;

    webSocket.on('message', (message) => {
        const data = JSON.parse(message);

        if (webSocket.data.sessionID.length === 0 && data.type === 'connect') {
            if (data.sessionID && typeof data.sessionID === 'string' && data.sessionID.length > 0 && data.sessionID.length < 2048) {
                console.log(bold(blue(`[${webSocket.getIp()}] Socket provided sessionID: ${data.sessionID.slice(0, 100)}`)));

                if (db.sessions[data.sessionID]?.connected === true) {
                    webSocket.send(JSON.stringify({
                        type: 'connect-cb',
                        message: 'sessionID-already-online',
                    }));
                } else {
                    webSocket.data.sessionID = data.sessionID;
                    if (!db.sessions[data.sessionID]) {
                        db.sessions[data.sessionID] = {
                            username: '',
                            sessionIDHash: createHash('sha256').update(data.sessionID).digest('hex'),
                        };
                    }

                    if (db.sessions[data.sessionID].username.length < 3 || db.sessions[data.sessionID].username.length > 32) {
                        webSocket.send(JSON.stringify({
                            type: 'connect-cb',
                            message: 'request-username',
                        }));
                    } else {
                        webSocket.send(JSON.stringify({
                            type: 'connect-cb',
                            message: 'accepted',
                            username: db.sessions[data.sessionID].username,
                        }));
                    }

                    db.sessions[data.sessionID].connected = true;
                }
            }
        } else if (data.type === 'set-username') {
            if (data.username && typeof data.username === 'string' && data.username.length > 2 && data.username.length <= 32) {
                db.sessions[webSocket.data.sessionID].username = data.username;
                for (const [x, ws] of Object.entries(webSockets)) {
                    ws.send(JSON.stringify({
                        type: 'update-username',
                        sessionIDHash: db.sessions[webSocket.data.sessionID].sessionIDHash,
                        username: db.sessions[webSocket.data.sessionID].username,
                    }));
                }
            }
        } else if (db.sessions[webSocket.data.sessionID] && db.sessions[webSocket.data.sessionID].username.length > 2 && db.sessions[webSocket.data.sessionID].username.length <= 32) {
            if (data.type === 'get-session-id-hash') {
                if (data.sessionIDHash && typeof data.sessionIDHash === 'string') {
                    let found = false;
                    for (const session of Object.entries(db.sessions)) {
                        if (data.sessionIDHash === session[1].sessionIDHash) {
                            found = true;
                            webSocket.send(JSON.stringify({
                                type: 'update-username',
                                sessionIDHash: data.sessionIDHash,
                                username: session[1].username,
                            }));
                            break;
                        }
                    }

                    if (!found) {
                        webSocket.send(JSON.stringify({
                            type: 'update-username',
                            sessionIDHash: data.sessionIDHash,
                            username: '',
                        }));
                    }
                }
            } else if (data.type === 'get-messages') {
                if (webSocket.data.lastMessage === -2) webSocket.data.lastMessage = db.messages.length;

                let messagesToSend = [];
                if (webSocket.data.lastMessage !== -1) {
                    webSocket.data.lastMessage -= messagesToLoad
                    messagesToSend = db.messages.slice((webSocket.data.lastMessage < 0 ? 0 : webSocket.data.lastMessage), webSocket.data.lastMessage + messagesToLoad)
                    messagesToSend.reverse()
                    if (webSocket.data.lastMessage <= 0) webSocket.data.lastMessage = -1
                }

                webSocket.send(JSON.stringify({
                    type: 'load-messages',
                    messages: messagesToSend,
                }));
            } else if (data.type === 'send-message') {
                if (data.message && typeof data.message === 'string' && data.message.length > 0 && data.message.length <= 2000) {
                    const ts = Date.now();
                    const message = {
                        messageID: `${ts}-${randomBytes(8).toString('hex')}`,
                        ts,
                        message: data.message,
                        sessionIDHash: db.sessions[webSocket.data.sessionID].sessionIDHash,
                    };

                    if (message.message === '/ile') {
                        message.message = `Aktualna liczba wiadomości: ${db.messages.length}.`;
                        message.sessionIDHash = db.sessions['[Server]'].sessionIDHash;
                    }

                    db.messages.push(message);

                    for (const ws of Object.entries(webSockets)) {
                        if (db.sessions[ws[1].data.sessionID]?.username?.length > 0) {
                            ws[1].send(JSON.stringify({
                                type: 'new-message',
                                ...message,
                            }));
                        }
                    }
                }
            } else if (data.type === 'ping') {
                return;
            } else {
                webSocket.close();
            }
        } else if (data.type === 'ping') {
            return;
        } else {
            webSocket.close();
        }
    });

    webSocket.on('close', () => {
        if (db.sessions[webSocket.data.sessionID]) {
            db.sessions[webSocket.data.sessionID].connected = false;
        }

        delete webSockets[webSocketId];
    });
};

module.exports = { request, websocket };
