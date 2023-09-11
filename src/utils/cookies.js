const { parse } = require('querystring');

/**
 * @param {Record<string, string>} cookies
 */
module.exports.genCookieHeader = (cookies) => {
	return Object.keys(cookies).map(cookie => `${encodeURIComponent(cookie)}=${encodeURIComponent(cookies[cookie])}`).join('; ');
};

/**
 * @param {string} cookieHeader
 * @returns {Record<string, string>}
 */
module.exports.parseCookieHeader = (cookieHeader) => {
	return Object.fromEntries(Object.entries(parse(cookieHeader, '; ')).map(([ key, value ]) => {
		return [ key, typeof value === 'object' ? value[0] : (value || '') ];
	}));
};

/**
 * @param {string} name
 * @param {string} value
 * @param {Date} expires
 * @param {string[]} attribs
 */
module.exports.genSetCookieHeader = (name, value, expires, attribs = []) => {
	return `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}${[ '', ...attribs ].join('; ')}`;
};

/**
 * @param {string} setCookie
 */
module.exports.parseSetCookieHeader = (setCookie) => {
	const rawCookie = setCookie.split(';')[0].trim().split('=');

	return {
		name: decodeURIComponent(rawCookie[0]),
		value: decodeURIComponent(rawCookie[1]),
	};
};
