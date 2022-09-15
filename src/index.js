const { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } = require('fs');

const db = require('./utils/database');
const { logger } = require('./utils/logger');
const { Server } = require('./utils/server');
const { request, websocket } = require('./utils/reqhandler');

const main = async () => {
	logger.info('Connecting to DB...');
	await db.connect();
	logger.info('Connected to DB!');

	logger.info('Loading modules...');
	for (const module of readdirSync(`${__dirname}/modules`)) {
		if (module.endsWith('.js'))
			require(`./modules/${module}`);
	}
	logger.info('Loaded modules!');

	logger.info('Starting HTTPS server...');
	const server = new Server(readFileSync('server.key'), readFileSync('server.cert'), 8420);

	server.on('request', request);
	server.on('websocket', websocket);

	logger.ready('Discord5 initialized!');
};

if (!existsSync('data/attachments'))
	mkdirSync('data/attachments', { recursive: true });

if (!existsSync('data/errors'))
	mkdirSync('data/errors', { recursive: true });

process.on('uncaughtException', error => {
	logger.error(`Error: ${error.stack}`);
	writeFileSync(`./data/errors/error-${Date.now()}.txt`, error.stack);
});

main();
