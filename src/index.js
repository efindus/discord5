const { existsSync, readFileSync, mkdirSync, writeFileSync } = require('fs');

const { request, websocket } = require('./requests');
const { bold, red } = require('./utils/colors');
const { Server } = require('./utils/server');
const db = require('./utils/database');

const main = async () => {
	console.log('Connecting to DB...');
	await db.connect();
	console.log('Connected to DB!');
	await db.removeMany('sessions', { username: '' });

	console.log('Starting HTTPS server...');
	const server = new Server(readFileSync('server.key'), readFileSync('server.cert'), 8420);

	server.on('request', request);
	server.on('websocket', websocket);

	console.log('Discord5 initialized!');
};

if (!existsSync('data/errors')) mkdirSync('data/errors', { recursive: true });
process.on('uncaughtException', error => {
	console.log(`${bold(red(`Error: ${error.stack}`))}`);
	writeFileSync(`./data/errors/error-${Date.now()}.txt`, error.stack);
});

main();
