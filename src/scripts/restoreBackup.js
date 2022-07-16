const db = require('../utils/database');
const backup = require('../../data/backup.json');

const main = async () => {
	await db.connect();

	await db.removeMany('users');
	await db.removeMany('messages');
	await db.removeMany('ipBans');

	await db.insertMany('users', backup.users);
	await db.insertMany('messages', backup.messages);
	await db.insertMany('ipBans', backup.ipBans.map(ip => {
		return { ip: ip };
	}));

	process.exit();
};

main();
