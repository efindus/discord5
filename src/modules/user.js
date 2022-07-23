const { createHash, randomBytes } = require('crypto');
const { sign } = require('jsonwebtoken');

const { addEndpoint } = require('../utils/reqhandler');
const { verifyCaptcha, createCaptcha } = require('../utils/captcha');
const db = require('../utils/database');
const { validateUsername } = require('../utils/user');
const CAPTCHA_SECRET = randomBytes(96).toString('hex');

/**
 * @param {import('../utils/reqhandler').RequestData} request
 */
const captchaHandler = async (request) => {
	const captcha = createCaptcha(8, CAPTCHA_SECRET);
	return {
		status: 200,
		body: captcha,
	};
};

/**
 * @param {import('../utils/reqhandler').RequestData} request
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

	let result = verifyCaptcha(data.captcha.id, data.captcha.timestamp, data.captcha.solution, data.captcha.signature, CAPTCHA_SECRET);
	if (typeof result === 'string') {
		return {
			status: 400,
			body: {
				message: result,
			},
		};
	}

	result = await validateUsername(data.username);
	if (result) {
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
 * @param {import('../utils/reqhandler').RequestData} request
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
