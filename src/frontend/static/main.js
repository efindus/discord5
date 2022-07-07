/* eslint-disable no-undef */
const state = {
	user: {},
	socket: null,
	users: {},
	messages: [],
	notifications: [],
	messagesToLoad: 50,
	isDropdownOpen: false,
	isClosablePopupOpen: false,
	reconnect: false,
	protocolVersion: '1',
	timeOffset: 0,
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
	userData: document.getElementById('user-data'),

	messageContainer: document.getElementById('message-container'),
	messages: document.getElementById('messages'),
	loadMessagesButton: document.getElementById('load-messages-button'),

	input: document.getElementById('input'),
	uploadInput: document.getElementById('upload-input'),
	uploadButton: document.getElementById('upload-button'),

	clock: document.getElementById('clock'),
	spinner: document.getElementById('spinner'),
};

const svgs = {
	plus: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" y1="0.5" x2="0.75" y2="0.5" stroke="var(--upload-svg)" stroke-width="0.06"></line>
			<line x1="0.5" y1="0.25" x2="0.5" y2="0.75" stroke="var(--upload-svg)" stroke-width="0.06"></line>
		</svg>`,
	cross: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" x2="0.75" stroke="var(--upload-svg)" stroke-width="0.06" y1="0.25" y2="0.75"></line>
			<line y1="0.25" y2="0.75" stroke="var(--upload-svg)" stroke-width="0.06" x2="0.25" x1="0.75"></line>
		</svg>`,
};

/**
 * @typedef Row
 * @property {string} label Label of the row
 * @property {object} input
 * @property {string} input.id ID of the input
 * @property {string} input.type Type of the input
 * @property {number?} input.limit Max length of inputed text
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

	setPopupSubtitle(data);

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
			if (row.input) {
				rowElement.innerHTML = `<div class="popup-row-label">${row.label}</div><input id="${row.input.id}" class="popup-row-input" type="${row.input.type}" ${row.input.limit ? ` maxlength="${row.input.limit}"` : ''}>`;
			} else {
				rowElement.innerHTML = row.html;
			}
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

/**
 * Set the subtitle
 * @param {object} data
 * @param {string} data.subtitle Popup subtitle
 * @param {string} data.subtitleColor Popup subtitle color
 */
const setPopupSubtitle = (data) => {
	if (data.subtitle?.length > 0) {
		elements.popupSubtitle.style.display = '';
		elements.popupSubtitle.innerHTML = data.subtitle;
		elements.popupSubtitle.style.color = data.subtitleColor ?? '';
	} else {
		elements.popupSubtitle.style.display = 'none';
	}
};

const hidePopup = () => {
	elements.topBar.style.display = '';
	elements.siteBody.style.display = '';
	elements.bottomBar.style.display = '';

	elements.popup.style.display = 'none';
	state.isClosablePopupOpen = false;
};

const showSpinner = () => {
	elements.spinner.style.display = '';
};

const hideSpinner = () => {
	elements.spinner.style.display = 'none';
};

document.addEventListener('keyup', (ev) => {
	if (ev.code === 'Escape' && state.isClosablePopupOpen) {
		hidePopup();
	}
});

const propagateUserData = () => {
	elements.usernameDisplay.innerText = state.user.username;
	elements.userData.innerHTML = `ID: ${state.user.uid}<br>Pseudonim: ${state.user.nickname}`;
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
	message.innerHTML = `<div class="message-meta"><span class="message-username">${state.users[msgData.uid]}</span><div class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</div></div><div class="message-content">${markdownToHTML(sanitizeText(msgData.message)).split('\n').join('<br>')}</div>`;
	return message;
};

const addMessage = (msgData) => {
	if (!state.users[msgData.uid]) {
		state.users[msgData.uid] = msgData.uid.slice(0, 10);
		state.socket.send(JSON.stringify({
			type: 'getNickname',
			uid: msgData.uid,
		}));
	}

	const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;
	elements.messages.appendChild(generateMessage(msgData));

	state.messages.push(msgData);

	if (!document.hasFocus() && Notification.permission === 'granted') {
		const notif = new Notification('Discord5: New Message', {
			body: `${state.users[msgData.uid]}: ${msgData.message.slice(0, 150)}`,
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
	if (!state.users[msgData.uid]) {
		state.users[msgData.uid] = msgData.uid.slice(0, 10);
		state.socket.send(JSON.stringify({
			type: 'getNickname',
			uid: msgData.uid,
		}));
	}

	state.messages.splice(0, 0, msgData);

	elements.messages.insertBefore(generateMessage(msgData), elements.messages.firstChild);
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	state.socket.send(JSON.stringify({
		type: 'getMessages',
	}));
};

const sanitizeText = (text) => {
	text = text.split('&').join('&amp;');
	text = text.split('<').join('&lt;');
	return text;
};

const connect = () => {
	state.socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
	state.reconnect = true;
	showSpinner();
	hidePopup();
	let pinger;

	state.socket.onopen = () => {
		pinger = setInterval(() => {
			state.socket.send(JSON.stringify({
				type: 'ping',
			}));
		}, 20_000);
	};

	state.socket.onmessage = async (event) => {
		const data = JSON.parse(event.data);

		if (data.type === 'connectionReady') {
			state.socket.send(JSON.stringify({
				type: 'authorize',
				token: localStorage.getItem('token'),
			}));
		} else if (data.type === 'authorizeCB') {
			if (data.message === 'accepted') {
				if (state.protocolVersion !== data.protocolVersion) window.location.reload();

				state.user = data.user;
				state.messagesToLoad = data.messagesToLoad;
				state.timeOffset = Date.now() - data.serverTime;

				propagateUserData();
				loadMessages();
				hideSpinner();
			} else if (data.message === 'invalidLogin') {
				logOut();
			}
		} else if (data.type === 'newMessage') {
			addMessage(data);
		} else if (data.type === 'loadMessages') {
			const oldHeight = elements.messageContainer.scrollHeight;
			for (const message of data.messages) {
				insertMessage(message);
			}

			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
			if (data.messages.length === state.messagesToLoad) elements.loadMessagesButton.style.display = 'table';
		} else if (data.type === 'changePasswordCB') {
			if (data.message === 'success') {
				state.reconnect = false;
				hideSpinner();
				setPopupSubtitle({
					subtitle: 'Hasło zostało zmienione pomyślnie',
					subtitleColor: 'var(--green)',
				});
				setTimeout(() => {
					localStorage.removeItem('token');
					main();
				}, 1000);
			} else {
				hideSpinner();
				setPopupSubtitle({
					subtitle: 'Niepoprawne stare hasło',
					subtitleColor: 'var(--orange)',
				});
			}
		} else if (data.type === 'updateNickname') {
			if (data.uid === state.user.uid) {
				if (data.nickname) {
					state.user.nickname = data.nickname;
					propagateUserData();
					hidePopup();
				} else {
					let error = '';
					switch (data.message) {
						case 'usernameInvalidFormat':
						case 'usernameInvalidLength':
							error = 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';
							break;
						case 'usernameAlreadyInUse':
							error = 'Ten pseudonim jest już zajęty';
							break;
						default:
							break;
					}

					setPopupSubtitle({
						subtitle: error,
						subtitleColor: 'var(--orange)',
					});
				}
			}

			if (data.nickname.length !== 0) {
				state.users[data.uid] = data.nickname;

				for (const msg of state.messages) {
					if (msg.uid === data.uid) {
						document.getElementById(msg.id).childNodes[0].childNodes[0].innerHTML = state.users[data.uid];
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

		if (state.reconnect) {
			showSpinner();
			setTimeout(connect, 1000);
		}
	};
};

const disconnect = () => {
	state.reconnect = false;
	state.socket.close();
};

const changeNickname = (closeable = true, subtitle = '', startingValue = '') => {
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
					limit: 32,
				},
			},
		],
	});

	const popupInput = document.getElementById('popup-input-username');
	popupInput.onkeyup = (event) => {
		if (event.code === 'Enter' || event.keyCode === 13) {
			const value = popupInput.value.trim();

			if (value.length < 3 || value.length > 32 || !/^[A-Za-z0-9\-_]*$/.test(value)) {
				setPopupSubtitle({
					subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
					subtitleColor: 'var(--orange)',
				});
			} else {
				if (value !== state.user.nickname) {
					state.socket.send(JSON.stringify({
						type: 'setNickname',
						nickname: value,
					}));
				} else {
					hidePopup();
				}
			}
		}
	};

	popupInput.value = startingValue === '' ? state.user.nickname : startingValue;
	popupInput.focus();
};

const changePassword = () => {
	showPopup({
		title: 'Zmień hasło',
		closeable: true,
		body: [
			{
				label: 'Stare hasło',
				input: {
					id: 'popup-input-oldPassword',
					type: 'password',
				},
			},
			{
				label: 'Nowe hasło',
				input: {
					id: 'popup-input-password',
					type: 'password',
				},
			},
			{
				label: 'Powtórz nowe hasło',
				input: {
					id: 'popup-input-password2',
					type: 'password',
				},
			},
		],
		footer: [
			{
				id: 'popup-button-changePassword',
				label: 'Zmień hasło',
			},
		],
	});

	document.getElementById('popup-button-changePassword').onclick = async () => {
		const newPassword = document.getElementById('popup-input-password').value;
		if (newPassword !== document.getElementById('popup-input-password2').value) {
			setPopupSubtitle({
				subtitle: 'Podane nowe hasła nie są identyczne',
				color: 'var(--orange)',
			});
			return;
		}

		showSpinner();
		state.socket.send(JSON.stringify({
			type: 'changePassword',
			oldPassword: await sha256(document.getElementById('popup-input-oldPassword').value),
			password: await sha256(document.getElementById('popup-input-password').value),
		}));
	};
};

const logOutEverywhere = () => {
	state.socket.send(JSON.stringify({
		type: 'logOutEverywhere',
	}));
};

const logOut = () => {
	localStorage.removeItem('token');
	disconnect();
	main();
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
				type: 'sendMessage',
				message: value,
			}));
		}
	}
});

document.onfocus = () => {
	for (const notif of state.notifications) {
		notif.close();
	}

	state.notifications = [];
};

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
	const NOW = new Date(Date.now() - state.timeOffset);
	elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
	setTimeout(updateClock, 1000 - ((Date.now() - state.timeOffset) % 1000) + 10);
};

const loginHandler = () => {
	hideSpinner();
	showPopup({
		title: 'Zaloguj się',
		body: [
			{
				label: 'Nazwa użytkownika',
				input: {
					id: 'popup-input-username',
					type: 'text',
					limit: 32,
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

	document.getElementById('popup-button-login').onclick = async () => {
		showSpinner();
		const response = await fetch('/api/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username: document.getElementById('popup-input-username').value,
				password: await sha256(document.getElementById('popup-input-password').value),
			}),
		});

		const data = await response.json();
		if (data.message === 'invalidLogin') {
			setPopupSubtitle({
				subtitle: 'Niepoprawny login lub hasło',
				subtitleColor: 'var(--orange)',
			});
			hideSpinner();
			return;
		} else if (data.message === 'success') {
			localStorage.setItem('token', data.token);
			connect();
		}
	};

	document.getElementById('popup-button-register').onclick = () => {
		registerHandler();
	};
};

const registerHandler = () => {
	hideSpinner();
	let registrationInProgress = false;
	const popupCaptchaHTML = '<div id="popup-captcha" class="popup-button" style="background-color: var(--border); margin-bottom: 20px;">Nie jestem robotem</div>';
	showPopup({
		title: 'Zarejestruj się',
		body: [
			{
				label: 'Nazwa użytkownika',
				input: {
					id: 'popup-input-username',
					type: 'text',
					limit: 32,
				},
			},
			{
				label: 'Hasło',
				input: {
					id: 'popup-input-password',
					type: 'password',
				},
			},
			{
				label: 'Powtórz hasło',
				input: {
					id: 'popup-input-password2',
					type: 'password',
				},
			},
			{
				html: popupCaptchaHTML,
			},
		],
		footer: [
			{
				id: 'popup-button-register',
				label: 'Zarejestruj się',
			},
			{
				id: 'popup-button-login',
				label: 'Zaloguj się',
				color: 'var(--orange)',
			},
		],
	});

	const captchaRow = document.getElementById('popup-captcha').parentElement;
	let captchaData = {};
	const resetCaptcha = () => {
		captchaRow.innerHTML = popupCaptchaHTML;

		document.getElementById('popup-captcha').onclick = async () => {
			const response = await fetch('/api/captcha', {
				method: 'POST',
			});

			captchaData = await response.json();
			captchaRow.innerHTML = `<div class="popup-row-label">Przepisz tekst z obrazka</div>${captchaData.content}<input id="popup-input-captcha" class="popup-row-input" type="text">`;
		};
	};
	resetCaptcha();

	document.getElementById('popup-button-register').onclick = async () => {
		if (registrationInProgress) return;
		else registrationInProgress = true;

		const captchaInput = document.getElementById('popup-input-captcha');
		if (!captchaInput){
			setPopupSubtitle({
				subtitle: 'Musisz potwierdzić że nie jesteś robotem',
				subtitleColor: 'var(--orange)',
			});
			registrationInProgress = false;
			return;
		}

		const password = document.getElementById('popup-input-password').value;
		if (password !== document.getElementById('popup-input-password2').value) {
			setPopupSubtitle({
				subtitle: 'Wpisane hasła nie są identyczne',
				subtitleColor: 'var(--orange)',
			});
			registrationInProgress = false;
			return;
		}

		showSpinner();
		const response = await fetch('/api/register', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username: document.getElementById('popup-input-username').value,
				password: await sha256(password),
				captcha: {
					id: captchaData.id,
					timestamp: captchaData.timestamp,
					signature: captchaData.signature,
					solution: captchaInput.value,
				},
			}),
		});

		const data = await response.json();
		let error = '';
		switch (data.message) {
			case 'success':
				break;
			case 'usernameInvalidFormat':
			case 'usernameInvalidLength':
				error = 'Nazwa użytkownika powinna mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';
				break;
			case 'usernameAlreadyInUse':
				error = 'Ta nazwa użytkownika jest już zajęta';
				break;
			case 'invalidSolution':
				error = 'Wpisany tekst nie jest poprawnym rozwiązaniem CAPTCHy';
				break;
			case 'captchaExpired':
				error = 'CAPTCHA wygasła';
				resetCaptcha();
				break;
			default:
				error = 'Wystąpił nieznany błąd';
		}

		if (error === '') {
			hideSpinner();
			setPopupSubtitle({
				subtitle: 'Zarejestrowano pomyślnie!',
				subtitleColor: 'var(--green)',
			});
			setTimeout(() => {
				loginHandler();
			}, 1000);
		} else {
			hideSpinner();
			setPopupSubtitle({
				subtitle: error,
				subtitleColor: 'var(--orange)',
			});
			registrationInProgress = false;
		}
	};

	document.getElementById('popup-button-login').onclick = () => {
		loginHandler();
	};
};

const main = async () => {
	const token = localStorage.getItem('token');
	if (!token) {
		loginHandler();
		return;
	}

	connect();
};

updateClock();
main();

elements.messageContainer.onscroll = () => {
	if (Notification.permission === 'default') Notification.requestPermission();
};
