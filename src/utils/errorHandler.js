const { logger } = require('./logger');

/**
 * @param {any} err
 * @return {string}
 */
const errorToString = (err) => {
	if (typeof err?.stack === 'string')
		return err.stack;

	if (typeof err?.message === 'string')
		return err.message;

	return 'Unknown error occurred!';
};

/**
 * @param {any} error
 */
module.exports.handleError = (error) => {
	const err = errorToString(error);
	logger.error(err);
};

(() => {
	process.on('uncaughtException', (error) => {
		this.handleError(error);
	});

	process.on('unhandledRejection', (error) => {
		this.handleError(error);
	});
})();
