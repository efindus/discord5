const { addEndpoint } = require('../utils/server');
const { webSocketManager } = require('../utils/websocket');
const { genSetCookieHeader } = require('../utils/cookies');
const { verifyCaptcha, createCaptcha } = require('../utils/captcha');
const { ratelimitManager, HOUR, DAY, MINUTE } = require('../utils/ratelimit');
const { TOKEN_COOKIE_NAME, CAPTCHA_LENGTH, CAPTCHA_SECRET, REGISTRATION_ENABLED } = require('../config');
const { getUserByUsername, verifyUsername, generateTokenCookie, verifyLogin, createUser, updateNonce } = require('../database/users');

ratelimitManager.create('captcha:M', 5, MINUTE);
addEndpoint('POST', '/api/captcha', async (req) => {
	return { status: 200, body: createCaptcha(CAPTCHA_LENGTH, CAPTCHA_SECRET) };
}, { ratelimits: { ids: [ 'captcha:M' ], type: 'ip' } });

ratelimitManager.create('register:5H', 50, 5 * HOUR);
addEndpoint('POST', '/api/register',  async (req) => {
	if (!REGISTRATION_ENABLED)
		return { status: 418 };

	const { username, password, captcha } = req.body;

	if (captcha.solution.length !== CAPTCHA_LENGTH)
		return { status: 400 };

	/**
	 * @type {any}
	 */
	let result = verifyCaptcha(captcha.id, captcha.timestamp, captcha.solution, captcha.signature, CAPTCHA_SECRET);
	if (typeof result === 'string')
		return { status: 400, body: { message: result } };
	else
		ratelimitManager.consume('captcha:M', req.ip, -1);

	result = await verifyUsername(username);
	if (result)
		return { status: 400, body: { message: result } };

	const user = await createUser(username, password, 'normal');
	ratelimitManager.consume('register:5H', req.ip, 50);

	return { status: 200, body: { message: 'success' }, headers: { 'set-cookie': generateTokenCookie(user) } };
}, { body: { username: '', password: '', captcha: { id: '', timestamp: 0, solution: '', signature: '' } }, ratelimits: { ids: [ 'register:5H' ], type: 'ip' } });

ratelimitManager.create('login:H', 40, HOUR);
ratelimitManager.create('login:D', 80, DAY);
addEndpoint('POST', '/api/login', async (req) => {
	const { username, password } = req.body;

	const user = /** @type {import('../database/users').DBUser} */ (await getUserByUsername(username) || { password: '', salt: '' });
	if (!(await verifyLogin(user, password)))
		return { status: 400, body: { message: 'invalidLogin' } };

	ratelimitManager.consume('login:H', req.ip, -1);
	ratelimitManager.consume('login:D', req.ip, -1);

	return { status: 200, body: { message: 'success' }, headers: { 'set-cookie': generateTokenCookie(user) } };
}, { body: { username: '', password: '' }, ratelimits: { ids: [ 'login:H', 'login:D' ], type: 'ip' } });

addEndpoint('POST', '/api/sudo', async (req) => {
	const { password } = req.body;

	if (!(await verifyLogin(req.user, password)))
		return { status: 400, body: { message: 'invalidLogin' } };

	return { status: 200, body: { message: 'success' }, headers: { 'set-cookie': generateTokenCookie(req.user, true) } };
}, { auth: 'admin', body: { password: '' } });

addEndpoint('POST', '/api/log-out', async (req) => {
	const x = genSetCookieHeader(TOKEN_COOKIE_NAME, '', new Date('Wed, 31 Dec 1969 00:00:00 GMT'), [ 'path=/', 'samesite=strict', 'httponly', 'secure' ]);
	webSocketManager.closeToken(req.cookies[TOKEN_COOKIE_NAME]);
	return { status: 200, body: { message: 'success' }, headers: { 'set-cookie': x } };
}, { auth: 'user' });

ratelimitManager.create('log-out-everywhere:H', 30, HOUR);
ratelimitManager.create('log-out-everywhere:D', 50, DAY);
addEndpoint('POST', '/api/log-out-everywhere', async (req) => {
	await updateNonce(req.user.uid);
	webSocketManager.close(req.user.uid);
}, { auth: 'user', ratelimits: { ids: [ 'log-out-everywhere:H', 'log-out-everywhere:D' ] } });
