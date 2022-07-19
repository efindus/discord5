class Ratelimit {
	#limit;
	#duration;
	#startOffset;

	#points = {};

	/**
	 * Create a ratelimit instance
	 * @param {number} limit - Maximum allowed number of points
	 * @param {number} duration - Time in miliseconds between resets
	 */
	constructor(limit, duration) {
		this.#limit = limit;
		this.#duration = duration;

		setInterval(this.reset, this.#duration);
		this.#startOffset = Date.now() % this.#duration;
	}

	/**
	 * Consume a number of points from a key if possible
	 * @param {string} key - The key to take the points from
	 * @param {number} points - The number of points to take
	 * @returns {boolean} Whether the request was within the limit or not
	 */
	consume(key, points = 1) {
		if (!this.#points[key]) this.#points[key] = 0;
		this.#points[key] += points;

		if (this.#points[key] <= this.#limit) return true;
		else return false;
	}

	/**
	 * Reset accumulated points
	 */
	reset() {
		this.#points = {};
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
		return (this.#duration - (Date.now() % this.#duration) + this.#startOffset) % this.#duration;
	}
}

class RatelimitManager {
	/**
	 * @type {Record<string, Ratelimit>}
	 */
	#ratelimits = {};

	/**
	 * Create a ratelimit instance with a given id
	 * @param {string} id - Id of the ratelimit instance to create
	 * @param {number} limit - Maximum allowed number of points
	 * @param {number} duration - Time in miliseconds between resets
	 */
	create(id, limit, duration) {
		if (this.#ratelimits[id]) throw new Error(`[Ratelimit Manager] ID already in use: ${id}`);

		this.#ratelimits[id] = new Ratelimit(limit, duration);
	}

	/**
	 * Consume a number of points from a key in a ratelimit instance if possible
	 * @param {string} id - Id of the ratelimit instance to consume from
	 * @param {string} key - The key to take the points from
	 * @param {number} points - The number of points to take
	 * @returns {boolean} Whether the request was within the limit or not
	 */
	consume(id, key, points) {
		if (!this.#ratelimits[id]) throw new Error(`[Ratelimit Manager] Unknown ID: ${id}`);

		return this.#ratelimits[id].consume(key, points);
	}

	/**
	 * Reset accumulated points in an instance
	 * @param {string} id - Id of the ratelimit instance to reset
	 */
	reset(id) {
		if (!this.#ratelimits[id]) throw new Error(`[Ratelimit Manager] Unknown ID: ${id}`);

		this.#ratelimits[id].reset();
	}

	/**
	 * @param {string} id - Id of the ratelimit instance to get
	 * @returns {Ratelimit}
	 */
	getInstance(id) {
		return this.#ratelimits[id];
	}
}
