const db = require('../utils/database');

const main = async () => {
	await db.connect();

	await db.createIndex('users', { uid: 'hashed' });
	await db.createIndex('users', { username: 'hashed' });
	await db.createIndex('messages', { ts: -1 });
	await db.createIndex('ipBans', { ip: 'hashed' });

	process.exit();
};

main();
