const { verify, decode } = require('jsonwebtoken');
const { randomBytes, createHash } = require('crypto');

const db = require('../utils/database');

const getUser = async (token) => {
	const payload = decode(token);
	if (typeof payload.uid !== 'string')
		return null;

	const user = await db.findOne('users', { uid: payload.uid });
	if (!user || user.jwtSecret === '')
		return null;

	try {
		verify(token, user.jwtSecret);
	} catch {
		return null;
	}

	return user;
};

const validateUsername = async (username, checkDB = true) => {
	if (typeof username !== 'string' || username.length < 3 || username.length > 32)
		return 'usernameInvalidLength';

	if (!/^[A-Za-z0-9\-_]*$/.test(username))
		return 'usernameInvalidFormat';

	if (checkDB && await db.findOne('users', { username }))
		return 'usernameAlreadyInUse';

	return null;
};

const validateNickname = async (nickname) => {
	const res = await validateUsername(nickname, false);
	if (res)
		return res;

	return null;
};

const regenerateJWTSecret = async (uid) => {
	const secret = randomBytes(48).toString('hex');
	await db.updateOne('users', { uid: uid }, { jwtSecret: secret });
};

const verifyLogin = (user, password) => {
	const hash = createHash('sha256').update(`${user.salt}${password}`).digest('base64');
	if (hash !== user.password)
		return false;

	return true;
};

const setPassword = async (uid, password) => {
	const salt = randomBytes(8).toString('hex');
	const hash = createHash('sha256').update(`${salt}${password}`).digest('base64');

	await db.updateOne('users', { uid: uid }, { salt: salt, password: hash });
};

module.exports = { getUser, validateUsername, validateNickname, regenerateJWTSecret, verifyLogin, setPassword };
