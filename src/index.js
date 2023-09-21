require('./utils/errorHandler');

const { readFileSync } = require('fs');
const { randomBytes } = require('crypto');

const { logger } = require('./utils/logger');
const { SERVER_USER_UID } = require('./config');
const { createHTTPSServer } = require('./utils/server');
const { connect, findOne, insertOne, createIndex, collectionLength } = require('./utils/database');

const main = async () => {
	logger.info('Connecting with the database...');
	await connect();
	logger.info('Connected!');

	logger.info('Loading modules...');
	await createIndex('users', { uid: 'hashed' });
	await createIndex('users', { username: 'hashed' });
	await createIndex('messages', { id: -1 });

	let serverDocument = await findOne('servers', {});
	if (!serverDocument) {
		serverDocument = {
			privateKey: `0x${randomBytes(32).toString('hex')}`,
		};

		await insertOne('servers', serverDocument);
	}

	if (await collectionLength('users') === 0) {
		await insertOne('users', {
			uid: SERVER_USER_UID,
			username: '[Server]',
			nickname: '[Server]',
			password: '',
			salt: '',
			nonce: '',
			type: 'admin',
		});

		await insertOne('messages', {
			id: '1625650625672-0',
			uid: SERVER_USER_UID,
			message: 'It\'s awesome!',
			ts: 1625650625672,
		});
	}

	require('./config').PRIVATE_KEY = serverDocument.privateKey;

	logger.info('Starting HTTPS server...');
	createHTTPSServer(readFileSync('server.key'), readFileSync('server.cert'), 8420);

	logger.ready('Discord5 initialized!');
};

main();
