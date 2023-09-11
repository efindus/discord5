/**
 * @param {string | undefined} ipv6 - "IPv6", of course. The thing that NodeJS gives you, which basically is an IPv4 written out as a v6 (unless client's network is IPv6).
 */
module.exports.ipv6tov4 = (ipv6) => {
	return ipv6?.split(':')[3] ?? '127.0.0.1';
};
