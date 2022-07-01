const { randomBytes, createHash } = require('crypto');
const { createReadStream, existsSync, lstatSync } = require('fs');

const { bold, green, blue } = require('./utils/colors.js');
const { WebSocket } = require('./utils/websocket.js');
const db = require('./utils/database');

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
 * @param {import('http2').Http2ServerResponse} response
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
const sessions = {
	'[Server]': {
		connected: true,
	},
};
const messagesToLoad = 35;
global.webSockets = webSockets;

global.updateClients = () => {
    for (const [x, ws] of Object.entries(webSockets)) {
        ws.send(JSON.stringify({
            type: 'reload',
        }));
    }
}

const websocket = async (request, socket) => {
    if(request.url !== '/ws/' || (request.headers.upgrade || '').toLowerCase() !== 'websocket') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.end();
        return;
    }

    const webSocket = new WebSocket(socket, request.headers['sec-websocket-key'] || '');

	db.findOne('ipBans', { ip: webSocket.getIp() }).then(res => {
		if (res) {
			webSocket.close();
        	return;
		}
	})

    console.log(bold(green(`New socket connected: ${webSocket.getIp()}`)));

    webSocket.data = {
        session: null,
        lastMessage: 0,
    };

	const webSocketId = randomBytes(8).toString('base64');
    webSockets[webSocketId] = webSocket;

    webSocket.on('message', async (message) => {
        const data = JSON.parse(message);

        if (!webSocket.data.session && data.type === 'connect') {
            if (data.sessionID && typeof data.sessionID === 'string' && data.sessionID.length > 0 && data.sessionID.length < 2048) {
                console.log(bold(blue(`[${webSocket.getIp()}] Socket provided sessionID: ${data.sessionID.slice(0, 100)}`)));

                if (sessions[data.sessionID]?.connected === true) {
                    webSocket.send(JSON.stringify({
                        type: 'connect-cb',
                        message: 'sessionID-already-online',
                    }));
                } else {
					webSocket.data.session = await db.findOne('sessions', { sid: data.sessionID });
                    if (!webSocket.data.session) {
						webSocket.data.session = {
							sid: data.sessionID,
							username: '',
                            sidHash: createHash('sha256').update(data.sessionID).digest('hex'),
						};

						await db.insertOne('sessions', webSocket.data.session);
                    }

                    if (webSocket.data.session.username.length < 3 || webSocket.data.session.username.length > 32) {
                        webSocket.send(JSON.stringify({
                            type: 'connect-cb',
                            message: 'request-username',
                        }));
                    } else {
                        webSocket.send(JSON.stringify({
                            type: 'connect-cb',
                            message: 'accepted',
                            username: webSocket.data.session.username,
                        }));
                    }

                    sessions[data.sessionID] = {
						connected: true,
					};
                }
            }
        } else if (data.type === 'set-username') {
            if (data.username && typeof data.username === 'string' && data.username.length > 2 && data.username.length <= 32) {
				webSocket.data.session.username = data.username;
				await db.updateOne('sessions', { sid: webSocket.data.session.sid }, { username: data.username });

                for (const [x, ws] of Object.entries(webSockets)) {
                    ws.send(JSON.stringify({
                        type: 'update-username',
                        sessionIDHash: webSocket.data.session.sidHash,
                        username: webSocket.data.session.username,
                    }));
                }
            }
        } else if (webSocket.data.session && webSocket.data.session.username.length > 2 && webSocket.data.session.username.length <= 32) {
            if (data.type === 'get-session-id-hash') {
                if (data.sessionIDHash && typeof data.sessionIDHash === 'string') {
					const session = await db.findOne('sessions', { sidHash: data.sessionIDHash });

					webSocket.send(JSON.stringify({
						type: 'update-username',
						sessionIDHash: data.sessionIDHash,
						username: session?.username ?? '',
					}));
                }
            } else if (data.type === 'get-messages') {
				let messagesToSend = [];
				if (webSocket.data.lastMessage !== -1) {
					const messages = await db.findMany('messages', {}, messagesToLoad, webSocket.data.lastMessage, { ts: -1 });
					if (messages.length < messagesToLoad) webSocket.data.lastMessage = -1;
					else webSocket.data.lastMessage += messagesToLoad;

					messagesToSend = messages.map(msg => {
						return {
							messageID: msg.id,
							ts: msg.ts,
							message: msg.message,
							sessionIDHash: msg.sidHash,
						};
					});
					// messagesToSend.reverse();
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
                        sessionIDHash: webSocket.data.session.sidHash,
                    };

                    // if (message.message === '/ile') {
                    //     message.message = `Aktualna liczba wiadomości: ${db.messages.length}.`;
                    //     message.sessionIDHash = createHash('sha256').update('[Server]').digest('hex');
                    // }

					await db.insertOne('messages', {
						id: message.messageID,
						ts: message.ts,
						message: message.message,
						sidHash: message.sessionIDHash,
					});

                    for (const [x, ws] of Object.entries(webSockets)) {
                        if (ws.data.session?.username?.length > 0) {
                            ws.send(JSON.stringify({
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
		if (sessions[webSocket.data.session?.sid]) delete sessions[webSocket.data.session?.sid];

        delete webSockets[webSocketId];
    });
};

module.exports = { request, websocket };
