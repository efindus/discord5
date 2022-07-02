const { existsSync, readFileSync, mkdirSync, writeFileSync } = require('fs');

const { request, websocket } = require('./requests');
const { bold, red } = require('./utils/colors');
const { Server } = require('./utils/server');
const db = require('./utils/database');

const main = async () => {
	console.log('Connecting to DB...');
	await db.connect();
	await db.removeMany('sessions', { username: '' });
	const server = new Server(readFileSync('server.key'), readFileSync('server.cert'), 8420);

	server.on('request', request);
	server.on('websocket', websocket);

	console.log('Discord 4.0 started!');
};

if (!existsSync('data/errors')) mkdirSync('data/errors', { recursive: true });
process.on('uncaughtException', error => {
	console.log(`${bold(red(`Error: ${error.stack}`))}`);
	writeFileSync(`./data/errors/error-${Date.now()}.txt`, error.stack);
});

main();
