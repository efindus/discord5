const backup = require('../../data/backup.json');

const { connect, removeMany, insertMany } = require('../utils/database');

const main = async () => {
	await connect();

	await removeMany('users');
	await removeMany('messages');
	await removeMany('ipBans');

	// @ts-ignore
	await insertMany('users', backup.users);
	await insertMany('messages', backup.messages);
	await insertMany('ipBans', backup.ipBans);

	process.exit(0);
};

main();
