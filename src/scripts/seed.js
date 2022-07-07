const db = require('../utils/database');

const main = async () => {
	await db.connect();
	await db.insertMany('users', [
		{
			uid: '691657194299387Server',
			username: '[Server]',
			nickname: '[Server]',
			password: '',
			salt: '',
			jwtSecret: '',
		},
	]);

	await db.insertOne('messages', {
		id: '1625650625672-randombull$hitfromcrypto',
		uid: '691657194299387Server',
		message: 'It\'s awesome!',
		ts: 1625650625672,
	});

	await db.insertOne('ipBans', {
		ip: '10.222.86.181',
	});

	process.exit();
};

main();
