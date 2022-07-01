const db = require('../utils/database');

const main = async () => {
	await db.connect();
	await db.insertMany('sessions', [
		{
			sid: 'efindusFTW',
			username: 'efindus',
			sidHash: '1b103e73ac4bb641681419030d92ed3af163fa35f10b9c57f9aefce8257b7378',
		},
		{
			sid: '[Server]',
			username: '[Server]',
			sidHash: '0170fdf90e06a44d9fdb151332dd0c9e121854eca9280251a2f884d167820f92',
		}
	]);

	await db.insertOne('messages', {
		id: '1625650625672-randombull$hitfromcrypto',
		sidHash: '1b103e73ac4bb641681419030d92ed3af163fa35f10b9c57f9aefce8257b7378',
		message: 'It\'s awesome!',
		ts: 1625650625672,
	});

	await db.insertOne('ipBans', {
		ip: '10.222.86.181',
	});

	process.exit();
};

main();
