const { addEndpoint } = require('../utils/server');
const { webSocketManager } = require('../utils/websocket');
const { ratelimitManager, MINUTE, HOUR, WEEK } = require('../utils/ratelimit');
const { verifyUsername, verifyLogin, getAllUsers, getUserById, updatePassword, updateType, updateUsername, removeUser, updateNonce, generateTokenCookie, updateNickname } = require('../database/users');

// self API
ratelimitManager.create('me:M', 30, MINUTE);
ratelimitManager.create('me:H', 1000, HOUR);
addEndpoint('GET', '/api/me', async (req) => {
	return {
		status: 200,
		body: {
			uid: req.user.uid,
			username: req.user.username,
			nickname: req.user.nickname,
			type: req.user.type,
		},
	};
}, { auth: 'user', ratelimits: { ids: [ 'me:M', 'me:H' ] } });

ratelimitManager.create('user/nickname:20S', 3, 20 * 1000);
ratelimitManager.create('user/nickname:H', 60, HOUR);
addEndpoint('PUT', '/api/user/nickname', async (req) => {
	const { nickname } = req.body;

	const result = await verifyUsername(nickname, false);
	if (result)
		return { status: 400, body: { message: result } };

	await updateNickname(req.user.uid, nickname);
	webSocketManager.send.updateUser({ ...req.user, nickname });
}, { auth: 'user', body: { nickname: '' }, ratelimits: { ids: [ 'user/nickname:20S', 'user/nickname:H' ] } });

ratelimitManager.create('user/password:H', 15, HOUR);
ratelimitManager.create('user/password:W', 50, WEEK);
addEndpoint('PUT', '/api/user/password', async (req) => {
	const { currentPassword, password } = req.body;

	if (!(await verifyLogin(req.user, currentPassword)))
		return { status: 401, body: { message: 'invalidLogin' } };

	await updatePassword(req.user.uid, password);
	req.user.nonce = await updateNonce(req.user.uid);
	webSocketManager.close(req.user.uid);

	return { status: 200, body: { message: 'success' }, headers: { 'set-cookie': generateTokenCookie(req.user) } };
}, { auth: 'user', body: { password: '', currentPassword: '' }, ratelimits: { ids: [ 'user/password:H', 'user/password:W' ] } });


// public data API
ratelimitManager.create('users/*:M', 120, MINUTE);
addEndpoint('GET', '/api/users/*', async (req) => {
	const user = await getUserById(req.urlParameters[0]);

	return {
		status: 200,
		body: {
			username: user?.username ?? '',
			nickname: user?.nickname ?? '',
			type: user?.type ?? '',
		},
	};
}, { auth: 'user', ratelimits: { ids: [ 'users/*:M' ] } });


// admin management
addEndpoint('GET', '/api/users', async (req) => {
	return { status: 200, body: await getAllUsers() };
}, { auth: 'admin' });

addEndpoint('PUT', '/api/users/*/username', async (req) => {
	const uid = req.urlParameters[0], { username } = req.body;

	const result = await verifyUsername(username);
	if (result)
		return { status: 400, body: { message: result } };

	const targetUser = await getUserById(uid);
	if (!targetUser)
		return { status: 400, body: { message: 'invalidId' } };

	await updateUsername(uid, username);
	webSocketManager.send.updateUser({ ...targetUser, username });
}, { auth: 'sudo', body: { username: '' } });

addEndpoint('PUT', '/api/users/*/nickname', async (req) => {
	const uid = req.urlParameters[0], { nickname } = req.body;

	const result = await verifyUsername(nickname, false);
	if (result)
		return { status: 400, body: { message: result } };

	const targetUser = await getUserById(uid);
	if (!targetUser)
		return { status: 400, body: { message: 'invalidId' } };

	await updateNickname(uid, nickname);
	webSocketManager.send.updateUser({ ...targetUser, nickname });
}, { auth: 'admin', body: { nickname: '' } });

addEndpoint('PUT', '/api/users/*/password', async (req) => {
	const uid = req.urlParameters[0], { password } = req.body;

	const targetUser = await getUserById(uid);
	if (!targetUser)
		return { status: 400, body: { message: 'invalidId' } };

	await updatePassword(uid, password);
	await updateNonce(uid);
	webSocketManager.close(uid);
}, { auth: 'sudo', body: { password: '' } });

addEndpoint('PUT', '/api/users/*/type', async (req) => {
	const uid = req.urlParameters[0], type = /** @type {import('../database/users').DBUser['type']} */ (req.body.type);

	if (!([ 'normal', 'admin' ].includes(type)))
		return { status: 400 };

	if (req.user.uid === uid)
		return { status: 400, body: { message: 'illegalOperation' } };

	const targetUser = await getUserById(uid);
	if (!targetUser)
		return { status: 400, body: { message: 'invalidId' } };

	await updateType(uid, type);
	webSocketManager.send.updateUser({ ...targetUser, type });
}, { auth: 'sudo', body: { type: '' } });

addEndpoint('DELETE', '/api/users/*', async (req) => {
	const uid = req.urlParameters[0];

	if (req.user.uid === uid)
		return { status: 400, body: { message: 'illegalOperation' } };

	const targetUser = await getUserById(uid);
	if (!targetUser)
		return { status: 400, body: { message: 'invalidId' } };

	await removeUser(targetUser);
	webSocketManager.close(targetUser.uid);
}, { auth: 'sudo' });
