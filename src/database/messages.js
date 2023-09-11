const { writeFile, mkdir } = require('fs/promises');

const { insertOne, findMany, collectionLength } = require('../utils/database');
const { ATTACHMENT_BASE_PATH } = require('../config');

/**
 * @typedef DBMessage
 * @type {{ id: string, ts: number, message: string, uid: string } & Partial<{ originalAuthor: string, attachment: string }>}
 */

const idData = {
	lastIdAt: 0,
	idsGenerated: 0,
};

/**
 * @param {number} ts
 */
const genId = (ts) => {
	let index = 0;
	if (idData.lastIdAt === ts)
		index = idData.idsGenerated++;
	else
		idData.lastIdAt = ts, idData.idsGenerated = 1;

	return `${ts}-${index}`;
};

/**
 * @param {string} message
 * @param {string} uid
 * @param {string | undefined} originalAuthor
 * @param {{ fileName: string, data: Buffer } | undefined} attachment
 */
module.exports.insertMessage = async (message, uid, originalAuthor = undefined, attachment = undefined) => {
	const ts = Date.now(), id = genId(ts);

	let attachmentName = undefined;
	if (attachment) {
		attachmentName = `${id}/${attachment.fileName}`;
		const attachmentPath = `${ATTACHMENT_BASE_PATH}/attachments/${attachmentName}`;
		await mkdir(attachmentPath.slice(0, attachmentPath.lastIndexOf('/')));
		await writeFile(`${ATTACHMENT_BASE_PATH}/attachments/${attachmentName}`, attachment.data);
	}

	const msgData = {
		id,
		ts,
		message,
		uid,
		originalAuthor,
		attachment: attachmentName,
	};

	await insertOne('messages', msgData);

	return msgData;
};

/**
 * @param {number} limit
 * @param {string | undefined} before
 * @param {string | undefined} after
 */
module.exports.getMessages = async (limit, before = undefined, after = undefined) => {
	const filter = {};
	if (before || after)
		filter.id = {};

	if (before)
		filter.id.$lt = before;

	if (after)
		filter.id.$gt = after;

	// @ts-ignore
	return findMany('messages', filter, { id: -1 }, limit);
};

module.exports.getMessageCount = async () => collectionLength('messages');
