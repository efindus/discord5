const { randomBytes } = require('crypto');

module.exports.IS_DEV = process.env.NODE_ENV === 'development';

module.exports.DATABASE_NAME = 'discord5';

module.exports.REGISTRATION_ENABLED = true;

module.exports.FRONTEND_BASE_PATH = './src/frontend';
module.exports.ATTACHMENT_BASE_PATH = './data';

module.exports.PROTOCOL_VERSION = '1';
module.exports.SERVER_USER_UID = 'server';

module.exports.MESSAGES_TO_LOAD = 150;
module.exports.MAX_MESSAGE_LENGTH = 2000;

module.exports.MAX_WS_BUFFER_SIZE = 100;
module.exports.MAX_HTTP_BUFFER_SIZE = 14_900_000;

module.exports.CAPTCHA_SECRET = randomBytes(96).toString('hex');
module.exports.CAPTCHA_LENGTH = 8;

module.exports.SALT_LENGTH = 16;
module.exports.NONCE_LENGTH = 16;
/**
 * @type {string}
 */
module.exports.PRIVATE_KEY = '';

module.exports.TOKEN_COOKIE_NAME = (this.IS_DEV ? 'token' : '__Host-token');
