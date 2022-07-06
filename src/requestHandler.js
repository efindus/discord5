const { randomBytes, createHash } = require('crypto');
const { createReadStream, existsSync, lstatSync } = require('fs');
const { lstat } = require('fs/promises');

const { bold, green, blue } = require('./utils/colors.js');
const { WebSocket } = require('./utils/websocket.js');
const db = require('./utils/database');

const basePath = './src/frontend';
const attachmentsBasePath = './data';

// createHash('sha256').update('').digest('hex')
const endpoints = {};

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
				response.writeHead(200);
				createReadStream(filePath).pipe(response);
				return;
			}
		} catch {}
	}

	return404();
};

const webSockets = {};
const sessions = {
	'[Server]': {
		connected: true,
		sidHash: createHash('sha256').update('[Server]').digest('hex'),
	},
};
const messagesToLoad = 50;
global.webSockets = webSockets;

global.updateClients = () => {
	for (const [ x, ws ] of Object.entries(webSockets)) {
		ws.send(JSON.stringify({
			type: 'reload',
		}));
	}
};

const websocket = async (request, socket) => {
	if (request.url !== '/ws/' || (request.headers.upgrade || '').toLowerCase() !== 'websocket') {
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
	});

	webSocket.data = {
		session: null,
		lastMessage: 0,
	};

	const webSocketId = randomBytes(8).toString('base64');
	webSockets[webSocketId] = webSocket;
	console.log(`${bold(blue(`[${webSocket.getIp()}]`))} ${bold(green('Socket connected:'))} ${bold(blue(webSocketId))}`);

	webSocket.on('message', async (message) => {
		const data = JSON.parse(message);

		if (!webSocket.data.session && data.type === 'connect') {
			if (data.sid && typeof data.sid === 'string' && data.sid.length > 0 && data.sid.length < 2048) {
				console.log(`${bold(blue(`[${webSocket.getIp()}] (${webSocketId}):`))} ${bold(green(`Socket provided sessionID: ${data.sid.slice(0, 100)}`))}`);

				if (sessions[data.sid]?.connected === true) {
					webSocket.send(JSON.stringify({
						type: 'connect-cb',
						message: 'sessionID-already-online',
					}));
				} else {
					webSocket.data.session = await db.findOne('sessions', { sid: data.sid });
					if (!webSocket.data.session) {
						webSocket.data.session = {
							sid: data.sid,
							username: '',
							sidHash: createHash('sha256').update(data.sid).digest('hex'),
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

					sessions[data.sid] = {
						connected: true,
					};
				}
			}
		} else if (data.type === 'set-username') {
			if (data.username && typeof data.username === 'string' && data.username.length > 2 && data.username.length <= 32) {
				webSocket.data.session.username = data.username;
				await db.updateOne('sessions', { sid: webSocket.data.session.sid }, { username: data.username });

				for (const [ x, ws ] of Object.entries(webSockets)) {
					ws.send(JSON.stringify({
						type: 'update-username',
						sidHash: webSocket.data.session.sidHash,
						username: webSocket.data.session.username,
					}));
				}
			}
		} else if (webSocket.data.session && webSocket.data.session.username.length > 2 && webSocket.data.session.username.length <= 32) {
			if (data.type === 'get-session-id-hash') {
				if (data.sidHash && typeof data.sidHash === 'string') {
					const session = await db.findOne('sessions', { sidHash: data.sidHash });

					webSocket.send(JSON.stringify({
						type: 'update-username',
						sidHash: data.sidHash,
						username: session?.username ?? '',
					}));
				}
			} else if (data.type === 'get-messages') {
				let messagesToSend = [];
				if (webSocket.data.lastMessage !== -1) {
					messagesToSend = await db.findMany('messages', {}, { ts: -1 }, messagesToLoad, webSocket.data.lastMessage);
					if (messagesToSend.length < messagesToLoad) webSocket.data.lastMessage = -1;
					else webSocket.data.lastMessage += messagesToLoad;
				}

				webSocket.send(JSON.stringify({
					type: 'load-messages',
					messages: messagesToSend,
				}));
			} else if (data.type === 'send-message') {
				if (data.message && typeof data.message === 'string' && data.message.length > 0 && data.message.length <= 2000) {
					const ts = Date.now();
					const message = {
						id: `${ts}-${randomBytes(8).toString('hex')}`,
						ts,
						message: data.message,
						sidHash: webSocket.data.session.sidHash,
					};

					if (message.message === '/ile') {
						message.message = `Aktualna liczba wiadomości: ${await db.collectionLength('messages')}.`;
						message.sidHash = sessions['[Server]'].sidHash;
					}

					await db.insertOne('messages', message);

					for (const [ x, ws ] of Object.entries(webSockets)) {
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

		console.log(`${bold(blue(`[${webSocket.getIp()}]`))} ${bold(green('Socket disconnected:'))} ${bold(blue(webSocketId))}`);
		delete webSockets[webSocketId];
	});
};

module.exports = { request, websocket, addEndpoint };
