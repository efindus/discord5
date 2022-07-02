/* eslint-disable no-undef */
let username = '';
let socket;
const sessions = {};
const messages = [];
const notifications = [];
const messagesToLoad = 50;
let isDropdownOpen = false, isClosablePopupOpen = false;

const elements = {
	topBar: document.querySelector('.top-bar'),
	siteBody: document.querySelector('.site-body'),
	bottomBar: document.querySelector('.bottom-bar'),

	popup: document.getElementById('popup'),
	popupClose: document.getElementById('popup-close'),
	popupTitle: document.getElementById('popup-title'),
	popupSubtitle: document.getElementById('popup-subtitle'),
	popupBody: document.getElementById('popup-body'),

	usernameContainer: document.getElementById('username-container'),
	usernameDisplay: document.getElementById('username-display'),
	dropdown: document.querySelector('.dropdown'),
	dropdownClose: document.getElementById('dropdown-close'),

	messageContainer: document.getElementById('message-container'),
	messages: document.getElementById('messages'),
	loadMessagesButton: document.getElementById('load-messages-button'),

	input: document.getElementById('input'),
	uploadInput: document.getElementById('upload-input'),
	uploadButton: document.getElementById('upload-button'),

	clock: document.getElementById('clock'),
};

const svgs = {
	plus: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" y1="0.5" x2="0.75" y2="0.5" stroke="var(--text)" stroke-width="0.06"></line>
			<line x1="0.5" y1="0.25" x2="0.5" y2="0.75" stroke="var(--text)" stroke-width="0.06"></line>
		</svg>`,
	cross: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" x2="0.75" stroke="var(--text)" stroke-width="0.06" y1="0.25" y2="0.75"></line>
			<line y1="0.25" y2="0.75" stroke="var(--text)" stroke-width="0.06" x2="0.25" x1="0.75"></line>
		</svg>`,
};

const xd = {
	title: '',
	subtitle: '',
	closeable: true,
	body: [
		{
			label: '',
			input: {
				id: '',
				type: '',
			},
		},
	],
	footer: [
		{
			label: '',
			id: '',
		},
	],
};

const showPopup = (data) => {
	elements.topBar.style.display = 'none';
	elements.siteBody.style.display = 'none';
	elements.bottomBar.style.display = 'none';

	elements.popup.style.display = '';
	elements.popupTitle.innerHTML = data.title;

	if (data.subtitle?.length > 0) {
		elements.popupSubtitle.style.display = '';
		elements.popupSubtitle.innerHTML = data.subtitle;
	} else {
		elements.popupSubtitle.style.display = 'none';
	}

	if (data.closeable) {
		elements.popupClose.style.display = '';
		isClosablePopupOpen = true;
	} else {
		elements.popupClose.style.display = 'none';
	}

	if (data.body) {
		for (const row of data.body) {
			const rowElement = document.createElement('div');
			const label = document.createElement('div');
			label.innerHTML = row.label;
			label.classList.add('popup-row-label');
			const input = document.createElement('input');
			input.id = row.input.id;
			input.type = row.input.type;
			input.classList.add('popup-row-input');
			rowElement.appendChild(label);
			rowElement.appendChild(input);
			elements.popupBody.appendChild(rowElement);
		}
	}
};

// showPopup({
// 	title: 'Logowanie',
// 	subtitle: '',
// 	closeable: true,
// 	body: [
// 		{
// 			label: 'Nazwa użytkownika',
// 			input: {
// 				id: 'popup-input-username',
// 				type: 'text',
// 			},
// 		},
// 	],
// });

const hidePopup = () => {
	elements.topBar.style.display = '';
	elements.siteBody.style.display = '';
	elements.bottomBar.style.display = '';

	elements.popup.style.display = 'none';
};

document.addEventListener('keyup', (ev) => {
	if (ev.code === 'Escape' && isClosablePopupOpen) {
		hidePopup();
		isClosablePopupOpen = false;
	}
});

const propagateUsername = (username) => {
	elements.usernameDisplay.innerText = username;
};

const sha256 = async (message) => {
	const msgBuffer = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
};

const regenSessionID = () => {
	localStorage.removeItem('sid');
	socket.close();
};

const generateMessage = (msgData) => {
	const codeBlockIndex = msgData.message.indexOf('```');
	let addNL = true;
	for (let i = 0; i < codeBlockIndex; i++) {
		if (msgData.message[i] !== ' ') {
			addNL = false;
			break;
		}
	}

	if (addNL && codeBlockIndex !== -1) msgData.message = '\n' + msgData.message;
	const message = document.createElement('div');
	message.id = msgData.id;
	message.classList.add('message');
	message.innerHTML = `<div class='message-highlight'>[${new Date(msgData.ts).toLocaleString('pl')}]</div><span class='message-highlight'>${sessions[msgData.sidHash]}</span><div class='message-content'>${markdownToHTML(sanitizeText(msgData.message)).split('\n').join('<br>')}</div>`;
	return message;
};

const addMessage = (msgData) => {
	if (!sessions[msgData.sidHash]) {
		sessions[msgData.sidHash] = msgData.sidHash.slice(0, 10);
		socket.send(JSON.stringify({
			type: 'get-session-id-hash',
			sidHash: msgData.sidHash,
		}));
	}

	const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;
	elements.messages.appendChild(generateMessage(msgData));

	messages.push(msgData);

	if (!document.hasFocus() && Notification.permission === 'granted') {
		const notif = new Notification('Discord 4.0: New Message', {
			body: `${sessions[msgData.sidHash]}: ${msgData.message.slice(0, 150)}`,
			icon: '/favicon.ico',
		});

		notif.index = notifications.length;
		notif.onclose = () => {
			notifications.splice(notif.index, 1);
		};

		notifications.push(notif);
	}

	if (scroll) elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
};

const insertMessage = (msgData) => {
	if (!sessions[msgData.sidHash]) {
		sessions[msgData.sidHash] = msgData.sidHash.slice(0, 10);
		socket.send(JSON.stringify({
			type: 'get-session-id-hash',
			sidHash: msgData.sidHash,
		}));
	}

	messages.splice(0, 0, msgData);

	elements.messages.insertBefore(generateMessage(msgData), elements.messages.firstChild);
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	socket.send(JSON.stringify({
		type: 'get-messages',
	}));
};

const sanitizeText = (text) => {
	text = text.split('&').join('&amp;');
	text = text.split('<').join('&lt;');
	return text;
};

const connect = () => {
	socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
	showPopup({
		title: 'Łączenie...',
	});
	let pinger;

	socket.onopen = () => {
		if (localStorage.getItem('sid') === null || localStorage.getItem('sid').length === 0) {
			const randArr = new Uint32Array(40);
			crypto.getRandomValues(randArr);

			let randString = '';
			for (const rand of randArr) randString += `${rand}`;

			randString = btoa(randString);
			localStorage.setItem('sid', randString);
		}

		pinger = setInterval(() => {
			socket.send(JSON.stringify({
				type: 'ping',
			}));
		}, 5000);

		socket.send(JSON.stringify({
			type: 'connect',
			sid: localStorage.getItem('sid'),
		}));
	};

	socket.onmessage = async (event) => {
		const data = JSON.parse(event.data);

		if (data.type === 'connect-cb') {
			if (data.message === 'accepted') {
				propagateUsername(data.username);
				username = data.username;
				loadMessages();
				hidePopup();
			} else if (data.message === 'sessionID-already-online') {
				showPopup('Ta sesja jest obecnie aktywna...', 'Jeżeli chcesz nowe ID sesji wpisz regenSessionID() w konsoli lub wyczyść dane strony');
			} else if (data.message === 'request-username') {
				changeUsername();
			}
		} else if (data.type === 'new-message') {
			addMessage(data);
		} else if (data.type === 'load-messages') {
			const oldHeight = elements.messageContainer.scrollHeight;
			for (const message of data.messages) {
				insertMessage(message);
			}

			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
			if (data.messages.length === messagesToLoad) elements.loadMessagesButton.style.display = 'table';
		} else if (data.type === 'update-username') {
			data.username = sanitizeText(data.username);
			if (data.sidHash === await sha256(localStorage.getItem('sid'))) {
				if (messages.length === 0) {
					loadMessages();
					propagateUsername(data.username);
					username = data.username;
				}
				hidePopup();
			}

			if (data.username.length !== 0) {
				sessions[data.sidHash] = data.username;

				for (const msg of messages) {
					if (msg.sidHash === data.sidHash) {
						document.getElementById(msg.id).childNodes[1].innerHTML = sessions[data.sidHash];
					}
				}
			}
		} else if (data.type === 'reload') {
			window.location.reload();
		}
	};

	socket.onclose = () => {
		clearInterval(pinger);
		elements.messages.innerHTML = '';
		showPopup({
			title: 'Łączenie...',
		});

		setTimeout(connect, 1000);
	};
};

const changeUsername = () => {
	isClosablePopupOpen = true;
	showPopup({
		title: 'Ustaw swój pseudonim',
		body: [
			{
				label: '',
				input: {
					id: 'popup-input-username',
					type: 'text',
				},
			},
		],
	});
	const popupInput = document.getElementById('popup-input-username');
	popupInput.onkeyup = (event) => {
		if(event.code === 'Enter' || event.keyCode === 13) {
			const value = popupInput.value.trim();

			if(value.length < 3 || value.length > 32) {
				showPopup('Ustaw swój pseudonim', 'Pseudonim powinien zawierać od 3 do 32 znaków.', true);
			} else {
				username = value;
				socket.send(JSON.stringify({
					type: 'set-username',
					username,
				}));

				propagateUsername(username);
				isClosablePopupOpen = false;
			}
		}
	};

	popupInput.value = username;
};

elements.input.addEventListener('keydown', event => {
	if((event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
		event.preventDefault();

		let value = elements.input.value.trim();

		if(value === '/tableflip') {
			value = '(╯°□°）╯︵ ┻━┻';
		} else if(value === '/unflip') {
			value = '┬─┬ ノ( ゜-゜ノ)';
		} else if(value === '/shrug') {
			value = '¯\\\\_(ツ)_/¯';
		}

		if(value.length >= 1 && value.length <= 2000) {
			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
			elements.input.value = '';

			socket.send(JSON.stringify({
				type: 'send-message',
				message: value,
			}));
		}
	}
});

const toggleDropdown = () => {
	if (isDropdownOpen) {
		isDropdownOpen = false;
		elements.dropdown.style.display = 'none';
		elements.usernameContainer.classList.remove('dropdown-open');
		elements.dropdownClose.style.display = 'none';
	} else {
		isDropdownOpen = true;
		elements.dropdown.style.display = 'flex';
		elements.usernameContainer.classList.add('dropdown-open');
		elements.dropdownClose.style.display = 'block';
	}
};

elements.uploadInput.addEventListener('change', () => {
	if (elements.uploadInput.value !== '') {
		elements.uploadButton.innerHTML = svgs.cross;
	}
});
elements.uploadButton.addEventListener('click', (evt) => {
	if (elements.uploadInput.value !== '') {
		evt.preventDefault();
		elements.uploadButton.innerHTML = svgs.plus;
		elements.uploadInput.value = '';
	}
});

elements.usernameContainer.addEventListener('click', toggleDropdown);
elements.dropdownClose.addEventListener('click', toggleDropdown);

const updateClock = () => {
	const NOW = new Date();
	elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
	setTimeout(updateClock, 1000 - (Date.now() % 1000));
};

updateClock();
connect();

elements.messageContainer.onscroll = () => {
	if (Notification.permission === 'default') Notification.requestPermission();
};
