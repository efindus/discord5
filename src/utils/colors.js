const colors = {
	green: '\x1b[32m',
	blue: '\x1b[34m',
	bold: '\x1b[1m',
	red: '\x1b[31m',
};

Object.entries(colors).forEach(([ key, value ]) => {
	exports[key] = (string) => {
		return `${value}${string}\x1b[0m`;
	};
});
