const EventEmitter = require('events');
const { createHash, randomBytes } = require('crypto');

class WebSocket extends EventEmitter {
	/**
	 * @type {import('net').Socket}
	 */
	#socket;
	/**
	 * @type {string}
	 */
	#id;

	/**
	 * @param {import('net').Socket} socket Socket.
	 * @param {string} webSocketKey WS key.
	 */
	constructor(socket, webSocketKey) {
		super();

		this.#socket = socket;
		this.#id = randomBytes(8).toString('base64');

		socket.on('error', (error) => {
			this.close();
			this.emit('close');

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

		socket.setTimeout(40000);

		let inputBuffer = Buffer.alloc(0);
		let messageBuffer = Buffer.alloc(0);
		let isBinary = true;

		socket.on('data', data => {
			inputBuffer = Buffer.concat([ inputBuffer, data ]);

			try {
				do {
					if (inputBuffer.length <= 2) return;

					let start = 2;
					let length = inputBuffer[1] & 0b01111111;

					if (length === 126) {
						if (inputBuffer.length < 4) return;

						length = inputBuffer.readUInt16BE(2);
						start = 4;
					} else if (length === 127) {
						if (inputBuffer.length < 10) return;

						length = inputBuffer.readBigUInt64BE(2);
						start = 10;
					}

					const mask = Buffer.alloc(4);

					if (!(inputBuffer[1] & 0b10000000)) {
						this.close();
						return;
					}

					if (inputBuffer.length < start + 4) return;

					for (let index = 0; index < 4; index++)
						mask[index] = inputBuffer[start + index];

					start += 4;

					if (inputBuffer.length < start + length) return;

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

					inputBuffer = Uint8Array.prototype.slice.call(inputBuffer, start + length);
				} while (inputBuffer.length > 0);
			} catch (error) {
				console.log(error);
			}
		});

		socket.on('end', () => {
			this.emit('close');
		});

		socket.on('timeout', socket.end);
	}

	/**
	 * Sends a message to a WebSocket.
	 * @param {string} message Message.
	 * @param {number} code Message code.
	 */
	send = (message, code = 1) => {
		message = Buffer.from(message);
		let header;

		if (message.length <= 125) {
			header = Buffer.alloc(2);
			header[1] = message.length;
		} else if (message.length < 65536) {
			header = Buffer.alloc(4);
			header[1] = 126;
			header.writeUInt16BE(message.length, 2);
		} else {
			header = Buffer.alloc(10);
			header[1] = 127;
			header.writeBigUInt64BE(BigInt(message.length), 2);
		}

		header[0] = 0b10000000 | code;
		this.#socket.write(Buffer.concat([ header, message ]));
	};

	/**
	 * ID of the WebSocket
	 */
	get id() {
		return this.#id;
	}

	/**
	 * Close the socket
	 */
	close = () => {
		this.#socket.end();
	};

	/**
	 * IP address of the client
	 * @returns {string} IP address
	 */
	getIp = () => {
		return this.#socket.remoteAddress?.split(':')[3];
	};
}

module.exports = { WebSocket };
