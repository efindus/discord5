const { writeFileSync } = require('fs');

const { connect, findMany } = require('../utils/database');

const main = async () => {
	await connect();

	const dbBackup = {
		users: await findMany('users'),
		messages: await findMany('messages', {}, { ts: 1 }),
		ipBans: await findMany('ipBans'),
	};

	writeFileSync('./data/backup.json', JSON.stringify(dbBackup, null, 2));

	process.exit(0);
};

main();
