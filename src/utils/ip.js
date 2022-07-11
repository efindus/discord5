const ipv6tov4 = (ipv6) => {
	return ipv6?.split(':')[3] ?? '127.0.0.1';
};

module.exports = { ipv6tov4 };
