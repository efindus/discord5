const { randomBytes, createHash, createHmac, randomUUID } = require('crypto');

const { IS_DEV } = require('../config');
const { genSetCookieHeader } = require('../utils/cookies');
const { TOKEN_COOKIE_NAME, SALT_LENGTH, NONCE_LENGTH, PRIVATE_KEY } = require('../config');
const { findOne, insertOne, updateOne, removeOne, findMany } = require('../utils/database');

/**
 * @typedef DBUser
 * @property {string} uid
 * @property {string} nonce
 * @property {'normal' | 'admin'} type
 * @property {string} username
 * @property {string} nickname
 * @property {string} password
 * @property {string} salt
 */

/**
 * @param {string} password
 * @param {string} salt
 */
const genHash = (password, salt) => createHash('sha256').update(`${salt}${password}`).digest('base64');

/**
 * @param {string} username
 * @param {string} password
 * @param {DBUser['type']} type
 * @returns {Promise<DBUser>}
 */
module.exports.createUser = async (username, password, type = 'normal') => {
	let uid;

	do {
		uid = randomUUID();
	} while (await this.getUserById(uid));

	const passwordSalt = randomBytes(SALT_LENGTH).toString('hex');
	const passwordHash = await genHash(password, passwordSalt);

	const user = {
		uid: uid,
		nonce: randomBytes(NONCE_LENGTH).toString('hex'),
		type: type,
		username: username,
		nickname: username,
		password: passwordHash,
		salt: passwordSalt,
	};

	await insertOne('users', user);
	return user;
};

/**
 * @returns {Promise<{ uid: DBUser['uid'], username: DBUser['username'], nickname: DBUser['nickname'], type: DBUser['type'] }[]>}
 */
module.exports.getAllUsers = async () => {
	return /** @type {Promise<any>} */ (findMany('users', {}, {}, undefined, undefined, false, { uid: 1, username: 1, nickname: 1, type: 1 }));
};

/**
 * @param {string} uid
 * @returns {Promise<DBUser?>}
 */
module.exports.getUserById = (uid) => {
	return findOne('users', { uid });
};

/**
 * @param {string} username
 * @returns {Promise<DBUser?>}
 */
module.exports.getUserByUsername = (username) => {
	return findOne('users', { username });
};

/**
 * @param {DBUser} user
 */
module.exports.removeUser = async (user) => {
	await removeOne('users', { uid: user.uid });
};

/**
 * @param {string} uid
 * @param {string} nonce
 * @param {boolean} sudomode
 * @returns {string} token
 */
module.exports.generateToken = (uid, nonce, sudomode) => {
	const signatureData = {
		uid,
		nonce,
		sudoExpiresAt: (sudomode ? Date.now() + (15 * 60 * 1000) : undefined),
		expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000),
	};

	const rawSignatureData = Buffer.from(JSON.stringify(signatureData)).toString('base64url');
	const signature = createHmac('sha256', PRIVATE_KEY).update(rawSignatureData).digest('base64url');
	return `${rawSignatureData}.${signature}`;
};

/**
 * @param {string} token
 * @returns {Promise<import('../types').RequestUser?>}
 */
module.exports.verifyToken = async (token) => {
	const index = token.indexOf('.');

	if (index === -1)
		return null;

	const data = token.slice(0, index);
	const signature = token.slice(index + 1);

	if (createHmac('sha256', PRIVATE_KEY).update(data).digest('base64url') !== signature)
		return null;

	const signatureData = JSON.parse(Buffer.from(data, 'base64url').toString());
	if (signatureData.expiresAt <= Date.now())
		return null;

	const user = /** @type {import('../types').RequestUser?} */ (await findOne('users', { uid: signatureData.uid }));
	if (user?.nonce !== signatureData.nonce)
		return null;

	if (user)
		user.sudomode = (Date.now() < signatureData?.sudoExpiresAt);

	return user;
};

/**
 * @param {string} username
 * @param {boolean} checkDB
 */
module.exports.verifyUsername = async (username, checkDB = true) => {
	if (typeof username !== 'string' || username.length < 3 || username.length > 32)
		return 'usernameInvalidLength';

	if (!/^[A-Za-z0-9\-_]*$/.test(username))
		return 'usernameInvalidFormat';

	if (checkDB && await this.getUserByUsername(username))
		return 'usernameAlreadyInUse';

	return null;
};

/**
 * @param {DBUser} user
 * @param {string} password
 */
module.exports.verifyLogin = (user, password) => {
	return genHash(password, user.salt) === user.password;
};

/**
 * @param {string} uid
 * @returns {Promise<string>} new nonce
 */
module.exports.updateNonce = async (uid) => {
	const nonce = randomBytes(NONCE_LENGTH).toString('hex');
	await updateOne('users', { uid }, { nonce });
	return nonce;
};

/**
 * @param {DBUser} user
 */
module.exports.generateTokenCookie = (user, sudomode = false) => {
	return genSetCookieHeader(TOKEN_COOKIE_NAME, this.generateToken(user.uid, user.nonce, sudomode), new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)), [ 'path=/', 'samesite=strict', 'httponly', (IS_DEV ? 'dev' : 'secure') ]);
};

/**
 * @param {string} uid
 * @param {string} password
 */
module.exports.updatePassword = async (uid, password) => {
	const salt = randomBytes(SALT_LENGTH).toString('hex');
	const hash = await genHash(password, salt);
	await updateOne('users', { uid }, { salt: salt, password: hash });
};

/**
 * @param {string} uid
 * @param {DBUser['type']} type
 */
module.exports.updateType = async (uid, type) => {
	await updateOne('users', { uid }, { type });
};

/**
 * @param {string} uid
 * @param {string} username
 */
module.exports.updateUsername = async (uid, username) => {
	await updateOne('users', { uid }, { username });
};

/**
 * @param {string} uid
 * @param {string} nickname
 */
module.exports.updateNickname = async (uid, nickname) => {
	await updateOne('users', { uid }, { nickname });
};
