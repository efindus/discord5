const zip = require('node-7z');
const { writeFileSync } = require('fs');
const { randomBytes } = require('crypto');

const { ATTACHMENT_BASE_PATH } = require('../config');
const { connect, findMany } = require('../utils/database');
const { rm } = require('fs/promises');

/**
 * @param {string} name
 * @param {string[]} files
 * @returns {Promise<void>}
 */
const archive = (name, files) => {
	return new Promise((resolve, reject) => {
		const x = zip.add(name, files, {
			recursive: true,
		});

		x.on('end', () => {
			resolve();
		});

		x.on('error', (err) => {
			reject(err);
		});
	});
};

/**
 * @param {string} name
 * @param {string[][]} changes
 * @returns {Promise<void>}
 */
const rename = (name, changes) => {
	return new Promise((resolve, reject) => {
		const x = zip.rename(name, changes);

		x.on('end', () => {
			resolve();
		});

		x.on('error', (err) => {
			reject(err);
		});
	});
};

const main = async () => {
	console.log('Tworzenie kopii zapasowej...');

	await connect();

	const dbBackup = {
		users: await findMany('users'),
		messages: await findMany('messages', {}, { id: 1 }),
		ipBans: await findMany('ipBans'),
	};

	const tmpfile = `${ATTACHMENT_BASE_PATH}/.tmp_${randomBytes(10).toString('hex')}.json`;
	writeFileSync(tmpfile, JSON.stringify(dbBackup, null, 2));

	const name = `${ATTACHMENT_BASE_PATH}/backup.${new Date().toISOString()}.7z`;
	try {
		await archive(name, [ tmpfile, `${ATTACHMENT_BASE_PATH}/attachments` ]);
		await rename(name, [ [ tmpfile.slice(tmpfile.lastIndexOf('/') + 1), 'db.json' ] ]);
		console.log(`Pomyślnie utworzono kopię zapasową: ${name}`);
	} catch (err) {
		await rm(name);
		console.error('Wystąpił nieoczekiwany błąd:');
		console.error(err);
	}

	await rm(tmpfile);
	process.exit(0);
};

main();
