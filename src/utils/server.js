const mime = require('mime');
const { pipeline } = require('stream');
const { lstat } = require('fs/promises');
const { createReadStream } = require('fs');
const { createSecureServer } = require('http2');

const { ipv6tov4 } = require('./ip');
const { logger } = require('./logger');
const { findMany } = require('./database');
const { checkObject } = require('./objects');
const { handleError } = require('./errorHandler');
const { green, blue, bold } = require('./colors');
const { parseCookieHeader } = require('./cookies');
const { ratelimitManager, HOUR, WEEK } = require('./ratelimit');
const { webSocketManager } = require('./websocket');
const { verifyToken } = require('../database/users');
const { FRONTEND_BASE_PATH, ATTACHMENT_BASE_PATH, TOKEN_COOKIE_NAME, MAX_HTTP_BUFFER_SIZE } = require('../config');

// Per IP
ratelimitManager.create('static', 75, 30 * 1000);
ratelimitManager.create('attachmentDownload', 1_000_000_000, 90 * 1000);

/**
 * @type {any}
 */
const endpoints = {};

/**
 * @type {import('../types').addEndpoint}
 */
module.exports.addEndpoint = (method, path, handler, requirements = {}) => {
	const segments = path.split('/').filter(v => v.length);

	let base = endpoints;
	for (const segment of segments)
		base = (base[segment] ??= {});

	base.EXISTS = true;
	base[method] = {
		handler,
		...requirements,
	};
};

/**
 * @type {Record<string, boolean>}
 */
let ipBans = {};
const fetchIPBans = async () => {
	const bans = (await findMany('ipBans')).map(v => v.ip).sort();
	const cBans = Object.keys(ipBans).sort();

	if (bans.length === cBans.length) {
		let changed = false;
		for (let i = 0; i < bans.length; i++) {
			if (bans[i] !== cBans[i] && (changed = true))
				break;
		}

		if (!changed)
			return;
	}

	logger.warn(`Banned IPs changed! Updating...\nList: ${bans.join(', ')}`);

	ipBans = {};
	for (const ip of bans) {
		ipBans[ip] = true;
		webSocketManager.send.reloadIp(ip);
	}
};

fetchIPBans();
setInterval(fetchIPBans, 30_000);

/**
 * @param {Buffer} key
 * @param {Buffer} cert
 * @param {number} port
 */
module.exports.createHTTPSServer = (key, cert, port) => {
	const server = createSecureServer({
		key: key,
		cert: cert,
		allowHTTP1: true,
	});

	server.on('request', async (req, res) => {
		const start = process.hrtime.bigint();

		const url = new URL(req.url || '/', `${req.headers[':scheme']}://${req.headers[':authority']}`);
		const path = decodeURIComponent(url.pathname || '/');

		/** @type {import('../types').RequestData} */
		const requestData = {
			method: /** @type {import('../types').RequestMethod} */ (req.method),
			path: path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path,
			parameters: url.searchParams,
			body: {},
			cookies: {},
			headers: req.headers,
			user: null,
			ip: ipv6tov4(req.socket.remoteAddress),
			urlParameters: [],
		};

		res.on('finish', () => {
			const end = process.hrtime.bigint();

			let url = requestData.path;
			if (requestData.method.length + url.length > 60)
				url = `${url.slice(0, 57 - requestData.method.length)}...`;

			while (requestData.method.length + url.length < 60)
				url += ' ';

			logger.info(`${bold(blue(`[${requestData.ip}] `)) }${bold(green(requestData.method))} ${bold(blue(url))} ${bold(green(`(${Math.round(Number(end - start) / 1000) / 1000} ms)`))}`);
		});

		if (ipBans[requestData.ip]) {
			res.writeHead(503);
			res.end();
			return;
		}

		if (req.headers['content-type']) {
			const len = req.headers['content-length'];
			if (!len) {
				res.writeHead(411); // Length Required
				res.end();
				return;
			}

			if (len && +len > MAX_HTTP_BUFFER_SIZE) {
				res.writeHead(413); // Content Too Large
				res.end();
				return;
			}
		}

		if (/** @type {Array<any>} */ ([ 'application/json', 'application/x-www-form-urlencoded' ]).includes(req.headers['content-type'])) {
			try {
				await new Promise((resolve, reject) => {
					/**
					 * @type {Buffer[]}
					 */
					const buffers = [];

					req.on('data', (/** @type {Buffer} */ data) => {
						buffers.push(data);
					});

					req.on('error', reject);

					req.on('end', () => {
						const buffer = Buffer.concat(buffers).toString();

						try {
							if (req.headers['content-type'] === 'application/json')
								requestData.body = JSON.parse(buffer);
							else
								requestData.body = Object.fromEntries(new URLSearchParams(buffer));
						} catch {
							reject();
						}

						resolve(null);
					});
				});
			} catch {
				res.writeHead(400);
				res.end();
				return;
			}
		}

		if (typeof req.headers.cookie === 'string')
			requestData.cookies = parseCookieHeader(req.headers.cookie);

		if (typeof requestData.cookies[TOKEN_COOKIE_NAME] === 'string')
			requestData.user = await verifyToken(requestData.cookies[TOKEN_COOKIE_NAME]);

		if (req.headers.connection?.toLowerCase().includes('upgrade') && req.headers.upgrade?.toLowerCase() === 'websocket') {
			if (requestData.path !== '/api/gateway') {
				res.writeHead(404);
				res.end();
				return;
			}

			if (!requestData.user) {
				res.writeHead(401);
				res.end();
				return;
			}

			webSocketManager.create(req.socket, req.headers['sec-websocket-key'] || '', requestData.user.uid, requestData.cookies[TOKEN_COOKIE_NAME], () => {
				webSocketManager.send.updateOnline();
			});

			webSocketManager.send.updateOnline();

			return;
		}

		const returnMainPage = () => {
			if (!ratelimitManager.consume('static', requestData.ip)) {
				res.writeHead(429);
				return res.end();
			}

			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

			if (req.method === 'GET')
				pipeline(createReadStream(`${FRONTEND_BASE_PATH}/index.html`), res, (_) => 0);
			else
				res.end();

			return;
		};

		/**
		 * @param {string} filename
		 */
		const sendFile = async (filename) => {
			if (!requestData.path.startsWith('/attachments') && !ratelimitManager.consume('static', requestData.ip)) {
				res.writeHead(429);
				return res.end();
			}

			try {
				const targetFile = await lstat(filename);
				if (!targetFile.isFile())
					throw new Error();

				const cacheHeaders = {};
				if (requestData.path.startsWith('/attachments'))
					cacheHeaders['Cache-Control'] = `max-age=${HOUR / 1000}`;
				else if (requestData.path.endsWith('.woff2') || requestData.path.endsWith('.ico'))
					cacheHeaders['Cache-Control'] = `max-age=${WEEK / 1000}`;

				if (req.method === 'GET' && requestData.path.startsWith('/attachments') && !ratelimitManager.consume('attachmentDownload', requestData.ip, targetFile.size)) {
					res.writeHead(429);
					return res.end();
				}

				let contentType = mime.getType(filename);
				if (contentType === 'text/html' && requestData.path !== '/')
					contentType = 'text/plain';

				res.writeHead(200, {
					'Content-Type': contentType || 'text/plain',
					...cacheHeaders,
				});

				if (req.method === 'GET')
					pipeline(createReadStream(filename), res, (_) => 0);
				else
					res.end();
			} catch {
				returnMainPage();
			}
		};

		const segments = requestData.path.split('/').filter(v => v.length);
		let base = endpoints;
		for (const segment of segments) {
			const x = base?.[segment];
			if (!x) {
				base = base?.['*'];
				if (base)
					requestData.urlParameters.push(segment);
			} else {
				base = x;
			}
		}

		const endpoint = base?.[requestData.method];
		if (base?.EXISTS && !endpoint) {
			res.writeHead(405);
			res.end();
			return;
		} else if (endpoint) {
			const reqs = /** @type {{ handler: import('../types').RequestHandler<{}, {}> } & { body: any, auth?: import('../types').RequestAuth } & import('../types').RequestRequirements} */ (endpoint);

			/** @type {import('../types').ResponseData} */
			let result;

			if (reqs.ratelimits && reqs.ratelimits.type !== 'ip' && !reqs.auth)
				reqs.auth = 'user';

			if (reqs.auth && !requestData.user) {
				result = { status: 401 };
			} else if ((reqs.auth === 'admin' || reqs.auth === 'sudo') && requestData.user?.type !== 'admin') {
				result = { status: 403 };
			} else if (reqs.auth === 'sudo' && !requestData.user?.sudomode) {
				result = { status: 401, body: { message: 'sudoRequired' } };
			} else {
				const key = reqs.ratelimits?.type === 'ip' ? requestData.ip : /** @type {string} */ (requestData.user?.uid);
				if (reqs.ratelimits && !ratelimitManager.consume2(reqs.ratelimits.ids, key, requestData.user?.type === 'admin')) {
					result = { status: 429 };
				} else if (reqs.body && !checkObject(requestData.body, reqs.body)) {
					result = { status: 400 };
				} else {
					try {
						result = await reqs.handler(requestData) ?? { status: 200, body: { message: 'success' } };
					} catch (e) {
						handleError(e);
						result = { status: 500 };
					}
				}
			}

			if (result.file) {
				await sendFile(result.file);
				return;
			}

			if (result.headers) {
				for (const header in result.headers)
					res.setHeader(header, result.headers[header]);
			}

			let buffer;
			if (Buffer.isBuffer(result.body)) {
				buffer = result.body;
			} else if (typeof result.body === 'object') {
				buffer = Buffer.from(JSON.stringify(result.body));
				res.setHeader('Content-Type', 'application/json');
			}

			if (buffer)
				res.setHeader('Content-Length', buffer.length);

			res.writeHead(result.status || 200);

			if (buffer)
				res.write(buffer);

			res.end();
			return;
		}

		if ([ 'GET', 'HEAD' ].includes(requestData.method)) {
			let filePath = `${FRONTEND_BASE_PATH}/index.html`;

			const path = requestData.path;
			if (path.startsWith('/attachments'))
				filePath = `${ATTACHMENT_BASE_PATH}${path}`;
			else if (path !== '/')
				filePath = `${FRONTEND_BASE_PATH}${path}`;

			await sendFile(filePath);
			return;
		}

		res.writeHead(405);
		res.end();
		return;
	});

	server.listen(port, () => {
		logger.ready('HTTPS server started!');
	});

	require('../api');
};
