const { MESSAGES_TO_LOAD, MAX_MESSAGE_LENGTH, SERVER_USER_UID } = require('../config');
const { getMessages, insertMessage, getMessageCount } = require('../database/messages');
const { ratelimitManager, MINUTE } = require('../utils/ratelimit');
const { addEndpoint } = require('../utils/server');
const { webSocketManager } = require('../utils/websocket');

ratelimitManager.create('GET/messages:M', 100, MINUTE);
addEndpoint('GET', '/api/messages', async (req) => {
	const x = req.parameters;
	const limit = +(x.get('limit') ?? MESSAGES_TO_LOAD), before = x.get('before') ?? undefined, after = x.get('after') ?? undefined;
	if (isNaN(limit) || !(0 < limit && limit <= MESSAGES_TO_LOAD))
		return { status: 400 };

	return { status: 200, body: await getMessages(limit, before, after) };
}, { auth: 'user', ratelimits: { ids: [ 'GET/messages:M' ] } });

ratelimitManager.create('messages:15S', 20, 15 * 1000);
ratelimitManager.create('messages;newlines:3S', 300, 3 * 1000);
ratelimitManager.create('messages;newlines:M', 580, MINUTE);
ratelimitManager.create('attachmentUploads', 45_000_000, 10 * MINUTE);
addEndpoint('POST', '/api/messages', async (req) => {
	const { message, nonce } = req.body;

	const trimmedMessage = message.trim();
	if (!(trimmedMessage.length > 0 && trimmedMessage.length <= MAX_MESSAGE_LENGTH && nonce.length > 0 && nonce.length <= 54))
		return { status: 400 };

	const nlCount = trimmedMessage.split('\n').length;

	const retryAfter = ratelimitManager.consume2([ 'messages;newlines:3S', 'messages;newlines:M' ], req.user.uid, req.user.type === 'admin', nlCount);
	if (retryAfter)
		return { status: 429, body: { message: 'newlineLimit' }, headers: { 'Retry-After': `${Math.ceil(retryAfter / 1000)}` } };

	const rawMsg = {
		message: message.trim(),
		uid: req.user.uid,
		originalAuthor: /** @type {string | undefined} */ (undefined),
		attachment: /** @type {{ fileName: string, data: Buffer } | undefined} */ (undefined),
	};

	const { attachment } = /** @type {any} */ (req.body);
	if (typeof attachment === 'object') {
		const { fileName, data } = attachment;
		if (!(
			typeof fileName === 'string' && fileName.length > 0 && fileName.length < 250 && !fileName.includes('/') &&
			typeof data === 'string' && data.length < 14_900_000
		)) {
			return { status: 400, body: { message: 'invalidAttachment' } };
		}

		rawMsg.attachment = {
			fileName,
			data: Buffer.from(data, 'base64'),
		};

		if (!ratelimitManager.consume('attachmentUploads', req.user.uid, rawMsg.attachment.data.length))
			return { status: 429, body: { message: 'attachmentLimit' }, headers: { 'Retry-After': `${Math.ceil(ratelimitManager.retryAfter('attachmentUploads', req.user.uid) / 1000)}` } };
	}

	if (message === '/ile') {
		rawMsg.message = `Aktualna liczba wiadomości: ${await getMessageCount()}.`;
		rawMsg.originalAuthor = rawMsg.uid;
		rawMsg.uid = SERVER_USER_UID;
	}

	const msg = await insertMessage(rawMsg.message, rawMsg.uid, rawMsg.originalAuthor, rawMsg.attachment);
	webSocketManager.send.newMessage(msg, nonce);
}, { auth: 'user', body: { message: '', nonce: '' }, ratelimits: { ids: [ 'messages:15S' ] } });
