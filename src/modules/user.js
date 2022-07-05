const { createHash, randomBytes } = require('crypto');
const { sign } = require('jsonwebtoken');

const { addEndpoint } = require('../requestHandler');
const { verifyCaptcha, createCaptcha } = require('../utils/captcha');
const db = require('../utils/database');
const CAPTCHA_SECRET = '86faeffd4b1348e4d92caf9404afbcf87544fcf04783fb8162b2fdfe9ee8cc0e083c29ad053a8c73b64cb54a9ba0cc38549d1f0d90905386350abbfc91bf8409';

const validateUsername = async (username) => {
	if (typeof username !== 'string' || username.length < 3 || username.length > 32)
		return 'usernameInvalidLength';

	if (!/^[A-Za-z0-9\-_]*$/.test(username))
		return 'usernameInvalidFormat';

	if (await db.findOne('users', { username }))
		return 'usernameAlreadyInUse';

	return null;
};

const captchaHandler = async (_handler) => {
	const captcha = createCaptcha(8, CAPTCHA_SECRET);
	return {
		status: 200,
		body: captcha,
	};
};

/**
 * @param {import('../requestHandler').RequestData} request
 */
const registerHandler = async (request) => {
	const data = request.body;
	if (!(
		typeof data.username === 'string' &&
		typeof data.password === 'string' &&
		typeof data.captcha === 'object' &&
		typeof data.captcha.id === 'string' &&
		typeof data.captcha.timestamp === 'number' &&
		typeof data.captcha.solution === 'string' &&
		typeof data.captcha.signature === 'string'
	)) {
		return {
			status: 400,
		};
	}

	let result = await validateUsername(data.username);
	if (result) {
		return {
			status: 400,
			body: {
				message: result,
			},
		};
	}

	result = verifyCaptcha(data.captcha.id, data.captcha.timestamp, data.captcha.solution, data.captcha.signature, CAPTCHA_SECRET);
	if (typeof result === 'string') {
		return {
			status: 400,
			body: {
				message: result,
			},
		};
	}

	const passwordSalt = randomBytes(8).toString('hex');
	const passwordHash = createHash('sha256').update(`${passwordSalt}${data.password}`).digest('base64');

	await db.insertOne('users', {
		uid: `69${Date.now()}${randomBytes(4).toString('hex')}`,
		username: data.username,
		nickname: data.username,
		password: passwordHash,
		salt: passwordSalt,
		jwtSecret: randomBytes(48).toString('hex'),
	});

	return {
		status: 200,
		body: {
			message: 'success',
		},
	};
};

/**
 * @param {import('../requestHandler').RequestData} request
 */
const loginHandler = async (request) => {
	const data = request.body;
	if (!(
		typeof data.username === 'string' &&
		typeof data.password === 'string'
	)) {
		return {
			status: 400,
		};
	}

	const user = await db.findOne('users', { username: data.username });
	if (!user) {
		return {
			status: 400,
			body: {
				message: 'invalidLogin',
			},
		};
	}

	const hash = createHash('sha256').update(`${user.salt}${data.password}`).digest('base64');
	if (user.password !== hash) {
		return {
			status: 400,
			body: {
				message: 'invalidLogin',
			},
		};
	}

	const jwt = sign({
		uid: user.uid,
	}, user.jwtSecret, {
		expiresIn: '30 days',
	});

	return {
		status: 200,
		body: {
			message: 'success',
			token: jwt,
		},
	};
};

addEndpoint('/api/captcha', 'POST', captchaHandler);
addEndpoint('/api/register', 'POST', registerHandler);
addEndpoint('/api/login', 'POST', loginHandler);
