const db = require('../utils/database');

const main = async () => {
	await db.connect();

	await db.removeMany('messages', { ts: { $gt: 1657200060727 }});

	process.exit();
};

main();
