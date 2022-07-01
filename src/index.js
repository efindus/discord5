const { existsSync, readFileSync, mkdirSync, writeFileSync } = require('fs')

global.db = {
    sessions: {
        'efindusFTW': {
            username: 'efindus',
            connected: false,
            sessionIDHash: '1b103e73ac4bb641681419030d92ed3af163fa35f10b9c57f9aefce8257b7378',
        },
		'[Server]': {
			username: '[Server]',
			connected: true,
			sessionIDHash: '0170fdf90e06a44d9fdb151332dd0c9e121854eca9280251a2f884d167820f92',
		}
    },
    messages: [
        {
            messageID: '1625650625672-randombull$hitfromcrypto',
            sessionIDHash: '1b103e73ac4bb641681419030d92ed3af163fa35f10b9c57f9aefce8257b7378',
            message: 'It\'s awesome!',
            timestamp: 1625650625672,
        }
    ],
    ipBans: [
        '10.222.86.181'
    ]
}

if (!existsSync('data'))
{
    mkdirSync('data')
}

if (!existsSync('data/errors'))
{
    mkdirSync('data/errors')
}

if (!existsSync('./data/db.json'))
{
    writeFileSync('./data/db.json', JSON.stringify(db))
}
else
{
    db = JSON.parse(readFileSync('./data/db.json'))
    for (let i = 0; i < Object.keys(db.sessions).length; i++) {
        db.sessions[Object.keys(db.sessions)[i]].connected = false
        if (Object.keys(db.sessions)[i] === '[Server]') {
            db.sessions[Object.keys(db.sessions)[i]].connected = true
        }
        if (db.sessions[Object.keys(db.sessions)[i]].username === '') {
            delete db.sessions[Object.keys(db.sessions)[i]]
            i--
        }
    }
}

const { request, websocket } = require('./requests');
const { bold, red } = require('./utils/colors');
const { Server } = require('./utils/server');

const server = new Server(readFileSync('server.key'), readFileSync('server.cert'), 8420);

server.on("request", request);
server.on("websocket", websocket);

console.log('Discord 4.0 started!');

process.on("uncaughtException", error => {
    console.log(`${bold(red(`Error: ${error.stack}`))}`);
    writeFileSync(`./data/errors/error-${Date.now()}.txt`, error.stack);
});

let oldDB = Object.assign({}, db)

setInterval(() => {
    if (oldDB !== db) {
        writeFileSync('./data/db.json', JSON.stringify(db, null, 2))
        oldDB = Object.assign({}, db)
    }
}, 10000)