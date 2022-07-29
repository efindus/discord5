const { randomBytes } = require('crypto');
const { createReadStream } = require('fs');
const { lstat, writeFile } = require('fs/promises');
const mime = require('mime');

const { bold, green, blue } = require('./colors.js');
const { WebSocket } = require('./websocket.js');
const db = require('./database');
const { getUser, validateNickname, regenerateJWTSecret, verifyLogin, setPassword } = require('./user');
const { ratelimitManager } = require('./ratelimit');

const basePath = './src/frontend';
const attachmentsBasePath = './data';
const PROTOCOL_VERSION = '1';
const SERVER_USER_UID = '691657194299387Server';

const endpoints = {};
const webSockets = {};
const messagesToLoad = 100;
global.webSockets = webSockets;

global.updateClients = () => {
	for (const [ x, ws ] of Object.entries(webSockets)) {
		ws.send(JSON.stringify({
			type: 'reload',
		}));
	}
};

const addEndpoint = (path, method, handler) => {
	if (!endpoints[path]) endpoints[path] = {};

	endpoints[path][method] = handler;
};

/**
 * @typedef RequestData
 * @property {"GET" | "POST" | "HEAD" | "PUT" | "DELETE" | "OPTIONS" | "PATCH"} method
 * @property {string} path
 * @property {import("url").URLSearchParams} parameters
 * @property {object | null} body
 * @property {Record<string, string>} cookies
 * @property {Record<string, string>} headers
 * @property {string} remoteAddress - IP address of the client
 */

/**
 * Handles an http request
 * @param {RequestData} request
 * @param {import('http2').Http2ServerResponse} response
 */
const request = async (request, response) => {
	const return404 = () => {
		response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
		createReadStream(`${basePath}/404.html`).pipe(response);
		return;
	};

	const endpoint = endpoints[request.path]?.[request.method];
	if (endpoints[request.path] && !endpoint) {
		response.writeHead(405);
		response.end();
		return;
	} else if (endpoint) {
		const result = await endpoint(request);
		if (result.headers) {
			for (const header in result.headers)
				response.setHeader(header, result.headers[header]);
		}

		let buffer;

		if (Buffer.isBuffer(result.body)) {
			buffer = result.body;
		} else if (typeof result.body === 'object') {
			buffer = Buffer.from(JSON.stringify(result.body));
			response.setHeader('Content-Type', 'application/json');
		}

		if (buffer)
			response.setHeader('Content-Length', buffer.length);

		response.writeHead(result.status);

		if (buffer)
			response.write(buffer);

		response.end();
		return;
	}

	if (request.method === 'GET') {
		if (request.path.includes('..')) return return404();

		let filePath = `${basePath}/index.html`;
		if (request.path.startsWith('/attachments')) {
			filePath = `${attachmentsBasePath}${request.path}`;
		} else if (request.path.startsWith('/static') || request.path === '/favicon.ico') {
			filePath = `${basePath}${request.path}`;
		} else if (request.path !== '/') return return404();

		try {
			const res = await lstat(filePath);
			if (res.isFile()) {
				let contentType = mime.getType(filePath);
				if (contentType === 'text/html' && request.path !== '/') contentType = 'text/plain';
				response.writeHead(200, {
					'Content-Type': contentType,
				});
				createReadStream(filePath).pipe(response);
				return;
			}
		} catch {}
	}

	return404();
};

const updateOnlineUsers = () => {
	const onlineUsers = {};
	for (const [ _, ws ] of Object.entries(webSockets)) {
		if (ws.data.user) {
			onlineUsers[ws.data.user.uid] = true;
		}
	}

	const uidArray = Object.entries(onlineUsers).map((val) => val[0]).sort();
	for (const [ _, ws ] of Object.entries(webSockets)) {
		if (ws.data.user) {
			ws.send(JSON.stringify({
				type: 'clientsOnline',
				clients: uidArray,
			}));
		}
	}
};

// TODO: attachment quotas
// TODO: static content quotas

// Per IP
ratelimitManager.create('authorizePacket', 15, 60_000); // Each request consumes one point, closes WS when limit is reached
ratelimitManager.create('getUserPacket', 120, 60_000); // Each request consumes one point, ignores packets when limit is reached
ratelimitManager.create('getMessagesPacket', 50, 60_000); // Each request consumes one point, ignores packets when limit is reached

// Per user
ratelimitManager.create('setNicknamePacket', 15, 60_000); // Each request consumes one point, ignores packets when limit is reached
ratelimitManager.create('sendMessagePacket', 20, 15_000); // Each request consumes one point, ignores packets when limit is reached
ratelimitManager.create('changePasswordPacket', 10, 60_000); // Each request consumes one point, ignores packets when limit is reached
ratelimitManager.create('logOutEverywherePacket', 5, 60_000); // Each request consumes one point, ignores packets when limit is reached

const websocket = async (request, socket) => {
	if (request.url !== '/ws/' || (request.headers.upgrade || '').toLowerCase() !== 'websocket') {
		socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
		socket.end();
		return;
	}

	const webSocket = new WebSocket(socket, request.headers['sec-websocket-key'] || '');

	webSocket.data = {
		user: null,
		lastMessage: 0,
	};

	webSockets[webSocket.id] = webSocket;
	console.log(`${bold(blue(`[${webSocket.getIp()}] (${webSocket.id}):`))} ${bold(green('Socket connected'))}`);

	webSocket.on('message', async (message) => {
		const data = JSON.parse(message);
		if (typeof data.pid !== 'string' && data.type !== 'ping') return;

		if (!webSocket.data.user) {
			if (data.type === 'authorize') {
				if (!ratelimitManager.consume('authorizePacket', webSocket.getIp())) return webSocket.close();

				if (typeof data.token === 'string') {
					const user = await getUser(data.token);

					if (user) {
						// TODO: handle user bans
						webSocket.data.user = user;
						console.log(`${bold(blue(`[${webSocket.getIp()}] (${webSocket.id}):`))} ${bold(green('Socket logged in:'))} ${bold(blue(webSocket.data.user.username))}`);

						webSocket.send(JSON.stringify({
							pid: data.pid,
							type: 'authorizeCB',
							message: 'accepted',
							user: {
								uid: user.uid,
								username: user.username,
								nickname: user.nickname,
							},
							serverTime: Date.now(),
							messagesToLoad: messagesToLoad,
							protocolVersion: PROTOCOL_VERSION,
						}));

						updateOnlineUsers();
					} else {
						webSocket.send(JSON.stringify({
							pid: data.pid,
							type: 'authorizeCB',
							message: 'invalidLogin',
						}));
					}
				}
			} else if (data.type !== 'ping') {
				webSocket.close();
			}
		} else {
			if (data.type === 'getUser') {
				if (!ratelimitManager.consume('getUserPacket', webSocket.getIp())) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('getUserPacket', webSocket.getIp()),
					}));
					return;
				}

				if (typeof data.uid === 'string') {
					const user = await db.findOne('users', { uid: data.uid });

					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'updateUser',
						uid: data.uid,
						username: user?.username ?? '',
						nickname: user?.nickname ?? '',
					}));
				}
			} else if (data.type === 'setNickname') {
				if (!ratelimitManager.consume('setNicknamePacket', webSocket.data.user.uid)) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('setNicknamePacket', webSocket.data.user.uid),
					}));
					return;
				}

				if (typeof data.nickname === 'string') {
					const result = await validateNickname(data.nickname);
					if (!result) {
						webSocket.data.user.nickname = data.nickname;
						await db.updateOne('users', { uid: webSocket.data.user.uid }, { nickname: data.nickname });

						for (const [ _, ws ] of Object.entries(webSockets)) {
							if (ws.data.user) {
								ws.send(JSON.stringify({
									type: 'updateNickname',
									uid: webSocket.data.user.uid,
									nickname: webSocket.data.user.nickname,
								}));
							}
						}
					} else {
						webSocket.send(JSON.stringify({
							pid: data.pid,
							type: 'updateNickname',
							uid: webSocket.data.user.uid,
							message: result,
						}));
					}
				}
			} else if (data.type === 'getMessages') {
				if (!ratelimitManager.consume('getMessagesPacket', webSocket.getIp())) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('getMessagesPacket', webSocket.getIp()),
					}));
					return;
				}

				let messagesToSend = [];
				if (webSocket.data.lastMessage !== -1) {
					messagesToSend = await db.findMany('messages', {}, { ts: -1 }, messagesToLoad, webSocket.data.lastMessage);
					if (messagesToSend.length < messagesToLoad) webSocket.data.lastMessage = -1;
					else webSocket.data.lastMessage += messagesToLoad;
				}

				webSocket.send(JSON.stringify({
					pid: data.pid,
					type: 'loadMessages',
					messages: messagesToSend,
				}));
			} else if (data.type === 'sendMessage') {
				if (!ratelimitManager.consume('sendMessagePacket', webSocket.data.user.uid)) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('sendMessagePacket', webSocket.data.user.uid),
					}));
					return;
				}

				if (typeof data.message === 'string' && data.message.length > 0 && data.message.length <= 2000 &&
					typeof data.nonce === 'string' && data.nonce.length > 0 && data.nonce.length < 52
				) {
					const ts = Date.now();
					const message = {
						id: `${ts}-${randomBytes(8).toString('hex')}`,
						ts,
						message: data.message,
						uid: webSocket.data.user.uid,
					};

					if (typeof data.attachment === 'object' &&
						typeof data.attachment.fileName === 'string' && data.attachment.fileName.length < 250 && data.attachment.fileName.indexOf('/') === -1 &&
						typeof data.attachment.data === 'string' && data.attachment.data.length <= 14900000
					) {
						message.attachment = `${message.id}-${data.attachment.fileName}`;
						await writeFile(`${attachmentsBasePath}/attachments/${message.attachment}`, Buffer.from(data.attachment.data, 'base64'));
					}

					if (message.message === '/ile') {
						message.message = `Aktualna liczba wiadomości: ${await db.collectionLength('messages')}.`;
						message.originalAuthor = message.uid;
						message.uid = SERVER_USER_UID;
						message.attachment = null;
					}

					await db.insertOne('messages', message);

					for (const [ _, ws ] of Object.entries(webSockets)) {
						if (ws.data.user) {
							if (ws === webSocket) {
								ws.send(JSON.stringify({
									pid: data.pid,
									type: 'newMessage',
									nonce: data.nonce,
									...message,
								}));
							} else {
								ws.send(JSON.stringify({
									type: 'newMessage',
									...message,
								}));
							}
						}
					}
				}
			} else if (data.type === 'changePassword') {
				if (!ratelimitManager.consume('changePasswordPacket', webSocket.data.user.uid)) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('changePasswordPacket', webSocket.data.user.uid),
					}));
					return;
				}

				if (typeof data.oldPassword === 'string' && typeof data.password === 'string') {
					if (verifyLogin(webSocket.data.user, data.oldPassword)) {
						await setPassword(webSocket.data.user.uid, data.password);
						await regenerateJWTSecret(webSocket.data.user.uid);
						webSocket.send(JSON.stringify({
							pid: data.pid,
							type: 'changePasswordCB',
							message: 'success',
						}));
						webSocket.close();
					} else {
						webSocket.send(JSON.stringify({
							pid: data.pid,
							type: 'changePasswordCB',
							message: 'invalidLogin',
						}));
					}
				}
			} else if (data.type === 'logOutEverywhere') {
				if (!ratelimitManager.consume('logOutEverywherePacket', webSocket.data.user.uid)) {
					webSocket.send(JSON.stringify({
						pid: data.pid,
						type: 'ratelimit',
						retryAfter: ratelimitManager.retryAfter('logOutEverywherePacket', webSocket.data.user.uid),
					}));
					return;
				}

				await regenerateJWTSecret(webSocket.data.user.uid);
				for (const [ _, ws ] of Object.entries(webSockets)) {
					if (ws.data.user?.uid === webSocket.data.user.uid) {
						ws.close();
					}
				}
			} else if (data.type !== 'ping') {
				webSocket.close();
			}
		}
	});

	webSocket.on('close', () => {
		console.log(`${bold(blue(`[${webSocket.getIp()}] (${webSocket.id}):`))} ${bold(green('Socket disconnected:'))} ${webSocket.data.user ? bold(blue(webSocket.data.user.username)) : ''}`);
		delete webSockets[webSocket.id];
		updateOnlineUsers();
	});

	webSocket.send(JSON.stringify({
		type: 'connectionReady',
	}));

	setTimeout(() => {
		if (!webSocket.data.user) webSocket.close();
	}, 10_000);
};

module.exports = { request, websocket, addEndpoint };
