const { connect, removeMany } = require('../utils/database');

const main = async () => {
	await connect();

	// @ts-ignore
	await removeMany('messages', { ts: { $gt: 1657200060727 }});

	process.exit();
};

main();
