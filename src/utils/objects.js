/**
 * @param {any} obj - An unknown object
 * @param {any} schema - An object with all properties being their desired types
 * @returns {boolean} - Does the obj match the schema
 */
module.exports.checkObject = (obj, schema) => {
	for (const key of Object.keys(schema)) {
		if (typeof obj[key] !== typeof schema[key])
			return false;

		if (typeof obj[key] === 'object' && !this.checkObject(obj[key], schema[key]))
			return false;
	}

	return true;
};
