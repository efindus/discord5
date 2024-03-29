const EventEmitter = require('events');
const { createHash, randomBytes } = require('crypto');

const { ipv6tov4 } = require('./ip');
const { logger } = require('./logger');
const { blue, bold, green } = require('./colors');
const { PROTOCOL_VERSION, MAX_MESSAGE_LENGTH, MESSAGES_TO_LOAD, MAX_WS_BUFFER_SIZE } = require('../config');

module.exports.WebSocket = class extends EventEmitter {
	/**
	 * @type {import('net').Socket}
	 */
	#socket;
	/**
	 * @type {string}
	 */
	#id;
	#closed = false;

	/**
	 * @param {import('net').Socket} socket Socket.
	 * @param {string} webSocketKey WS key.
	 */
	constructor(socket, webSocketKey) {
		super();

		this.#socket = socket;
		this.#id = randomBytes(8).toString('base64');

		socket.on('error', (/** @type {any} */error) => {
			if (![ 'ETIMEDOUT', 'EPIPE', 'ECONNRESET', 'EHOSTUNREACH' ].includes(error.code))
				console.log(error);
		});

		socket.write([
			'HTTP/1.1 101 Switching Protocols',
			'Upgrade: WebSocket',
			'Connection: Upgrade',
			`Sec-WebSocket-Accept: ${createHash('sha1').update(`${webSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')}`,
			'',
			'',
		].join('\r\n'));

		socket.setTimeout(2 * 60_000);

		let inputBuffer = Buffer.alloc(0);
		let messageBuffer = Buffer.alloc(0);
		let isBinary = true;

		socket.on('data', data => {
			inputBuffer = Buffer.concat([ inputBuffer, data ]);
			if (inputBuffer.length > MAX_WS_BUFFER_SIZE) {
				this.close();
				return;
			}

			try {
				do {
					if (inputBuffer.length <= 2)
						return;

					let start = 2;
					let length = inputBuffer[1] & 0b01111111;

					if (length === 126) {
						if (inputBuffer.length < 4)
							return;

						length = inputBuffer.readUInt16BE(2);
						start = 4;
					} else if (length === 127) {
						if (inputBuffer.length < 10)
							return;

						const len = inputBuffer.readBigUInt64BE(2);
						if (len > 15_000_000) {
							this.close();
							return;
						} else {
							length = +len.toString();
						}

						start = 10;
					}

					const mask = Buffer.alloc(4);

					if (!(inputBuffer[1] & 0b10000000)) {
						this.close();
						return;
					}

					if (inputBuffer.length < start + 4)
						return;

					for (let index = 0; index < 4; index++)
						mask[index] = inputBuffer[start + index];

					start += 4;

					if (inputBuffer.length < start + length)
						return;

					const message = Buffer.alloc(length);

					for (let index = 0; index < length; index++)
						message[index] = inputBuffer[start + index] ^ mask[index % 4];

					switch (inputBuffer[0] & 0b00001111) {
						case 0: {
							messageBuffer = Buffer.concat([ messageBuffer, message ]);

							if (inputBuffer[0] & 0b10000000) {
								this.emit('message', messageBuffer.toString(isBinary ? 'binary' : 'utf-8'));

								messageBuffer = Buffer.alloc(0);
								isBinary = true;
							}

							break;
						}

						case 1: {
							if (inputBuffer[0] & 0b10000000) {
								this.emit('message', message.toString('utf-8'));

								messageBuffer = Buffer.alloc(0);
								isBinary = true;
							} else {
								messageBuffer = message;
								isBinary = false;
							}

							break;
						}

						case 2: {
							if (inputBuffer[0] & 0b10000000) {
								this.emit('message', message.toString('binary'));

								messageBuffer = Buffer.alloc(0);
								isBinary = true;
							} else {
								messageBuffer = message;
								isBinary = true;
							}

							break;
						}

						case 8: {
							this.send('', 8);
							socket.end();

							break;
						}

						case 9: {
							this.send('', 10);
							break;
						}

						default: {
							throw new Error(`Unsupported code: ${inputBuffer[0] & 0b00001111}`);
						}
					}

					inputBuffer = Buffer.from(Uint8Array.prototype.slice.call(inputBuffer, start + length));
				} while (inputBuffer.length > 0);
			} catch (error) {
				console.log(error);
			}
		});

		socket.on('close', () => {
			this.#closed = true;
			this.emit('close');
		});

		socket.on('timeout', () => {
			this.close();
		});
	}

	/**
	 * Sends a message to a WebSocket.
	 * @param {string} message Message.
	 * @param {number} code Message code.
	 */
	send = (message, code = 1) => {
		if (this.#closed || !this.#socket.writable)
			return;

		const buf = Buffer.from(message);
		let header;

		if (buf.length <= 125) {
			header = Buffer.alloc(2);
			header[1] = buf.length;
		} else if (buf.length < 65536) {
			header = Buffer.alloc(4);
			header[1] = 126;
			header.writeUInt16BE(buf.length, 2);
		} else {
			header = Buffer.alloc(10);
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(buf.length), 2);
		}

		header[0] = 0b10000000 | code;
		this.#socket.write(Buffer.concat([ header, buf ]));
	};

	/**
	 * ID of the WebSocket
	 */
	get id() {
		return this.#id;
	}

	get ip() {
		return ipv6tov4(this.#socket.remoteAddress);
	}

	/**
	 * Close the socket
	 */
	close = () => {
		this.#closed = true;
		this.#socket.destroy();
	};
};

class WebSocketManager {
	/**
	 * @type {Record<string, import('./websocket').WebSocket>}
	 */
	#webSockets = {};

	/**
	 * @type {Record<string, { uid: string, token: string }>}
	 */
	#webSocketData = {};

	/**
	 * @param {import('net').Socket} socket
	 * @param {string} secSocketKey
	 * @param {string} uid
	 * @param {string} token
	 * @param {() => any} onClose
	 */
	create(socket, secSocketKey, uid, token, onClose) {
		const ws = new module.exports.WebSocket(socket, secSocketKey);
		logger.info(`${bold(blue(`[${ws.ip}] (${ws.id}):`))} ${bold(green('Socket logged in:'))} ${bold(blue(uid))}`);

		this.#webSockets[ws.id] = ws;
		this.#webSocketData[ws.id] = { uid, token };

		ws.on('message', (message) => {
			if (message !== 'ping')
				ws.close();
		});

		ws.on('close', () => {
			delete this.#webSockets[ws.id];
			delete this.#webSocketData[ws.id];

			logger.info(`${bold(blue(`[${ws.ip}] (${ws.id}):`))} ${bold(green('Socket disconnected:'))} ${bold(blue(uid))}`);
			onClose();
		});

		ws.send(JSON.stringify({
			packet: 'ready',
			serverTime: Date.now(),
			messagesToLoad: MESSAGES_TO_LOAD,
			maxMessageLength: MAX_MESSAGE_LENGTH,
			protocolVersion: PROTOCOL_VERSION,
		}));
	}

	/**
	 * @param {string} uid
	 */
	close(uid) {
		for (const key in this.#webSocketData) {
			if (this.#webSocketData[key].uid === uid)
				this.#webSockets[key].close();
		}
	}

	/**
	 * @param {string} token
	 */
	closeToken(token) {
		for (const key in this.#webSocketData) {
			if (this.#webSocketData[key].token === token)
				this.#webSockets[key].close();
		}
	}

	/**
	 * @param {string} payload
	 */
	#sendAll(payload) {
		for (const key in this.#webSockets)
			this.#webSockets[key].send(payload);
	}

	send = {
		reload: () => {
			this.#sendAll(JSON.stringify({
				packet: 'reload',
			}));
		},
		/**
		 * @param {string} ip
		 */
		reloadIp: (ip) => {
			const payload = JSON.stringify({
				packet: 'reload',
			});

			for (const key in this.#webSockets) {
				if (this.#webSockets[key].ip === ip) {
					this.#webSockets[key].send(payload);
					setTimeout(() => {
						this.#webSockets[key]?.close();
					}, 400);
				}
			}
		},
		updateOnline: () => {
			/**
			 * @type {Record<string, boolean>}
			 */
			const onlineUsers = {};
			for (const key in this.#webSocketData)
				onlineUsers[this.#webSocketData[key].uid] = true;

			this.#sendAll(JSON.stringify({
				packet: 'clientsOnline',
				clients: Object.keys(onlineUsers),
			}));
		},
		/**
		 * @param {import('../database/users').DBUser} user
		 */
		updateUser: (user) => {
			this.#sendAll(JSON.stringify({
				packet: 'updateUser',
				uid: user.uid,
				username: user.username,
				nickname: user.nickname,
				type: user.type,
			}));
		},
		/**
		 * @param {import('../database/messages').DBMessage} message
		 * @param {string} nonce
		 */
		newMessage: (message, nonce) => {
			this.#sendAll(JSON.stringify({
				packet: 'newMessage',
				nonce,
				...message,
			}));
		},
	};
}

module.exports.webSocketManager = new WebSocketManager();
