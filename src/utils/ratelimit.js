module.exports.Ratelimit = class {
	#limit;
	#duration;
	#durationToLimit;
	#nextReset;
	/** @type {Record<string, number>} */ #points;

	/**
	 * Create a ratelimit instance
	 * @param {number} limit - Maximum allowed number of points
	 * @param {number} duration - Time in miliseconds between resets
	 */
	constructor(limit, duration) {
		this.#limit = limit;
		this.#duration = duration;
		this.#durationToLimit = this.#duration / this.#limit;
		this.#points = {};
		this.#nextReset = Date.now() + this.#duration;

		setInterval(() => this.reset(), this.#duration);
	}

	/**
	 * Consume a number of points from a key if possible
	 * @param {string} key - The key to take the points from
	 * @param {number} points - The number of points to take [default: 1]
	 * @returns {boolean} Whether the request was within the limit or not
	 */
	consume(key, points = 1) {
		if (!this.#points[key])
			this.#points[key] = 0;

		this.#points[key] += points;

		if (this.#points[key] <= this.#limit)
			return true;
		else
			return false;
	}

	/**
	 * Reset accumulated points
	 */
	reset() {
		this.#points = {};
		this.#nextReset = Date.now() + this.#duration;
	}

	/**
	 * Point limit
	 */
	get limit() {
		return this.#limit;
	}

	/**
	 * Duration in ms between resets
	 */
	get duration() {
		return this.#duration;
	}

	/**
	 * The time in ms until next reset
	 */
	get timeUntilReset() {
		return this.#nextReset - Date.now();
	}

	/**
	 * The time in ms after which the client should retry
	 * @param {string} key - The key to take calculate the time for
	 * @returns {number}
	 */
	retryAfter(key) {
		return this.timeUntilReset + (this.#points[key] - this.limit - 1) * this.#durationToLimit;
	}
};

class RatelimitManager {
	/**
	 * @type {Record<string, import('./ratelimit').Ratelimit>}
	 */
	#ratelimits = {};

	/**
	 * Create a ratelimit instance with a given id
	 * @param {string} id - Id of the ratelimit instance to create
	 * @param {number} limit - Maximum allowed number of points
	 * @param {number} duration - Time in miliseconds between resets
	 */
	create(id, limit, duration) {
		if (this.#ratelimits[id])
			throw new Error(`[Ratelimit Manager] ID already in use: ${id}`);

		this.#ratelimits[id] = new module.exports.Ratelimit(limit, duration);
	}

	/**
	 * Consume a number of points from a key in a ratelimit instance if possible
	 * @param {string} id - Id of the ratelimit instance to consume from
	 * @param {string} key - The key to take the points from
	 * @param {number} points - The number of points to take [default: 1]
	 * @returns {boolean} Whether the request was within the limit or not
	 */
	consume(id, key, points = 1) {
		if (!this.#ratelimits[id])
			throw new Error(`[Ratelimit Manager] Unknown ID: ${id}`);

		return this.#ratelimits[id].consume(key, points);
	}

	/**
	 * Consume a number of points from a key in all ratelimit instances if possible (and return a combined result)
	 * @param {string[]} ids - Ids of the ratelimit instances to consume from
	 * @param {string} key - The key to take the points from
	 * @param {boolean} isAdmin - Makes the function return true immediately if set to true
	 * @param {number} points - The number of points to take [default: 1]
	 * @returns {boolean} Whether the request was within the limit or not
	 */
	consume2(ids, key, isAdmin = false, points = 1) {
		if (isAdmin)
			return true;

		let result = 1;
		for (const id of ids)
			result &= +this.consume(id, key, points);

		return !!result;
	}

	/**
	 * Reset accumulated points in an instance
	 * @param {string} id - Id of the ratelimit instance to reset
	 */
	reset(id) {
		if (!this.#ratelimits[id])
			throw new Error(`[Ratelimit Manager] Unknown ID: ${id}`);

		this.#ratelimits[id].reset();
	}

	/**
	 * Query the time in ms after which the client should retry
	 * @param {string} id - Id of the ratelimit instance to query
	 * @param {string} key - The key to take calculate the time for
	 * @returns {number}
	 */
	retryAfter(id, key) {
		if (!this.#ratelimits[id])
			throw new Error(`[Ratelimit Manager] Unknown ID: ${id}`);

		return this.#ratelimits[id].retryAfter(key);
	}

	/**
	 * @param {string} id - Id of the ratelimit instance to get
	 * @returns {import('./ratelimit').Ratelimit}
	 */
	getInstance(id) {
		return this.#ratelimits[id];
	}
}

module.exports.ratelimitManager = new RatelimitManager();

module.exports.MINUTE = 60 * 1000;
module.exports.HOUR = 60 * this.MINUTE;
module.exports.DAY = 24 * this.HOUR;
module.exports.WEEK = 7 * this.DAY;
