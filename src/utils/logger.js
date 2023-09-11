const { IS_DEV } = require('../config');
const { bgBlue, bgGreen, bgYellowBright, bgRedBright, whiteBright, black, green } = require('./colors');

class Logger {
	/**
	 * @param {'info' | 'warn' | 'error' | 'debug' | 'ready'} logLevel
	 * @param {string} message
	 */
	log(logLevel, message) {
		let logPrefix = `[${new Date().toLocaleString('pl').replace(',', '')}] `;
		switch (logLevel) {
			case 'error':
				logPrefix += `${bgRedBright(whiteBright(logLevel.toUpperCase()))}`;
				break;
			case 'warn':
				logPrefix += ` ${bgYellowBright(black(logLevel.toUpperCase()))}`;
				break;
			case 'ready':
				logPrefix += `${bgGreen(black(logLevel.toUpperCase()))}`;
				break;
			case 'debug':
				if (!IS_DEV)
					return;

				logPrefix += `${green(logLevel.toUpperCase())}`;
				break;
			case 'info':
				logPrefix += ` ${bgBlue(whiteBright(logLevel.toUpperCase()))}`;
				break;
			default:
				throw new Error('Log level must be one of the following: info, warn, error, debug, ready');
		}

		console.log(`${logPrefix} ${message.toString().replace(/\n/g, `\n${logPrefix} `)}`);
	}

	/**
	 * @param {string} message
	 */
	info(message) {
		this.log('info', message);
	}

	/**
	 * @param {string} message
	 */
	error(message) {
		this.log('error', message);
	}

	/**
	 * @param {string} message
	 */
	warn(message) {
		this.log('warn', message);
	}

	/**
	 * @param {string} message
	 */
	debug(message) {
		this.log('debug', message);
	}

	/**
	 * @param {string} message
	 */
	ready(message) {
		this.log('ready', message);
	}
}

module.exports.logger = new Logger();
