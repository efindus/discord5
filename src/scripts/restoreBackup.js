const zip = require('node-7z');
const { randomBytes } = require('crypto');
const { rm, rename } = require('fs/promises');
const { createInterface } = require('readline');
const { existsSync, mkdirSync, readFileSync } = require('fs');

const { ATTACHMENT_BASE_PATH } = require('../config');
const { connect, insertMany, removeMany } = require('../utils/database');

/**
 * @param {string} name
 * @returns {Promise<string[]>}
 */
const list = (name) => {
	return new Promise((resolve, reject) => {
		/**
		 * @type {string[]}
		 */
		const res = [];

		const x = zip.list(name);
		x.on('data', (data) => {
			if (data.attributes && data.attributes.startsWith('D'))
				return;

			res.push(data.file);
		});

		x.on('end', () => {
			resolve(res);
		});

		x.on('error', (err) => {
			reject(err);
		});
	});
};

/**
 * @param {string} name
 * @param {string} dest
 * @returns {Promise<void>}
 */
const extract = (name, dest) => {
	return new Promise((resolve, reject) => {
		const x = zip.extractFull(name, dest);

		x.on('end', () => {
			resolve();
		});

		x.on('error', (err) => {
			reject(err);
		});
	});
};

const main = async () => {
	const backupPath = process.argv[2];
	if (!backupPath) {
		console.error('Podaj lokalizację pliku kopii zapasowej jako pierwszy argument w konsoli.');
		return;
	}

	if (!existsSync(backupPath)) {
		console.error('Podany plik kopii zapasowej nie istnieje.');
		return;
	}

	let contents;
	try {
		contents = await list(backupPath);
	} catch {
		console.error('Wystąpił nieoczekiwany błąd. Upewnij się, że podany plik jest poprawny.');
		return;
	}

	if (!(contents.includes('db.json') && contents.some(x => x.startsWith('attachments')))) {
		console.error('Podany plik nie jest kopią zapasową Discord5.');
		return;
	}

	const tmpdir = `${ATTACHMENT_BASE_PATH}/.tmp_${randomBytes(10).toString('hex')}`;
	mkdirSync(tmpdir);

	try {
		await extract(backupPath, tmpdir);
	} catch (err) {
		console.error('Wystąpił nieoczekiwany błąd podczas rozpakowywania pliku:');
		console.error(err);
		return;
	}

	/**
	 * @type {{ users: import('../database/users').DBUser[], messages: import('../database/messages').DBMessage[], ipBans: { ip: string }[] }}
	 */
	const db = { users: [], messages: [], ipBans: [] };
	try {
		const rawdb = JSON.parse(readFileSync(`${tmpdir}/db.json`, 'utf8'));
		if (!(rawdb.users instanceof Array && rawdb.messages instanceof Array && rawdb.ipBans instanceof Array))
			throw {};

		for (const user of rawdb.users) {
			const { uid, nonce, type, username, nickname, password, salt } = user;
			if (!(typeof uid === 'string' && typeof nonce === 'string' && (type === 'normal' || type === 'admin') &&
			      typeof username === 'string' && typeof nickname === 'string' && typeof password === 'string' &&
			      typeof salt === 'string'
			)) {
				throw {};
			}

			db.users.push({ uid, nonce, type, username, nickname, password, salt });
		}

		for (const msg of rawdb.messages) {
			const { id, ts, message, uid, originalAuthor, attachment } = msg;
			if (!(typeof id === 'string' && typeof ts === 'number' && typeof message === 'string' && typeof uid === 'string'))
				throw {};

			if (originalAuthor && typeof originalAuthor !== 'string' || attachment && typeof attachment !== 'string')
				throw {};

			db.messages.push({ id, ts, message, uid, originalAuthor, attachment });
		}

		for (const ban of rawdb.ipBans) {
			const { ip } = ban;
			if (!(typeof ip === 'string'))
				throw {};

			db.ipBans.push({ ip });
		}
	} catch {
		console.error('Wystąpił nieoczekiwany błąd: kopia zapasowa jest uszkodzona.');
		await rm(tmpdir, { recursive: true, force: true });
		return;
	}

	createInterface(process.stdin, process.stdout).question(`Zaimportować ${db.users.length} użytkowników, ${db.messages.length} wiadomości i ${db.ipBans.length} banów IP? [y/N] `, async (answer) => {
		if (answer.toLowerCase() !== 'y') {
			await rm(tmpdir, { recursive: true, force: true });
			process.exit(0);
		}

		await connect();

		await removeMany('users');
		await removeMany('messages');
		await removeMany('ipBans');

		await insertMany('users', db.users);
		await insertMany('messages', db.messages);
		await insertMany('ipBans', db.ipBans);

		await rm(`${ATTACHMENT_BASE_PATH}/attachments`, { recursive: true, force: true });
		await rename(`${tmpdir}/attachments`, `${ATTACHMENT_BASE_PATH}/attachments`);
		await rm(tmpdir, { recursive: true, force: true });

		console.log('Import zakończony pomyślnie!');
		process.exit(0);
	});
};

main();
