const { writeFileSync } = require('fs');
const db = require('../utils/database');

const main = async () => {
	await db.connect();

	const dbBackup = {
		users: {},
		messages: [],
		ipBans: [],
	};

	const users = await db.findMany('users');
	for (const user of users) {
		dbBackup.users[user.uid] = user;
	}

	const messages = await db.findMany('messages', {}, { ts: 1 });
	for (const message of messages) {
		dbBackup.messages.push(message);
	}

	const ipBans = await db.findMany('ipBans');
	for (const ipBan of ipBans) {
		dbBackup.ipBans.push(ipBan.ip);
	}

	writeFileSync('./data/backup.json', JSON.stringify(dbBackup, null, 2));

	process.exit();
};

main();
