const { randomUUID } = require('crypto');
const { rename, mkdir } = require('fs/promises');

const { ATTACHMENT_BASE_PATH, SERVER_USER_UID } = require('../config');
const { connect, findOne, findMany, updateOne, updateMany } = require('../utils/database');
const { existsSync } = require('fs');

const main = async () => {
	await connect();

	const users = await findMany('users');
	for (const user of users) {
		let uid;
		if (user.username === '[Server]') {
			uid = SERVER_USER_UID;
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

		const oldPath = `${ATTACHMENT_BASE_PATH}/attachments/${message.attachment}`;
		if (message.attachment && existsSync(oldPath)) {
			const filename = message.attachment.split('-').slice(2).join('-'), basePath = `${ATTACHMENT_BASE_PATH}/attachments/${newId}`;
			await mkdir(basePath, { recursive: true });
			await rename(oldPath, `${basePath}/${filename}`);
			await updateOne('messages', { id: newId }, { attachment: filename });
		}
	}

	process.exit(0);
};

main();
