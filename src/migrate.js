const db = require('./utils/database');
const oldb = require('../data/db.json');

const main = async () => {
	await db.connect();
	for (const session in oldb.sessions) {
		await db.insertOne('sessions', {
			sid: session,
			username: oldb.sessions[session].username,
			sidHash: oldb.sessions[session].sessionIDHash,
		});
	}

	for (const message of oldb.messages) {
		await db.insertOne('messages', {
			id: message.messageID,
			sidHash: message.sessionIDHash,
			message: message.message,
			ts: message.ts,
		});
	}

	for (const ipBan in oldb.ipBans) {
		await db.insertOne('ipBans', {
			ip: ipBan,
		});
	}

	process.exit();
}

main()