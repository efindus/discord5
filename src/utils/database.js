const { MongoClient } = require('mongodb');

const { DATABASE_NAME } = require('../config');

const client = new MongoClient('mongodb://127.0.0.1:27017', { forceServerObjectId: true });

module.exports.connect = () => {
	return client.connect();
};

/** @type {import("../types").insertOne} */
module.exports.insertOne = async (collection, document) => {
	await client.db(DATABASE_NAME).collection(collection).insertOne(document);
};

/** @type {import("../types").insertMany} */
module.exports.insertMany = async (collection, documents) => {
	await client.db(DATABASE_NAME).collection(collection).insertMany(documents);
};

/** @type {import("../types").collectionLength} */
module.exports.collectionLength = (collection) => {
	return client.db(DATABASE_NAME).collection(collection).countDocuments();
};

/** @type {import("../types").findOne} */
module.exports.findOne = (collection, filter = {}, withDocumentID = false, customProjection = {}) => {
	return /** @type {any} */ (client.db(DATABASE_NAME).collection(collection).findOne(filter, {
		projection: withDocumentID ? customProjection : { _id: 0, ...customProjection },
	}));
};

/** @type {import("../types").findMany} */
module.exports.findMany = (collection, filter = {}, sort = {}, limit = undefined, skip = 0, withDocumentID = false, customProjection = {}) => {
	return /** @type {any} */ (client.db(DATABASE_NAME).collection(collection).find(filter, {
		sort: /** @type {any} */ (sort),
		limit,
		skip,
		projection: withDocumentID ? customProjection : { _id: 0, ...customProjection },
	}).toArray());
};

/** @type {import("../types").updateOne} */
module.exports.updateOne = async (collection, filter, changes, options = {}, customUpdate = {}) => {
	await client.db(DATABASE_NAME).collection(collection).updateOne(filter, { $set: changes, ...customUpdate }, options);
};

/** @type {import("../types").updateMany} */
module.exports.updateMany = async (collection, filter, changes, options = {}, customUpdate = {}) => {
	await client.db(DATABASE_NAME).collection(collection).updateMany(filter, { $set: changes, ...customUpdate }, options);
};

/** @type {import("../types").removeOne} */
module.exports.removeOne = async (collection, filter) => {
	await client.db(DATABASE_NAME).collection(collection).deleteOne(filter);
};

/** @type {import("../types").removeMany} */
module.exports.removeMany = async (collection, filter) => {
	await client.db(DATABASE_NAME).collection(collection).deleteMany(filter);
};

/** @type {import("../types").createIndex} */
module.exports.createIndex = async (collection, index) => {
	await client.db(DATABASE_NAME).collection(collection).createIndex(/** @type {any} */ (index));
};
