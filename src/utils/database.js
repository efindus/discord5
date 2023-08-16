const { MongoClient } = require('mongodb');

const DATABASE_NAME = 'discord5';
const client = new MongoClient('mongodb://127.0.0.1:27017', { forceServerObjectId: true });

const connect = () => {
	return client.connect();
};

const insertOne = async (collection, document) => {
	await client.db(DATABASE_NAME).collection(collection).insertOne(document);
};

const insertMany = async (collection, documents) => {
	await client.db(DATABASE_NAME).collection(collection).insertMany(documents);
};

const collectionLength = (collection) => {
	return client.db(DATABASE_NAME).collection(collection).countDocuments();
};

const findOne = (collection, filter = {}, withDocumentID = false) => {
	return client.db(DATABASE_NAME).collection(collection).findOne(filter, {
		projection: withDocumentID ? {} : { _id: 0 },
	});
};

const findMany = (collection, filter = {}, sort = {}, limit = null, skip = 0, withDocumentID = false) => {
	return client.db(DATABASE_NAME).collection(collection).find(filter, {
		sort: sort,
		limit: limit,
		skip: skip,
		projection: withDocumentID ? {} : { _id: 0 },
	}).toArray();
};

const updateOne = async (collection, filter, changes) => {
	await client.db(DATABASE_NAME).collection(collection).updateOne(filter, { $set: changes });
};

const updateMany = async (collection, filter, changes) => {
	await client.db(DATABASE_NAME).collection(collection).updateMany(filter, { $set: changes });
};

const removeOne = async (collection, filter) => {
	await client.db(DATABASE_NAME).collection(collection).deleteOne(filter);
};

const removeMany = (collection, filter) => {
	return client.db(DATABASE_NAME).collection(collection).deleteMany(filter);
};

const createIndex = (collection, index) => {
	return client.db(DATABASE_NAME).collection(collection).createIndex(index);
};

module.exports = { connect, insertOne, insertMany, collectionLength, findOne, findMany, updateOne, updateMany, removeOne, removeMany, createIndex };
