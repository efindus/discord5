const EventEmitter = require('events');
const { URL } = require('url');
const { createServer } = require('http');
const { createSecureServer } = require('http2');
const { green, blue, bold } = require('./colors.js');

class Server extends EventEmitter {
	/**
     * Launches new HTTPS server.
     * @param {string} key Server key.
     * @param {string} cert Server cert.
	 * @param {number} port Server port.
     */
	constructor(key, cert, port = 443) {
		super();

		if (port === 443) {
			createServer((request, response) => {
				response.writeHead(302, { location: `https://${request.headers.host}${request.url}` });
				response.end();
			}).listen(80, () => {
				console.log('HTTP server started!');
			});
		}

		const server = createSecureServer({
			key: key,
			cert: cert,
			allowHTTP1: true,
		});

		server.on('upgrade', (request, socket) => {
			this.emit('websocket', request, socket);
		});

		server.on('request', async (request, response) => {
			const start = process.hrtime.bigint();
			const remoteAddress = request.socket.remoteAddress;

			response.on('finish', () => {
				const end = process.hrtime.bigint();

				let url = request.url;

				if (request.method.length + url.length > 60) {
					url = `${url.slice(0, 27 - request.method.length)}...`;
				}

				while (request.method.length + url.length < 60) {
					url += ' ';
				}

				console.log(`${(remoteAddress ? bold(blue(`[${remoteAddress?.split(':')[3] ?? '127.0.0.1'}] `)) : '') }${bold(green(request.method))} ${bold(blue(url))} ${bold(green(`(${Math.round(Number(end - start) / 1000) / 1000} ms)`))}`);
			});

			const url = new URL(request.url, `https://${request.headers.host}`);
			let path = url.pathname;
			path = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;

			const requestData = {
				method: request.method,
				path: path,
				parameters: url.searchParams,
				body: {},
				cookies: {},
				headers: request.headers,
			};

			if ([ 'application/json', 'application/x-www-form-urlencoded' ].includes(request.headers['content-type'])) {
				try {
					await new Promise((resolve, reject) => {
						let buffer = '';

						request.on('data', (data) => {
							buffer += data.toString();
						});

						request.on('error', reject);

						request.on('end', () => {
							try {
								if (request.headers['content-type'] === 'application/json') {
									requestData.body = JSON.parse(buffer);
								} else {
									requestData.body = Object.fromEntries(new URLSearchParams(buffer));
								}
							} catch (error) {
								reject();
							}

							resolve();
						});
					});
				} catch {
					response.writeHead(400);
					response.end();

					return;
				}
			}

			if (typeof request.headers.cookie === 'string') {
				for (const cookie of request.headers.cookie.split('; ')) {
					const index = cookie.indexOf('=');

					if (index !== -1)
						requestData.cookies[cookie.substring(0, index)] = cookie.substring(index + 1);
				}
			}

			this.emit('request', requestData, response);
		});

		server.on('error', () => {
			// TODO: Do sth?
		});
		server.listen(port, () => {
			console.log('HTTPS server started!');
		});
	}
}

module.exports = { Server };
