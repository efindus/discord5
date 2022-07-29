/* eslint-disable no-undef */
const state = {
	user: {},
	sManager: null,
	users: {},
	messages: [],
	notifications: [],

	messagesToLoad: 50,
	timeOffset: 0,

	isDropdownOpen: false,
	isClosablePopupOpen: false,

	currentAttachment: null,
};

const elements = {
	onlineSidebar: document.querySelector('.online-sidebar'),

	popupContainer: document.getElementById('popup-container'),
	popup: document.getElementById('popup'),
	popupClose: document.getElementById('popup-close'),
	popupHeader: document.getElementById('popup-header'),
	popupTitle: document.getElementById('popup-title'),
	popupSubtitle: document.getElementById('popup-subtitle'),
	popupBody: document.getElementById('popup-body'),
	popupFooter: document.getElementById('popup-footer'),
	popupSpinner: document.getElementById('popup-spinner'),

	tooltipContainer: document.querySelector('.tooltip-container'),
	tooltip: document.getElementById('tooltip'),

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

class SocketManager {
	/**
	 * @type {WebSocket}
	 */
	#socket;
	#pinger;

	#reconnect = true;
	#receiveQueue = {};
	#protocolVersion = '1';

	connect() {
		this.#socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
		this.#reconnect = true;

		showSpinner();
		hidePopup();

		this.#socket.onopen = () => {
			this.#setupPinger();
		};

		this.#socket.onmessage = (event) => {
			this.#onMessage(event);
		};

		this.#socket.onclose = () => {
			this.#onClose();
		};
	}

	disconnect() {
		this.#reconnect = false;
		this.#socket.close();
	}

	send(type, message) {
		let pid;
		do {
			pid = `${crypto.randomUUID()}-${Date.now()}`;
		} while (this.#receiveQueue[pid]);

		const packet = {
			pid: pid,
			type: type,
			...message,
		};

		this.#socket.send(JSON.stringify(packet));
		this.#receiveQueue[pid] = {
			type: type,
			message: message,
		};
	}

	#setupPinger() {
		this.#pinger = setInterval(() => {
			this.#socket.send(JSON.stringify({
				type: 'ping',
			}));
		}, 20_000);
	}

	#onClose() {
		clearInterval(this.#pinger);
		elements.messages.innerHTML = '';
		state.messages = [];

		if (this.#reconnect) {
			showSpinner();
			setTimeout(() => this.connect(), 1000);
		}
	}

	async #onMessage(event) {
		const data = JSON.parse(event.data);

		if (data.pid && this.#receiveQueue[data.pid]) {
			if (data.type === 'ratelimit') {
				setTimeout(() => {
					const packet = this.#receiveQueue[data.pid];

					this.send(packet.type, packet.message);
					delete this.#receiveQueue[data.pid];
				}, data.retryAfter + 100);
				return;
			} else {
				delete this.#receiveQueue[data.pid];
			}
		}

		if (data.type === 'connectionReady') {
			this.send('authorize', {
				token: localStorage.getItem('token'),
			});
		} else if (data.type === 'authorizeCB') {
			if (data.message === 'accepted') {
				if (this.#protocolVersion !== data.protocolVersion) window.location.reload();

				state.user = data.user;
				state.messagesToLoad = data.messagesToLoad;
				state.timeOffset = Date.now() - data.serverTime;

				propagateUserData();
				loadMessages();
			} else if (data.message === 'invalidLogin') {
				logOutHandler();
			}
		} else if (data.type === 'newMessage') {
			if (data.nonce) {
				document.getElementById(data.nonce)?.remove();
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
					scrollAttachment: state.messages.length < state.messagesToLoad,
				});
			}

			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
			if (data.messages.length === state.messagesToLoad) elements.loadMessagesButton.style.display = 'table';
			if (state.messages.length <= state.messagesToLoad) hideSpinner();
		} else if (data.type === 'changePasswordCB') {
			if (data.message === 'success') {
				this.#reconnect = false;
				setPopupSubtitle({
					subtitle: 'Hasło zostało zmienione pomyślnie',
					subtitleColor: 'var(--green)',
				});
				setTimeout(() => {
					localStorage.removeItem('token');
					main();
				}, 1000);
			} else {
				hidePopupSpinner();
				setPopupSubtitle({
					subtitle: 'Niepoprawne stare hasło',
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
					});
					elements.popup.classList.add('shaking');
				}
			}

			if (data.nickname.length !== 0) {
				state.users[data.uid].nickname = data.nickname;

				updateNickname(data.uid);
			}
		} else if (data.type === 'updateUser') {
			if (data.username.length !== 0) {
				state.users[data.uid] = {
					username: data.username,
					nickname: data.nickname,
				};

				updateNickname(data.uid);
			}
		} else if (data.type === 'reload') {
			window.location.reload();
		} else if (data.type === 'clientsOnline') {
			elements.onlineSidebar.innerHTML = '';
			for (const client of data.clients) {
				getMissingUserData(client);
				elements.onlineSidebar.innerHTML += `<div class="online-entry" id="online-${client}" ${generateUsernameTooltip(client, true)}>${state.users[client].nickname}</div>`;
			}
		}
	}
}

state.sManager = new SocketManager();

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
	elements.popupContainer.style.visibility = 'visible';
	elements.popupContainer.style.opacity = '1';
	elements.popupContainer.style.transitionDelay = '0s, 0s';
	elements.popupContainer.style.transitionDuration = '0s, .25s';

	elements.popupTitle.innerHTML = data.title;

	setPopupSubtitle(data);
	hidePopupSpinner();

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
 * @param {string} data.subtitleColor Popup subtitle color [default: var(--orange)]
 */
const setPopupSubtitle = (data) => {
	if (data.subtitle?.length > 0) {
		elements.popupSubtitle.style.display = '';
		elements.popupSubtitle.innerHTML = data.subtitle;
		elements.popupSubtitle.style.color = data.subtitleColor ?? 'var(--orange)';
	} else {
		elements.popupSubtitle.style.display = 'none';
	}
};

const hidePopup = () => {
	elements.popupContainer.style.visibility = 'hidden';
	elements.popupContainer.style.opacity = '0';
	elements.popupContainer.style.transitionDelay = '.25s, 0s';
	elements.popupContainer.style.transitionDuration = '0s, .25s';

	state.isClosablePopupOpen = false;
};

const showSpinner = () => {
	elements.spinner.style.visibility = 'visible';
	elements.spinner.style.opacity = '1';
	elements.spinner.style.transitionDelay = '0s, 0s';
	elements.spinner.style.transitionDuration = '0s, 0s';
};

const hideSpinner = () => {
	elements.spinner.style.visibility = 'hidden';
	elements.spinner.style.opacity = '0';
	elements.spinner.style.transitionDelay = '.5s, 0s';
	elements.spinner.style.transitionDuration = '0s, .5s';
};

const showPopupSpinner = () => {
	elements.popupFooter.style.display = 'none';
	elements.popupSpinner.style.display = '';
};

const hidePopupSpinner = () => {
	elements.popupFooter.style.display = '';
	elements.popupSpinner.style.display = 'none';
};

/**
 * Show a tooltip
 * @param {object} data
 * @param {number} data.x
 * @param {number} data.y
 * @param {'left' | 'right' | 'top' | 'bottom'} data.side
 * @param {string} data.content
 * @param {boolean?} data.withArrow
 */
const showTooltip = (data) => {
	elements.tooltipContainer.style.visibility = 'visible';
	elements.tooltipContainer.style.opacity = '1';
	elements.tooltipContainer.style.transitionDelay = '0s, 0s';
	elements.tooltipContainer.style.transitionDuration = '0s, .25s';

	elements.tooltip.style.top = `${data.y}px`;
	elements.tooltip.style.left = `${data.x}px`;

	const transforms = {
		x: '0%',
		y: '0%',
		varLeft: '0%',
		varTop: '0%',
	};

	switch (data.side) {
		case 'left':
			transforms.y = '-50%';
			transforms.varTop = '50%';
			break;
		case 'right':
			transforms.x = '-100%';
			transforms.y = '-50%';
			transforms.varLeft = '100%';
			transforms.varTop = '50%';
			break;
		case 'top':
			transforms.x = '-50%';
			transforms.varLeft = '50%';
			break;
		case 'bottom':
		default:
			transforms.x = '-50%';
			transforms.y = '-100%';
			transforms.varLeft = '50%';
			transforms.varTop = '100%';
			break;
	}

	elements.tooltip.innerHTML = data.content;
	elements.tooltip.style.transform = `translate(${transforms.x}, ${transforms.y})`;

	const offset = getElementPosition(elements.tooltip);
	const position = getElementPosition(elements.tooltip, true);
	let maxMovement = (position.bottom - position.top) / 2 - 11;
	const margin = 10;

	switch (data.side) {
		case 'left':
		case 'right':
			if (offset.top < margin) {
				transforms.y = `calc(${transforms.y} + ${margin - offset.top}px)`;
				transforms.varTop = `calc(${transforms.varTop} - ${Math.min(margin - offset.top, maxMovement)}px)`;
			} else if (offset.bottom < margin) {
				transforms.y = `calc(${transforms.y} - ${margin - offset.bottom}px)`;
				transforms.varTop = `calc(${transforms.varTop} + ${Math.min(margin - offset.bottom, maxMovement)}px)`;
			}
			break;
		case 'top':
		case 'bottom':
		default:
			maxMovement = (position.right - position.left) / 2 - 11;

			if (offset.left < margin) {
				transforms.x = `calc(${transforms.x} + ${margin - offset.left}px)`;
				transforms.varLeft = `calc(${transforms.varLeft} - ${Math.min(margin - offset.left, maxMovement)}px)`;
			} else if (offset.right < margin) {
				transforms.x = `calc(${transforms.y} - ${margin - offset.right}px)`;
				transforms.varLeft = `calc(${transforms.varLeft} + ${Math.min(margin - offset.right, maxMovement)}px)`;
			}
			break;
	}

	elements.tooltip.style.transform = `translate(${transforms.x}, ${transforms.y})`;
	if (data.withArrow) {
		elements.tooltip.classList.remove('tooltip-arrow-top', 'tooltip-arrow-bottom', 'tooltip-arrow-left', 'tooltip-arrow-right');
		elements.tooltip.classList.add(`tooltip-arrow-${data.side}`);
		elements.tooltip.style.setProperty('--tooltip-left', transforms.varLeft);
		elements.tooltip.style.setProperty('--tooltip-top', transforms.varTop);
	}
};

const hideTooltip = () => {
	elements.tooltipContainer.style.visibility = 'hidden';
	elements.tooltipContainer.style.opacity = '0';
	elements.tooltipContainer.style.transitionDelay = '.25s, 0s';
	elements.tooltipContainer.style.transitionDuration = '0s, .25s';
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

const showUsernameTooltip = (element, uid, isSidebar = false) => {
	const position = getElementPosition(element, true);
	showTooltip({
		x: isSidebar ? position.left - 10 : position.right + 10,
		y: position.top + ((position.bottom - position.top) / 2),
		side: isSidebar ? 'right' : 'left',
		content: `${state.users[uid].username}<br>ID: ${uid}`,
		withArrow: true,
	});
};

const showDateTooltip = (element, timestamp) => {
	const position = getElementPosition(element, true);
	showTooltip({
		x: position.left,
		y: position.top - 10,
		side: 'bottom',
		content: `${new Date(timestamp).toLocaleString('pl')}`,
		withArrow: true,
	});
};

const generateUsernameTooltip = (uid, isSidebar = false) => {
	return `onclick="showUsernameTooltip(this, '${uid}', ${isSidebar})"`;
};

const generateDateTooltip = (timestamp) => {
	return `ondblclick="showDateTooltip(this, ${timestamp})"`;
};

const generateMessageMeta = (msgData, isContinuation) => {
	if (isContinuation) return '';

	const messageAuthor = `<div class="message-username" ${generateUsernameTooltip(msgData.uid)}>${state.users[msgData.uid].nickname}</div>`;
	const messageDate = `<div class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</div>`;
	let messageFor = '';
	if (msgData.originalAuthor) {
		messageFor = `<div style="margin-right: 6px;">dla</div><div class="message-username" ${generateUsernameTooltip(msgData.originalAuthor)}>${state.users[msgData.originalAuthor].nickname}</div>`;
	}

	return `<div class="message-meta">${messageAuthor}${messageFor}${messageDate}</div>`;
};

const generateMessageContent = (msgData, isContinuation) => {
	const messageContent = markdownToHTML(sanitizeText(msgData.message)).split('\n').join('<br>');

	return `<div class="message-content" ${isContinuation ? generateDateTooltip(msgData.ts) : ''}>${messageContent}</div>`;
};

const generateMessageAttachment = (msgData, isNew) => {
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
		messageAttachment = `<img src="/attachments/${msgData.attachment}" ${isNew ? 'onload="onAttachmentLoad(this)" ' : ''}onerror="this.remove()"><div>${messageAttachment}</div>`;
	}

	return `<div class="message-attachment">${messageAttachment}</div>`;
};

const generateMessage = (msgData, isContinuation = false, isShadow = false, isNew = false) => {
	const message = document.createElement('div');
	message.id = msgData.id;
	message.classList.add('message');
	if (isShadow) {
		message.classList.add('message-shadow');
		isContinuation = false;
	}

	message.innerHTML = `${generateMessageMeta(msgData, isContinuation)}${generateMessageContent(msgData, isContinuation)}${generateMessageAttachment(msgData, isNew)}`;
	return message;
};

const generateDaySeparator = (timestamp) => {
	const separator = document.createElement('div');
	separator.classList.add('day-separator');
	separator.innerHTML = `<span class="day-separator-text">${(new Date(timestamp)).toLocaleDateString('pl')}</span>`;
	return separator;
};

const messageJoinCheck = (lastMessage, newMessage) => {
	let isJoined = (lastMessage?.uid === newMessage.uid);

	if (isJoined && lastMessage) {
		if (lastMessage.originalAuthor !== newMessage.originalAuthor) isJoined = false;
		if (lastMessage.attachment) isJoined = false;
		if (newMessage.ts - (20 * 60_000) > lastMessage.ts) isJoined = false;
	}

	return isJoined;
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
			} else if (!data.continuation && messageJoinCheck(data.msgData, lastMessage)) {
				document.getElementById(state.messages[0].id).remove();
				insertMessage({
					msgData: state.messages[0],
					isNew: false,
					continuation: true,
				});
			}
		}

		elements.messages.insertBefore(generateMessage(data.msgData, data.continuation, false, data.scrollAttachment), elements.messages.firstChild);
		if (!data.continuation) state.messages.splice(0, 0, data.msgData);
	} else {
		const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;

		if (data.afterElement) {
			const beforeElement = data.afterElement.nextSibling;
			const messageElement = generateMessage(data.msgData, messageJoinCheck(data.lastMessage, data.msgData), data.isShadow, data.isNew);

			if (beforeElement) {
				elements.messages.insertBefore(messageElement, beforeElement);
			} else {
				elements.messages.appendChild(messageElement);
			}
		} else {
			let correctIndex = 0;
			for (let i = state.messages.length - 1; i >= 0; i--) {
				if (state.messages[i].ts > data.msgData.ts) correctIndex++;
			}

			const lastMessage = state.messages[state.messages.length - (correctIndex + 1)];
			const nextMessage = state.messages[state.messages.length - correctIndex];
			const messageElement = generateMessage(data.msgData, messageJoinCheck(lastMessage, data.msgData), data.isShadow, data.isNew);

			if (correctIndex === 0) {
				const lastMessageElement = document.getElementById(lastMessage.id);
				if (lastMessageElement.nextSibling) {
					elements.messages.insertBefore(messageElement, lastMessageElement.nextSibling);
				} else {
					elements.messages.appendChild(messageElement);
				}

				if (lastMessage && !data.isShadow) {
					const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
					if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
						elements.messages.insertBefore(generateDaySeparator(data.msgData.ts), document.getElementById(data.msgData.id));
					}
				}
			} else {
				elements.messages.insertBefore(messageElement, document.getElementById(nextMessage.id));

				document.getElementById(nextMessage.id).remove();
				insertMessage({
					msgData: nextMessage,
					isNew: true,
					lastMessage: data.msgData,
					afterElement: document.getElementById(data.msgData.id),
				});
			}

			if (!data.isShadow) state.messages.splice(state.messages.length - correctIndex, 0, data.msgData);
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
			const msgElement = document.getElementById(data.msgData.id);
			if (msgElement) {
				msgElement.style.color = 'var(--red)';
				setTimeout(() => {
					document.getElementById(data.msgData.id)?.remove();
				}, 1_500);
			}
		}, 20_000);

		if (scroll) elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
	}
};

const getMissingUserData = (uid) => {
	if (!state.users[uid]) {
		state.users[uid] = {
			username: 'Ładowanie...',
			nickname: 'Ładowanie...',
		};

		state.sManager.send('getUser', {
			uid: uid,
		});
	}
};

const onAttachmentLoad = (element) => {
	elements.messageContainer.scrollTop = elements.messageContainer.scrollTop + element.height;
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	state.sManager.send('getMessages');
};

const resetUpload = () => {
	elements.uploadButton.innerHTML = svgs.plus;
	elements.uploadInput.value = '';
	state.currentAttachment = null;
};

const updateNickname = (uid) => {
	for (const msg of state.messages) {
		const msgMeta = document.getElementById(msg.id).querySelector('.message-meta');

		if (msgMeta) {
			if (msg.uid === uid) {
				const element = msgMeta.childNodes[0];
				if (element) element.innerHTML = state.users[uid].nickname;
			}

			if (msg.originalAuthor === uid) {
				const element = msgMeta.childNodes[2];
				if (element) element.innerHTML = state.users[uid].nickname;
			}
		}
	}

	const sidebarEntry = document.getElementById(`online-${uid}`);
	if (sidebarEntry) sidebarEntry.innerHTML = state.users[uid].nickname;
};

const verifyUsername = (username) => {
	if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9\-_]*$/.test(username)) return false;
	else return true;
};

const sanitizeText = (text) => {
	text = text.split('&').join('&amp;');
	text = text.split('<').join('&lt;');
	return text;
};

document.onkeydown = (event) => {
	if (event.code === 'Escape' && state.isClosablePopupOpen) {
		hidePopup();
	}
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
			const nonce = `${crypto.randomUUID()}-${Date.now()}`;
			insertMessage({
				msgData: {
					id: nonce,
					ts: Date.now() - state.timeOffset,
					uid: state.user.uid,
					message: value,
				},
				isNew: true,
				isShadow: true,
				afterElement: elements.messages.lastChild,
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

			state.sManager.send('sendMessage', {
				message: value,
				nonce: nonce,
				...attachment,
			});
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
	state.sManager.send('logOutEverywhere');
};

const logOutHandler = () => {
	localStorage.removeItem('token');
	state.sManager.disconnect();
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

		if (!verifyUsername(value)) {
			setPopupSubtitle({
				subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
			});
			elements.popup.classList.add('shaking');
		} else {
			if (value !== state.user.nickname) {
				showPopupSpinner();
				state.sManager.send('setNickname', {
					nickname: value,
				});
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
			});
			elements.popup.classList.add('shaking');
			return;
		}

		showPopupSpinner();
		state.sManager.send('changePassword', {
			oldPassword: await sha256(oldPasswordInput.value),
			password: await sha256(document.getElementById('popup-input-password').value),
		});
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
		showPopupSpinner();
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

		let error = 'Nieznany błąd. Spróbuj ponownie później';
		if (response.status === 200 || response.status === 400) {
			const data = await response.json();
			if (data.message === 'invalidLogin') {
				error = 'Niepoprawny login lub hasło';
			} else if (data.message === 'success') {
				localStorage.setItem('token', data.token);
				main();
				return;
			}
		} else if (response.status === 429) {
			error = 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie później';
		}

		setPopupSubtitle({
			subtitle: error,
		});
		elements.popup.classList.add('shaking');
		hidePopupSpinner();
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
		if (!captchaRow) return;
		captchaRow.innerHTML = popupCaptchaHTML;

		document.getElementById('popup-captcha').onclick = async () => {
			const response = await fetch('/api/captcha', {
				method: 'POST',
			});

			if (response.status === 200) {
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
			} else {
				setPopupSubtitle({
					subtitle: 'Zbyt wiele nieudanych prób rozwiązania CAPTCHy. Spróbuj ponownie później',
				});
				elements.popup.classList.add('shaking');
			}
		};
	};
	resetCaptcha();

	const registerFormHandler = async () => {
		if (registrationInProgress) return;
		else registrationInProgress = true;

		let error = '';
		const captchaInput = document.getElementById('popup-input-captcha');
		if (!captchaInput){
			error = 'Musisz potwierdzić że nie jesteś robotem';
		}

		if (!verifyUsername(usernameInput.value)) {
			error = 'Nazwa użytkownika powinna mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';
		}

		const password = document.getElementById('popup-input-password').value;
		if (password !== document.getElementById('popup-input-password2').value) {
			error = 'Wpisane hasła nie są identyczne';
		}

		if (error !== '') {
			setPopupSubtitle({
				subtitle: error,
			});
			elements.popup.classList.add('shaking');
			registrationInProgress = false;
			return;
		}

		showPopupSpinner();
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

		if (response.status === 200 || response.status === 400) {
			const data = await response.json();
			switch (data.message) {
				case 'success':
					break;
				case 'usernameAlreadyInUse':
					error = 'Ta nazwa użytkownika jest już zajęta';
					resetCaptcha();
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
		} else if (response.status === 429) {
			error = 'Zbyt wiele prób rejestracji. Spróbuj ponownie później';
		} else {
			error = 'Nieznany błąd. Spróbuj ponownie później';
		}

		if (error === '') {
			setPopupSubtitle({
				subtitle: 'Zarejestrowano pomyślnie!',
				subtitleColor: 'var(--green)',
			});
			setTimeout(() => {
				loginHandler();
			}, 1000);
		} else {
			hidePopupSpinner();
			setPopupSubtitle({
				subtitle: error,
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

	state.sManager.connect();
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

const getElementPosition = (element, noOffset = false) => {
	const rect = element.getBoundingClientRect();
	const win = element.ownerDocument.defaultView;

	let bottom = rect.bottom + win.pageYOffset, right = rect.right + win.pageXOffset;
	if (!noOffset) bottom = document.documentElement.clientHeight - bottom, right = document.documentElement.clientWidth - right;
	return {
		top: rect.top + win.pageYOffset,
		left: rect.left + win.pageXOffset,
		bottom,
		right,
	};
};

updateClock();
main();
