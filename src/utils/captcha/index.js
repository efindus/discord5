const { randomBytes, createHmac } = require('crypto');

const font = require('./captcha.json');
const letters = Object.keys(font);

const solved = new Set();

/**
 * Verifies if captcha was solved correctly.
 * @param {string} id - Unique captcha id.
 * @param {number} timestamp - Captcha creation timestamp.
 * @param {string} solution - Solution to test.
 * @param {string} signature - Captcha signature.
 * @param {string} secret - Secret that was used to sign the captcha.
 * @returns {string|boolean} Returns true if captcha was solved correctly. Else the error message is provided.
 */

const verifyCaptcha = (id, timestamp, solution, signature, secret) => {
	solution = solution.toUpperCase();

	if (createHmac('sha256', secret).update(`${id}${timestamp}${solution}`).digest('hex') !== signature)
		return 'invalidSolution';

	if (timestamp + 60000 < Date.now() || solved.has(id))
		return 'captchaExpired';

	solved.add(id);

	setTimeout(() => {
		solved.delete(id);
	}, timestamp + 60000 - Date.now());

	return true;
};

/**
 * Captcha data
 * @typedef CaptchaData
 * @property {string} id - Unique captcha id.
 * @property {number} timestamp - Captcha creation timestamp.
 * @property {string} signature - Captcha signature.
 * @property {string} content - Captcha content.
 */

/**
 * Creates a new captcha.
 * @param {number} length - The length of the captcha.
 * @param {string} secret - Secret key used to sign a captcha.
 * @returns {CaptchaData} Captcha data
 */

const createCaptcha = (length, secret) => {
	let solution = '';
	let position = -10;
	const output = [];

	while (length--) {
		const letter = letters[Math.floor(Math.random() * letters.length)];
		solution += letter;

		const angle = Math.random() * 0.6 - 0.3;
		const sinus = Math.sin(angle);
		const cosinus = Math.cos(angle);
		let min = 64;
		let max = 0;

		for (const path of font[letter]) {
			for (let index = 0; index < path.length; index++) {
				if (typeof path[index] === 'number') {
					const x = Math.round((path[index] * cosinus - (path[index + 1] - 32) * sinus) * 10) / 10;

					min = Math.min(min, x);
					max = Math.max(max, x);

					index++;
				}
			}
		}

		const middle = position + (max - min) / 2;

		for (const path of font[letter]) {
			let current = '';

			for (let index = 0; index < path.length; index++) {
				if (typeof path[index] === 'number') {
					const x = path[index] + position - min + 10 - middle;
					const y = path[index + 1] - 32;

					current += ` ${Math.round((x * cosinus - y * sinus + middle) * 10) / 10} ${Math.round((x * sinus + y * cosinus + 32) * 10) / 10}`;
					index++;
				} else {
					current += ` ${path[index]}`;
				}
			}

			output.push(current.slice(1));
		}

		position += max - min + 10;
	}

	for (let index = output.length - 1; index > 0; index--) {
		const newIndex = Math.floor(Math.random() * (index + 1));
		const value = output[index];

		output[index] = output[newIndex];
		output[newIndex] = value;
	}

	const id = randomBytes(4).toString('hex');
	const timestamp = Date.now();

	return {
		id: id,
		timestamp: timestamp,
		signature: createHmac('sha256', secret).update(`${id}${timestamp}${solution}`).digest('hex'),
		content: `<svg class="captcha-image" version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(position)} 64"><path fill="var(--text-primary)" d="${output.join('')}"></path></svg>`,
	};
};

module.exports = { createCaptcha, verifyCaptcha };
