const EventEmitter = require('events');
const { URL } = require('url');
const { createServer } = require('http');
const { parse } = require('querystring');
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

		server.on('request', (request, response) => {
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

				console.log(`${(remoteAddress ? bold(blue(`[${remoteAddress?.split(':')[3]}] `)) : '') }${bold(green(request.method))} ${bold(blue(url))} ${bold(green(`(${Math.round(Number(end - start) / 1000) / 1000} ms)`))}`);
			});

			let path = new URL(request.url, `https://${request.headers.host}`).pathname;
			path = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;

			let data = '';

			request.on('data', (buffer) => {
				data += buffer.toString();
			});

			request.on('end', () => {
				this.emit('request', {
					method: request.method,
					path,
					cookies: parse(request.headers.cookie || '', '; ', '=', { decodeURIComponent }),
					body: data,
				}, response);
			});
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
