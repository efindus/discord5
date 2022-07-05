/* eslint-disable no-undef */
const state = {
	username: '',
	socket: null,
	sessions: {},
	messages: [],
	notifications: [],
	messagesToLoad: 50,
	isDropdownOpen: false,
	isClosablePopupOpen: false,
};

const elements = {
	topBar: document.querySelector('.top-bar'),
	siteBody: document.querySelector('.site-body'),
	bottomBar: document.querySelector('.bottom-bar'),

	popup: document.getElementById('popup'),
	popupClose: document.getElementById('popup-close'),
	popupHeader: document.getElementById('popup-header'),
	popupTitle: document.getElementById('popup-title'),
	popupSubtitle: document.getElementById('popup-subtitle'),
	popupBody: document.getElementById('popup-body'),
	popupFooter: document.getElementById('popup-footer'),

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

/**
 * @typedef Row
 * @property {string} label Label of the row
 * @property {object} input
 * @property {string} input.id ID of the input
 * @property {string} input.type Type of the input
 */

/**
 * @typedef FooterButton
 * @property {string} label Label of the button
 * @property {string} id ID of the button
 * @property {string} color Color of the button
 */

/**
 * Create a modal
 * @param {object} data Parameters used to construct the modal
 * @param {string} data.title Popup title
 * @param {string} data.subtitle Popup subtitle
 * @param {string} data.subtitleColor Popup subtitle color
 * @param {boolean} data.closeable Allow closing the popup?
 * @param {Record<number, Row>} data.body Popup body
 * @param {Record<number, FooterButton>} data.footer Popup footer
 */
const showPopup = (data) => {
	elements.topBar.style.display = 'none';
	elements.siteBody.style.display = 'none';
	elements.bottomBar.style.display = 'none';

	elements.popup.style.display = '';
	elements.popupTitle.innerHTML = data.title;

	if (data.subtitle?.length > 0) {
		elements.popupSubtitle.style.display = '';
		elements.popupSubtitle.innerHTML = data.subtitle;
		elements.popupSubtitle.style.color = data.subtitleColor ?? '';
	} else {
		elements.popupSubtitle.style.display = 'none';
	}

	if (data.closeable) {
		elements.popupClose.style.display = '';
		state.isClosablePopupOpen = true;
	} else {
		elements.popupClose.style.display = 'none';
		state.isClosablePopupOpen = false;
	}

	elements.popupBody.innerHTML = '';
	if (data.body) {
		elements.popupHeader.style.margin = '';
		elements.popupTitle.style.margin = '';
		for (const row of data.body) {
			const rowElement = document.createElement('div');
			rowElement.classList.add('popup-row');
			rowElement.innerHTML = `<div class="popup-row-label">${row.label}</div><input id="${row.input.id}" class="popup-row-input" type="${row.input.type}">`;
			elements.popupBody.appendChild(rowElement);
		}
		elements.popupBody.lastChild.style.marginBottom = '0px';
	} else {
		elements.popupHeader.style.margin = '0px';
		elements.popupTitle.style.margin = '0px';
	}

	elements.popupFooter.innerHTML = '';
	if (data.footer) {
		elements.popupBody.lastChild.style.marginBottom = '15px';
		for (const button of data.footer) {
			const buttonElement = document.createElement('div');
			buttonElement.classList.add('popup-button');
			buttonElement.id = button.id;
			buttonElement.innerHTML = button.label;
			buttonElement.style.backgroundColor = button.color ?? 'var(--blue)';
			elements.popupFooter.appendChild(buttonElement);
		}
		elements.popupFooter.lastChild.style.marginBottom = '0px';
	}
};

const hidePopup = () => {
	elements.topBar.style.display = '';
	elements.siteBody.style.display = '';
	elements.bottomBar.style.display = '';

	elements.popup.style.display = 'none';
	state.isClosablePopupOpen = false;
};

document.addEventListener('keyup', (ev) => {
	if (ev.code === 'Escape' && state.isClosablePopupOpen) {
		hidePopup();
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
	state.socket.close();
};

const generateMessage = (msgData) => {
	const message = document.createElement('div');
	message.id = msgData.id;
	message.classList.add('message');
	message.innerHTML = `<div class="message-meta"><span class="message-username">${state.sessions[msgData.sidHash]}</span><div class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</div></div><div class="message-content">${markdownToHTML(sanitizeText(msgData.message)).split('\n').join('<br>')}</div>`;
	return message;
};

const addMessage = (msgData) => {
	if (!state.sessions[msgData.sidHash]) {
		state.sessions[msgData.sidHash] = msgData.sidHash.slice(0, 10);
		state.socket.send(JSON.stringify({
			type: 'get-session-id-hash',
			sidHash: msgData.sidHash,
		}));
	}

	const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;
	elements.messages.appendChild(generateMessage(msgData));

	state.messages.push(msgData);

	if (!document.hasFocus() && Notification.permission === 'granted') {
		const notif = new Notification('Discord 4.0: New Message', {
			body: `${state.sessions[msgData.sidHash]}: ${msgData.message.slice(0, 150)}`,
			icon: '/favicon.ico',
		});

		notif.index = state.notifications.length;
		notif.onclose = () => {
			state.notifications.splice(notif.index, 1);
		};

		state.notifications.push(notif);
	}

	if (scroll) elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
};

const insertMessage = (msgData) => {
	if (!state.sessions[msgData.sidHash]) {
		state.sessions[msgData.sidHash] = msgData.sidHash.slice(0, 10);
		state.socket.send(JSON.stringify({
			type: 'get-session-id-hash',
			sidHash: msgData.sidHash,
		}));
	}

	state.messages.splice(0, 0, msgData);

	elements.messages.insertBefore(generateMessage(msgData), elements.messages.firstChild);
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	state.socket.send(JSON.stringify({
		type: 'get-messages',
	}));
};

const sanitizeText = (text) => {
	text = text.split('&').join('&amp;');
	text = text.split('<').join('&lt;');
	return text;
};

const connect = () => {
	state.socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
	showPopup({
		title: 'Łączenie...',
	});
	let pinger;

	state.socket.onopen = () => {
		if (localStorage.getItem('sid') === null || localStorage.getItem('sid').length === 0) {
			const randArr = new Uint32Array(40);
			crypto.getRandomValues(randArr);

			let randString = '';
			for (const rand of randArr) randString += `${rand}`;

			randString = btoa(randString);
			localStorage.setItem('sid', randString);
		}

		pinger = setInterval(() => {
			state.socket.send(JSON.stringify({
				type: 'ping',
			}));
		}, 5000);

		state.socket.send(JSON.stringify({
			type: 'connect',
			sid: localStorage.getItem('sid'),
		}));
	};

	state.socket.onmessage = async (event) => {
		const data = JSON.parse(event.data);

		if (data.type === 'connect-cb') {
			if (data.message === 'accepted') {
				propagateUsername(data.username);
				state.username = data.username;
				loadMessages();
				hidePopup();
			} else if (data.message === 'sessionID-already-online') {
				showPopup({
					title: 'Ta sesja jest obecnie aktywna...',
					subtitle: 'Jeżeli chcesz nowe ID sesji wpisz regenSessionID() w konsoli lub wyczyść dane strony',
				});
			} else if (data.message === 'request-username') {
				changeUsername(false);
			}
		} else if (data.type === 'new-message') {
			addMessage(data);
		} else if (data.type === 'load-messages') {
			const oldHeight = elements.messageContainer.scrollHeight;
			for (const message of data.messages) {
				insertMessage(message);
			}

			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
			if (data.messages.length === state.messagesToLoad) elements.loadMessagesButton.style.display = 'table';
		} else if (data.type === 'update-username') {
			data.username = sanitizeText(data.username);
			if (data.sidHash === await sha256(localStorage.getItem('sid'))) {
				if (state.messages.length === 0) {
					loadMessages();
					propagateUsername(data.username);
					state.username = data.username;
				}
				hidePopup();
			}

			if (data.username.length !== 0) {
				state.sessions[data.sidHash] = data.username;

				for (const msg of state.messages) {
					if (msg.sidHash === data.sidHash) {
						document.getElementById(msg.id).childNodes[0].childNodes[0].innerHTML = state.sessions[data.sidHash];
					}
				}
			}
		} else if (data.type === 'reload') {
			window.location.reload();
		}
	};

	state.socket.onclose = () => {
		clearInterval(pinger);
		elements.messages.innerHTML = '';
		showPopup({
			title: 'Łączenie...',
		});

		setTimeout(connect, 1000);
	};
};

const changeUsername = (closeable = true, subtitle = '', startingValue = '') => {
	showPopup({
		title: 'Ustaw swój pseudonim',
		subtitle: subtitle,
		closeable: closeable,
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
		if (event.code === 'Enter' || event.keyCode === 13) {
			const value = popupInput.value.trim();

			if (value.length < 3 || value.length > 32) {
				changeUsername(closeable, 'Pseudonim powinien zawierać od 3 do 32 znaków.', value);
			} else {
				state.username = value;
				state.socket.send(JSON.stringify({
					type: 'set-username',
					username: state.username,
				}));

				propagateUsername(state.username);
			}
		}
	};

	popupInput.value = startingValue === '' ? state.username : startingValue;
	popupInput.focus();
};

elements.input.addEventListener('keydown', event => {
	if ((event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
		event.preventDefault();

		let value = elements.input.value.trim();

		if (value === '/tableflip') {
			value = '(╯°□°）╯︵ ┻━┻';
		} else if (value === '/unflip') {
			value = '┬─┬ ノ( ゜-゜ノ)';
		} else if (value === '/shrug') {
			value = '¯\\\\_(ツ)_/¯';
		}

		if (value.length >= 1 && value.length <= 2000) {
			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
			elements.input.value = '';

			state.socket.send(JSON.stringify({
				type: 'send-message',
				message: value,
			}));
		}
	}
});

const toggleDropdown = () => {
	if (state.isDropdownOpen) {
		state.isDropdownOpen = false;
		elements.dropdown.style.display = 'none';
		elements.usernameContainer.classList.remove('dropdown-open');
		elements.dropdownClose.style.display = 'none';
	} else {
		state.isDropdownOpen = true;
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

/*
showPopup({
	title: 'Zaloguj się',
	subtitle: '',
	closeable: true,
	body: [
		{
			label: 'Nazwa użytkownika',
			input: {
				id: 'popup-input-username',
				type: 'text',
			},
		},
		{
			label: 'Hasło',
			input: {
				id: 'popup-input-password',
				type: 'password',
			},
		},
	],
	footer: [
		{
			id: 'popup-button-login',
			label: 'Zaloguj się',
		},
		{
			id: 'popup-button-register',
			label: 'Zarejestruj się',
			color: 'var(--orange)',
		},
	],
});
*/
