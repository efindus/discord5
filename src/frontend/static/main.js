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
	currentAttachment: null,
};

const elements = {
	topBar: document.querySelector('.top-bar'),
	siteBody: document.querySelector('.site-body'),
	bottomBar: document.querySelector('.bottom-bar'),

	popupContainer: document.getElementById('popup-container'),
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
			<line x1="0.25" y1="0.5" x2="0.75" y2="0.5" stroke="var(--light-grey)" stroke-width="0.06"></line>
			<line x1="0.5" y1="0.25" x2="0.5" y2="0.75" stroke="var(--light-grey)" stroke-width="0.06"></line>
		</svg>`,
	cross: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" x2="0.75" stroke="var(--light-grey)" stroke-width="0.06" y1="0.25" y2="0.75"></line>
			<line y1="0.25" y2="0.75" stroke="var(--light-grey)" stroke-width="0.06" x2="0.25" x1="0.75"></line>
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

	elements.popupContainer.style.display = '';
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

	elements.popupContainer.style.display = 'none';
	state.isClosablePopupOpen = false;
};

document.onkeydown = (event) => {
	if (event.code === 'Escape' && state.isClosablePopupOpen) {
		hidePopup();
	}
};

const showSpinner = () => {
	elements.spinner.style.display = '';
};

const hideSpinner = () => {
	elements.spinner.style.display = 'none';
};

const propagateUserData = () => {
	elements.usernameDisplay.innerText = state.user.username;
	elements.userData.innerHTML = `ID: ${state.user.uid}<br>Pseudonim: ${state.user.nickname}`;
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

const sha256 = async (message) => {
	const msgBuffer = new TextEncoder().encode(message);
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
};

const generateMessageMetaUsername = (uid) => {
	return `${state.users[uid].nickname}<span class="tooltiptext">${state.users[uid].username}</span>`;
};

const generateMessageMeta = (msgData, isContinuation) => {
	if (isContinuation) return '';

	const messageAuthor = `<div class="message-username tooltip">${generateMessageMetaUsername(msgData.uid)}</div>`;
	const messageDate = `<div class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</div>`;
	let messageFor = '';
	if (msgData.originalAuthor) {
		messageFor = `<div style="margin-right: 6px;">dla</div><div class="message-username tooltip">${generateMessageMetaUsername(msgData.originalAuthor)}</div>`;
	}

	return `<div class="message-meta">${messageAuthor}${messageFor}${messageDate}</div>`;
};

const generateMessageContent = (msgData, isContinuation) => {
	const messageContent = markdownToHTML(sanitizeText(msgData.message)).split('\n').join('<br>');
	let dateTooltip = '';
	if (isContinuation) dateTooltip = `<span class="tooltiptext">${new Date(msgData.ts).toLocaleString('pl')}</span>`;

	return `<div class="message-content ${isContinuation ? 'tooltip' : ''}">${messageContent}${dateTooltip}</div>`;
};

const generateMessageAttachment = (msgData) => {
	if (!msgData.attachment) return '';

	const generateAttachmentLink = (attachment) => {
		return `<a class="message-attachment-name" href="/attachments/${attachment}" target="_blank">${attachment}</a>`;
	};

	const isImage = (file) => {
		if (file && (file.endsWith('.png') ||
			file.endsWith('.jpg') ||
			file.endsWith('.jpeg') ||
			file.endsWith('.gif') ||
			file.endsWith('.webp')
		)) {
			return true;
		}

		return false;
	};

	let messageAttachment = generateAttachmentLink(msgData.attachment);
	if (isImage(msgData.attachment)) {
		messageAttachment = `<img src="/attachments/${msgData.attachment}" onerror="this.remove()"><div>${messageAttachment}</div>`;
	}

	return `<div class="message-attachment">${messageAttachment}</div>`;
};

const generateMessage = (msgData, isContinuation = false, isShadow = false) => {
	const message = document.createElement('div');
	message.id = msgData.id;
	message.classList.add('message');
	if (isShadow) {
		message.classList.add('message-shadow');
		isContinuation = false;
	}

	message.innerHTML = `${generateMessageMeta(msgData, isContinuation)}${generateMessageContent(msgData, isContinuation)}${generateMessageAttachment(msgData)}`;
	return message;
};

const generateDaySeparator = (timestamp) => {
	const separator = document.createElement('div');
	separator.classList.add('day-separator');
	separator.innerHTML = `<span class="day-separator-text">${(new Date(timestamp)).toLocaleDateString('pl')}</span>`;
	return separator;
};

const insertMessage = (data) => {
	getMissingUserData(data.msgData.uid);
	if (data.msgData.originalAuthor) getMissingUserData(data.msgData.originalAuthor);

	if (!data.isNew) {
		const lastMessage = state.messages[0];
		if (lastMessage) {
			const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
			if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
				elements.messages.insertBefore(generateDaySeparator(lastMessage.ts), elements.messages.firstChild);
			} else if (!data.continuation && lastMessage.uid === data.msgData.uid && lastMessage.originalAuthor === data.msgData.originalAuthor) {
				document.getElementById(state.messages[0].id).remove();
				insertMessage({
					msgData: state.messages[0],
					isNew: false,
					continuation: true,
				});
			}
		}

		elements.messages.insertBefore(generateMessage(data.msgData, data.continuation), elements.messages.firstChild);
		if (!data.continuation) state.messages.splice(0, 0, data.msgData);
	} else {
		const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;

		if (!data.afterElement || !data.afterElement.nextSibling) {
			const lastMessage = state.messages[state.messages.length - 1];
			if (lastMessage && !data.isShadow) {
				const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
				if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
					elements.messages.appendChild(generateDaySeparator(data.msgData.ts));
				}
			}

			elements.messages.appendChild(generateMessage(data.msgData, lastMessage?.uid === data.msgData.uid, data.isShadow));
		}

		if (!data.isShadow) {
			state.messages.push(data.msgData);
		}

		if (!data.isShadow && !document.hasFocus() && Notification.permission === 'granted') {
			const notif = new Notification('Discord5: New Message', {
				body: `${state.users[data.msgData.uid].nickname}: ${data.msgData.message.slice(0, 150)}`,
				icon: '/favicon.ico',
			});

			notif.index = state.notifications.length;
			notif.onclose = () => {
				state.notifications.splice(notif.index, 1);
			};

			state.notifications.push(notif);
		}

		if (data.isShadow) setTimeout(() => {
			document.getElementById(data.msgData.nonce)?.remove();
		}, 10_000);

		if (scroll) elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
	}
};

const getMissingUserData = (uid) => {
	if (!state.users[uid]) {
		state.users[uid] = {
			username: uid.slice(0, 10),
			nickname: uid.slice(0, 10),
		};

		state.socket.send(JSON.stringify({
			type: 'getUser',
			uid: uid,
		}));
	}
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	state.socket.send(JSON.stringify({
		type: 'getMessages',
	}));
};

const resetUpload = () => {
	elements.uploadButton.innerHTML = svgs.plus;
	elements.uploadInput.value = '';
	state.currentAttachment = null;
};

const updateMessages = (uid) => {
	for (const msg of state.messages) {
		const msgMeta = document.getElementById(msg.id).querySelector('.message-meta');

		if (msgMeta) {
			if (msg.uid === uid) {
				const element = msgMeta.childNodes[0];
				if (element) element.innerHTML = generateMessageMetaUsername(uid);
			}

			if (msg.originalAuthor === uid) {
				const element = msgMeta.childNodes[2];
				if (element) element.innerHTML = generateMessageMetaUsername(uid);
			}
		}
	}
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
				logOutHandler();
			}
		} else if (data.type === 'newMessage') {
			if (data.nonce) {
				document.getElementById(data.nonce).remove();
			}

			insertMessage({
				msgData: data,
				isNew: true,
			});
		} else if (data.type === 'loadMessages') {
			const oldHeight = elements.messageContainer.scrollHeight;
			for (const message of data.messages) {
				insertMessage({
					msgData: message,
				});
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
				elements.popup.classList.add('shaking');
			}
		} else if (data.type === 'updateNickname') {
			if (data.uid === state.user.uid) {
				if (data.nickname) {
					state.user.nickname = data.nickname;
					propagateUserData();
					hidePopup();
					hideSpinner();
				} else {
					let error = '';
					switch (data.message) {
						case 'usernameInvalidFormat':
						case 'usernameInvalidLength':
							error = 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';
							break;
						default:
							break;
					}

					setPopupSubtitle({
						subtitle: error,
						subtitleColor: 'var(--orange)',
					});
					elements.popup.classList.add('shaking');
				}
			}

			if (data.nickname.length !== 0) {
				state.users[data.uid].nickname = data.nickname;

				updateMessages(data.uid);
			}
		} else if (data.type === 'updateUser') {
			if (data.username.length !== 0) {
				state.users[data.uid] = {
					username: data.username,
					nickname: data.nickname,
				};

				updateMessages(data.uid);
			}
		} else if (data.type === 'reload') {
			window.location.reload();
		}
	};

	state.socket.onclose = () => {
		clearInterval(pinger);
		elements.messages.innerHTML = '';
		state.messages = [];

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

elements.input.onkeydown = (event) => {
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

		if (value.length > 0 && value.length <= 2000) {
			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
			elements.input.value = '';
			const nonce = `${Date.now()}${Math.random()}`;
			insertMessage({
				msgData: {
					id: nonce,
					ts: Date.now() - state.timeOffset,
					uid: state.user.uid,
					message: value,
				},
				isNew: true,
				isShadow: true,
			});

			let attachment = {};
			if (state.currentAttachment) {
				attachment = {
					attachment: {
						fileName: elements.uploadInput.files[0].name,
						data: state.currentAttachment,
					},
				};

				resetUpload();
			}

			state.socket.send(JSON.stringify({
				type: 'sendMessage',
				message: value,
				nonce: nonce,
				...attachment,
			}));
		}
	}
};

document.onfocus = () => {
	for (const notif of state.notifications) {
		notif.close();
	}

	state.notifications = [];
};

elements.messageContainer.onscroll = () => {
	if (Notification.permission === 'default') Notification.requestPermission();
};

elements.popup.onanimationend = () => {
	elements.popup.classList.remove('shaking');
};

elements.uploadInput.onchange = () => {
	if (elements.uploadInput.value !== '' && elements.uploadInput.files[0].size <= 11160000) {
		elements.uploadButton.innerHTML = svgs.cross;

		const reader = new FileReader();
		reader.onload = (event) => {
			state.currentAttachment = fromArrayBufferToBase64(event.target.result);
		};

		reader.readAsArrayBuffer(elements.uploadInput.files[0]);
	} else {
		elements.uploadInput.value = '';
	}
};

elements.uploadButton.onclick = (event) => {
	if (elements.uploadInput.value !== '') {
		event.preventDefault();
		resetUpload();
	}
};

elements.usernameContainer.onclick = toggleDropdown;
elements.dropdownClose.onclick = toggleDropdown;

const updateClock = () => {
	const NOW = new Date(Date.now() - state.timeOffset);
	elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
	setTimeout(updateClock, 1000 - ((Date.now() - state.timeOffset) % 1000) + 10);
};

const logOutEverywhereHandler = () => {
	state.socket.send(JSON.stringify({
		type: 'logOutEverywhere',
	}));
};

const logOutHandler = () => {
	localStorage.removeItem('token');
	disconnect();
	main();
};

const changeNicknameHandler = (closeable = true, subtitle = '', startingValue = '') => {
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
		footer: [
			{
				id: 'popup-button-changeNickname',
				label: 'Zmień pseudonim',
			},
		],
	});

	const nicknameInput = document.getElementById('popup-input-username');
	const changeNicknameFormHandler = () => {
		const value = nicknameInput.value.trim();

		if (value.length < 3 || value.length > 32 || !/^[A-Za-z0-9\-_]*$/.test(value)) {
			setPopupSubtitle({
				subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
				subtitleColor: 'var(--orange)',
			});
			elements.popup.classList.add('shaking');
		} else {
			if (value !== state.user.nickname) {
				showSpinner();
				state.socket.send(JSON.stringify({
					type: 'setNickname',
					nickname: value,
				}));
			} else {
				hidePopup();
			}
		}
	};

	document.getElementById('popup-button-changeNickname').onclick = changeNicknameFormHandler;
	nicknameInput.onkeydown = (event) => {
		if (event.code === 'Enter' || event.keyCode === 13) {
			changeNicknameFormHandler();
		}
	};

	nicknameInput.value = startingValue === '' ? state.user.nickname : startingValue;
	nicknameInput.focus();
};

const changePasswordHandler = () => {
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

	const oldPasswordInput = document.getElementById('popup-input-oldPassword');
	const changePasswordFormHandler = async () => {
		const newPassword = document.getElementById('popup-input-password').value;
		if (newPassword !== document.getElementById('popup-input-password2').value) {
			setPopupSubtitle({
				subtitle: 'Podane nowe hasła nie są identyczne',
				color: 'var(--orange)',
			});
			elements.popup.classList.add('shaking');
			return;
		}

		showSpinner();
		state.socket.send(JSON.stringify({
			type: 'changePassword',
			oldPassword: await sha256(oldPasswordInput.value),
			password: await sha256(document.getElementById('popup-input-password').value),
		}));
	};

	document.getElementById('popup-button-changePassword').onclick = changePasswordFormHandler;
	document.getElementById('popup-input-password2').onkeydown = (event) => {
		if (event.code === 'Enter' || event.keyCode === 13) {
			changePasswordFormHandler();
		}
	};

	oldPasswordInput.focus();
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

	const usernameInput = document.getElementById('popup-input-username');

	const loginFormHandler = async () => {
		showSpinner();
		const response = await fetch('/api/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username: usernameInput.value,
				password: await sha256(document.getElementById('popup-input-password').value),
			}),
		});

		const data = await response.json();
		if (data.message === 'invalidLogin') {
			setPopupSubtitle({
				subtitle: 'Niepoprawny login lub hasło',
				subtitleColor: 'var(--orange)',
			});
			elements.popup.classList.add('shaking');
			hideSpinner();
			return;
		} else if (data.message === 'success') {
			localStorage.setItem('token', data.token);
			connect();
		}
	};

	document.getElementById('popup-button-login').onclick = loginFormHandler;
	document.getElementById('popup-input-password').onkeydown = (event) => {
		if (event.code === 'Enter' || event.keyCode === 13) {
			loginFormHandler();
		}
	};

	document.getElementById('popup-button-register').onclick = () => {
		registerHandler();
	};

	usernameInput.focus();
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

	const usernameInput = document.getElementById('popup-input-username');
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
			document.getElementById('popup-input-captcha').onkeydown = (event) => {
				if (event.code === 'Enter' || event.keyCode === 13) {
					registerFormHandler();
				}
			};

			setTimeout(() => {
				if (captchaRow) resetCaptcha();
			}, 60_000);
		};
	};
	resetCaptcha();

	const registerFormHandler = async () => {
		if (registrationInProgress) return;
		else registrationInProgress = true;

		const captchaInput = document.getElementById('popup-input-captcha');
		if (!captchaInput){
			setPopupSubtitle({
				subtitle: 'Musisz potwierdzić że nie jesteś robotem',
				subtitleColor: 'var(--orange)',
			});
			elements.popup.classList.add('shaking');
			registrationInProgress = false;
			return;
		}

		const password = document.getElementById('popup-input-password').value;
		if (password !== document.getElementById('popup-input-password2').value) {
			setPopupSubtitle({
				subtitle: 'Wpisane hasła nie są identyczne',
				subtitleColor: 'var(--orange)',
			});
			elements.popup.classList.add('shaking');
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
				username: usernameInput.value,
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
			elements.popup.classList.add('shaking');
			registrationInProgress = false;
		}
	};

	document.getElementById('popup-button-register').onclick = registerFormHandler;

	document.getElementById('popup-button-login').onclick = () => {
		loginHandler();
	};

	usernameInput.focus();
};

const main = async () => {
	const token = localStorage.getItem('token');
	if (!token) {
		loginHandler();
		return;
	}

	connect();
};


const fromArrayBufferToBase64 = (arrayBuffer) => {
	let base64    = '';
	const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

	const bytes = new Uint8Array(arrayBuffer);
	const byteLength    = bytes.byteLength;
	const byteRemainder = byteLength % 3;
	const mainLength    = byteLength - byteRemainder;

	let a, b, c, d;
	let chunk;

	for (let i = 0; i < mainLength; i = i + 3) {
		chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

		a = (chunk & 16515072) >> 18;
		b = (chunk & 258048)   >> 12;
		c = (chunk & 4032)     >>  6;
		d = chunk & 63;

		base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
	}

	if (byteRemainder === 1) {
		chunk = bytes[mainLength];

		a = (chunk & 252) >> 2;
		b = (chunk & 3)   << 4;

		base64 += encodings[a] + encodings[b] + '==';
	} else if (byteRemainder === 2) {
		chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

		a = (chunk & 64512) >> 10;
		b = (chunk & 1008)  >>  4;

		c = (chunk & 15)    <<  2;

		base64 += encodings[a] + encodings[b] + encodings[c] + '=';
	}

	return base64;
};

updateClock();
main();
