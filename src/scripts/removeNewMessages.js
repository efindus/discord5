const { rm } = require('fs/promises');

const { ATTACHMENT_BASE_PATH } = require('../config');
const { connect, findMany, removeMany } = require('../utils/database');

const TS = 1696114645064;

const main = async () => {
	await connect();

	// @ts-ignore
	const attachments = (await findMany('messages', { ts: { $gt: TS }})).filter(v => v.attachment).map(v => v.id);
	// @ts-ignore
	await removeMany('messages', { ts: { $gt: TS }});

	for (const attachment of attachments)
		await rm(`${ATTACHMENT_BASE_PATH}/attachments/${attachment}`, { recursive: true, force: true });

	process.exit(0);
};

main();
