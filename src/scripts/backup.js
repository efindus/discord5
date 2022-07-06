const { writeFileSync } = require('fs');
const db = require('../utils/database');

const main = async () => {
	await db.connect();

	const dbBackup = {
		sessions: {},
		messages: [],
		ipBans: [],
	};

	const sessions = await db.findMany('sessions');
	for (const session of sessions) {
		dbBackup.sessions[session.sid] = {
			username: session.username,
			sessionIDHash: session.sidHash,
			connected: false,
		};
	}

	const messages = await db.findMany('messages', {}, { ts: 1 });
	for (const message of messages) {
		dbBackup.messages.push({
			messageID: message.id,
			sessionIDHash: message.sidHash,
			message: message.message,
			ts: message.ts,
		});
	}

	const ipBans = await db.findMany('ipBans');
	for (const ipBan of ipBans) {
		dbBackup.ipBans.push(ipBan.ip);
	}

	writeFileSync('./data/backup.json', JSON.stringify(dbBackup, null, 2));

	process.exit();
};

main();
