const { randomUUID } = require('crypto');

const { connect, findOne, findMany, updateOne, updateMany } = require('../utils/database');

const main = async () => {
	await connect();

	const users = await findMany('users');
	for (const user of users) {
		let uid;
		if (user.username === '[Server]') {
			uid = 'server';
		} else {
			do {
				uid = randomUUID();
			} while (await findOne('users', { uid }));
		}

		await updateOne('users', { uid: user.uid }, { uid });
		await updateMany('messages', { uid: user.uid }, { uid });
		await updateMany('messages', { originalAuthor: user.uid }, { originalAuthor: uid });

		if (!user.type)
			await updateOne('users', { uid }, { type: 'normal' });
	}

	await updateMany('users', {}, {}, {}, { $unset: { jwtSecret: '' } });

	/**
	 * @type {Record<string, boolean>}
	 */
	const idsTaken = {};
	const messages = await findMany('messages');
	for (const message of messages) {
		const idBase = message.id.split('-')[0];

		let offset = 0, newId = `${idBase}-${offset}`;
		while (idsTaken[newId])
			newId = `${idBase}-${++offset}`;

		idsTaken[newId] = true;
		await updateOne('messages', { id: message.id }, { id: newId });
	}

	process.exit(0);
};

main();
