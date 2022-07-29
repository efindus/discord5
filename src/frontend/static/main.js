/* eslint-disable no-undef */

/**
 * @typedef App
 * @property {SocketManager} socket
 * @property {PopupManager} popup
 * @property {TooltipManager} tooltip
 * @property {SpinnerManager} spinner
 * @property {DropdownManager} dropdown
 * @property {object} user
 * @property {Record<string, object>} users
 * @property {Array<object>} messages
 * @property {Array<object>} notifications
 * @property {number} messagesToLoad
 * @property {number} timeOffset
 * @property {string?} currentAttachment
 */

/**
 * @type {App}
 */
const state = {
	socket: null,
	popup: null,
	tooltip: null,
	spinner: null,
	dropdown: null,

	user: {},
	users: {},
	messages: [],
	notifications: [],

	messagesToLoad: 50,
	timeOffset: 0,

	currentAttachment: null,
};

const elements = {
	onlineSidebar: document.querySelector('.online-sidebar'),

	usernameDisplay: document.getElementById('username-display'),
	userData: document.getElementById('user-data'),

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

		state.spinner.show();
		state.popup.hide();

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
			state.spinner.show();
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

			data.messages.reverse();
			for (let i = 0; i < data.messages.length; i++) {
				insertMessage({
					msgData: data.messages[i],
					msgIndex: i,
					isLastNew: (i + 1 === data.messages.length),
					scrollAttachment: state.messages.length < state.messagesToLoad,
				});
			}

			elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
			if (data.messages.length === state.messagesToLoad) elements.loadMessagesButton.style.display = 'table';
			if (state.messages.length <= state.messagesToLoad) state.spinner.hide();
		} else if (data.type === 'changePasswordCB') {
			if (data.message === 'success') {
				this.#reconnect = false;
				state.popup.setSubtitle({
					subtitle: 'Hasło zostało zmienione pomyślnie',
					subtitleColor: 'var(--green)',
				});
				setTimeout(() => {
					localStorage.removeItem('token');
					main();
				}, 1000);
			} else {
				state.popup.hideSpinner();
				state.popup.setSubtitle({
					subtitle: 'Niepoprawne stare hasło',
				});
				state.popup.shake();
			}
		} else if (data.type === 'updateNickname') {
			if (data.uid === state.user.uid) {
				if (data.nickname) {
					state.user.nickname = data.nickname;
					propagateUserData();
					state.popup.hide();
					state.spinner.hide();
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

					state.popup.setSubtitle({
						subtitle: error,
					});
					state.popup.shake();
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

class PopupManager {
	#elements = {
		container: document.getElementById('popup-container'),
		popup: document.getElementById('popup'),
		popupClose: document.getElementById('popup-close'),
		header: document.getElementById('popup-header'),
		title: document.getElementById('popup-title'),
		subtitle: document.getElementById('popup-subtitle'),
		body: document.getElementById('popup-body'),
		footer: document.getElementById('popup-footer'),
		spinner: document.getElementById('popup-spinner'),
	};

	#isOpen = false;
	#isCloseable = false;

	constructor() {
		this.#elements.popup.onanimationend = () => {
			this.#elements.popup.classList.remove('shaking');
		};
		this.#elements.popupClose.onclick = () => {
			this.hide();
		};
	}

	get isOpen() {
		return this.#isOpen;
	}

	get isClosable() {
		return this.#isCloseable;
	}

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
	show(data) {
		this.#elements.container.style.visibility = 'visible';
		this.#elements.container.style.opacity = '1';
		this.#elements.container.style.transitionDelay = '0s, 0s';
		this.#elements.container.style.transitionDuration = '0s, .25s';

		this.#elements.title.innerHTML = data.title;

		this.setSubtitle(data);
		state.popup.hideSpinner();

		this.#isOpen = true;
		if (data.closeable) {
			this.#elements.popupClose.style.display = '';
			this.#isCloseable = true;
		} else {
			this.#elements.popupClose.style.display = 'none';
			this.#isCloseable = false;
		}

		this.#elements.body.innerHTML = '';
		if (data.body) {
			this.#elements.header.style.margin = '';
			this.#elements.title.style.margin = '';
			for (const row of data.body) {
				const rowElement = document.createElement('div');
				rowElement.classList.add('popup-row');
				if (row.input) {
					rowElement.innerHTML = `<div class="popup-row-label">${row.label}</div><input id="${row.input.id}" class="popup-row-input" type="${row.input.type}" ${row.input.limit ? ` maxlength="${row.input.limit}"` : ''}>`;
				} else {
					rowElement.innerHTML = row.html;
				}
				this.#elements.body.appendChild(rowElement);
			}
			this.#elements.body.lastChild.style.marginBottom = '0px';
		} else {
			this.#elements.header.style.margin = '0px';
			this.#elements.title.style.margin = '0px';
		}

		this.#elements.footer.innerHTML = '';
		if (data.footer) {
			this.#elements.body.lastChild.style.marginBottom = '15px';
			for (const button of data.footer) {
				const buttonElement = document.createElement('div');
				buttonElement.classList.add('popup-button');
				buttonElement.id = button.id;
				buttonElement.innerHTML = button.label;
				buttonElement.style.backgroundColor = button.color ?? 'var(--blue)';
				this.#elements.footer.appendChild(buttonElement);
			}
			this.#elements.footer.lastChild.style.marginBottom = '0px';
		}
	}

	/**
	 * Set the subtitle
	 * @param {object} data
	 * @param {string} data.subtitle Popup subtitle (if empty hides the subtitle)
	 * @param {string} data.subtitleColor Popup subtitle color [default: var(--orange)]
	 */
	setSubtitle(data) {
		if (data.subtitle?.length > 0) {
			this.#elements.subtitle.style.display = '';
			this.#elements.subtitle.innerHTML = data.subtitle;
			this.#elements.subtitle.style.color = data.subtitleColor ?? 'var(--orange)';
		} else {
			this.#elements.subtitle.style.display = 'none';
		}
	}

	/**
	 * Change the popup footer into a spinner
	 */
	showSpinner() {
		this.#elements.footer.style.display = 'none';
		this.#elements.spinner.style.display = '';
	}

	hideSpinner() {
		this.#elements.footer.style.display = '';
		this.#elements.spinner.style.display = 'none';
	}

	/**
	 * Makes the popup shake sideways
	 */
	shake() {
		this.#elements.popup.classList.add('shaking');
	}

	hide() {
		this.#elements.container.style.visibility = 'hidden';
		this.#elements.container.style.opacity = '0';
		this.#elements.container.style.transitionDelay = '.25s, 0s';
		this.#elements.container.style.transitionDuration = '0s, .25s';

		this.#isOpen = false;
		this.#isCloseable = false;
	}
}

class TooltipManager {
	#elements = {
		container: document.querySelector('.tooltip-container'),
		tooltip: document.getElementById('tooltip'),
	};

	#isOpen = false;

	constructor() {
		this.#elements.container.onclick = () => {
			this.hide();
		};
	}

	get isOpen() {
		return this.#isOpen;
	}

	/**
	 * Show a tooltip
	 * @param {object} data
	 * @param {number} data.x
	 * @param {number} data.y
	 * @param {'left' | 'right' | 'top' | 'bottom'} data.side
	 * @param {string} data.content
	 * @param {boolean?} data.withArrow
	 */
	show(data) {
		this.#isOpen = true;

		this.#elements.container.style.visibility = 'visible';
		this.#elements.container.style.opacity = '1';
		this.#elements.container.style.transitionDelay = '0s, 0s';
		this.#elements.container.style.transitionDuration = '0s, .25s';

		this.#elements.tooltip.style.top = `${data.y}px`;
		this.#elements.tooltip.style.left = `${data.x}px`;

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

		this.#elements.tooltip.innerHTML = data.content;
		this.#elements.tooltip.style.transform = `translate(${transforms.x}, ${transforms.y})`;

		const offset = getElementPosition(this.#elements.tooltip);
		const position = getElementPosition(this.#elements.tooltip, true);
		const margin = 10;
		let maxMovement = (position.bottom - position.top) / 2 - 11;

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

		this.#elements.tooltip.style.transform = `translate(${transforms.x}, ${transforms.y})`;
		if (data.withArrow) {
			this.#elements.tooltip.classList.remove('tooltip-arrow-top', 'tooltip-arrow-bottom', 'tooltip-arrow-left', 'tooltip-arrow-right');
			this.#elements.tooltip.classList.add(`tooltip-arrow-${data.side}`);
			this.#elements.tooltip.style.setProperty('--tooltip-left', transforms.varLeft);
			this.#elements.tooltip.style.setProperty('--tooltip-top', transforms.varTop);
		}
	}

	hide() {
		this.#isOpen = false;

		this.#elements.container.style.visibility = 'hidden';
		this.#elements.container.style.opacity = '0';
		this.#elements.container.style.transitionDelay = '.25s, 0s';
		this.#elements.container.style.transitionDuration = '0s, .25s';
	}
}

class SpinnerManager {
	#elements = {
		spinner: document.getElementById('spinner'),
	};

	#isOpen = false;

	get isOpen() {
		return this.#isOpen;
	}

	show() {
		this.#isOpen = true;

		this.#elements.spinner.style.visibility = 'visible';
		this.#elements.spinner.style.opacity = '1';
		this.#elements.spinner.style.transitionDelay = '0s, 0s';
		this.#elements.spinner.style.transitionDuration = '0s, 0s';
	}

	hide() {
		this.#isOpen = false;

		this.#elements.spinner.style.visibility = 'hidden';
		this.#elements.spinner.style.opacity = '0';
		this.#elements.spinner.style.transitionDelay = '.5s, 0s';
		this.#elements.spinner.style.transitionDuration = '0s, .5s';
	}
}

class DropdownManager {
	#elements = {
		usernameContainer: document.getElementById('username-container'),
		dropdown: document.querySelector('.dropdown'),
		dropdownClose: document.getElementById('dropdown-close'),
	};

	#isOpen = false;

	constructor() {
		this.#elements.usernameContainer.onclick = () => {
			this.toggle();
		};
		this.#elements.dropdownClose.onclick = () => {
			this.toggle();
		};
	}

	get isOpen() {
		return this.#isOpen;
	}

	show() {
		this.#isOpen = true;

		this.#elements.dropdown.style.display = 'flex';
		this.#elements.usernameContainer.classList.add('dropdown-open');
		this.#elements.dropdownClose.style.display = 'block';
	}

	hide() {
		this.#isOpen = false;

		this.#elements.dropdown.style.display = 'none';
		this.#elements.usernameContainer.classList.remove('dropdown-open');
		this.#elements.dropdownClose.style.display = 'none';
	}

	toggle() {
		if (!this.#isOpen) this.show();
		else this.hide();
	}
}

state.socket = new SocketManager();
state.popup = new PopupManager();
state.tooltip = new TooltipManager();
state.spinner = new SpinnerManager();
state.dropdown = new DropdownManager();

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

const showUsernameTooltip = (element, uid, isSidebar = false) => {
	const position = getElementPosition(element, true);
	state.tooltip.show({
		x: isSidebar ? position.left - 10 : position.right + 10,
		y: position.top + ((position.bottom - position.top) / 2),
		side: isSidebar ? 'right' : 'left',
		content: `${state.users[uid].username}<br>ID: ${uid}`,
		withArrow: true,
	});
};

const showDateTooltip = (element, timestamp) => {
	const position = getElementPosition(element, true);
	state.tooltip.show({
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

/**
 * Insert node after element
 * @param {Node} parent
 * @param {Node} newNode
 * @param {Node} referenceChild
 */
const insertAfter = (parent, newNode, referenceChild) => {
	if (!referenceChild.nextSibling) {
		parent.appendChild(newNode);
	} else {
		parent.insertBefore(newNode, referenceChild.nextSibling);
	}
};

/**
 * @typedef MessageData
 * @property {string} id
 * @property {number} ts
 * @property {string} message
 * @property {string} uid
 * @property {string?} originalAuthor
 * @property {string?} attachment
 * @property {string?} nonce
 */

/**
 * Insert a message into the website
 * @param {object} data
 * @param {MessageData} data.msgData
 * @param {number} data.msgIndex
 * @param {boolean} data.isLastNew
 * @param {boolean} data.isNew
 * @param {boolean} data.continuation
 * @param {boolean} data.scrollAttachment
 * @param {boolean} data.isShadow
 * @param {Node} data.afterElement
 * @param {MessageData} data.lastMessage
 */
const insertMessage = (data) => {
	getMissingUserData(data.msgData.uid);
	if (data.msgData.originalAuthor) getMissingUserData(data.msgData.originalAuthor);

	if (!data.isNew) {
		if (data.msgIndex === 0) {
			elements.messages.insertBefore(generateMessage(data.msgData, false, false, data.scrollAttachment), elements.messages.firstChild);
		} else {
			const lastMessage = state.messages[data.msgIndex - 1], lastMessageElement = document.getElementById(lastMessage.id);
			insertAfter(
				elements.messages,
				generateMessage(data.msgData, messageJoinCheck(lastMessage, data.msgData), false, data.scrollAttachment),
				lastMessageElement,
			);

			const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
			if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
				insertAfter(elements.messages, generateDaySeparator(data.msgData.ts), lastMessageElement);
			}
		}

		state.messages.splice(data.msgIndex, 0, data.msgData);

		const nextMessage = state.messages[data.msgIndex + 1];
		if (data.isLastNew && nextMessage && messageJoinCheck(data.msgData, nextMessage)) {
			document.getElementById(nextMessage.id).remove();
			insertMessage({
				msgData: nextMessage,
				msgIndex: data.msgIndex + 1,
				isNew: false,
			});
			state.messages.splice(data.msgIndex + 1, 1);
		}
	} else {
		const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;

		if (data.afterElement) {
			insertAfter(
				elements.messages,
				generateMessage(data.msgData, messageJoinCheck(data.lastMessage, data.msgData), data.isShadow, data.isNew),
				data.afterElement,
			);
		} else {
			let correctIndex = 0;
			for (let i = state.messages.length - 1; i >= 0; i--) {
				if (state.messages[i].ts > data.msgData.ts) correctIndex++;
			}

			const lastMessage = state.messages[state.messages.length - (correctIndex + 1)];
			const nextMessage = state.messages[state.messages.length - correctIndex];
			const messageElement = generateMessage(data.msgData, messageJoinCheck(lastMessage, data.msgData), data.isShadow, data.isNew);

			if (correctIndex === 0) {
				insertAfter(elements.messages, messageElement, document.getElementById(lastMessage.id));

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

		state.socket.send('getUser', {
			uid: uid,
		});
	}
};

const onAttachmentLoad = (element) => {
	elements.messageContainer.scrollTop = elements.messageContainer.scrollTop + element.height;
};

const loadMessages = () => {
	elements.loadMessagesButton.style.display = 'none';
	state.socket.send('getMessages');
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
	if (event.code === 'Escape' && state.popup.isClosable) {
		state.popup.hide();
	} else if (document.body === document.activeElement && !state.dropdown.isOpen) {
		console.log(document.activeElement);
		elements.input.focus();
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

			state.socket.send('sendMessage', {
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

const updateClock = () => {
	const NOW = new Date(Date.now() - state.timeOffset);
	elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
	setTimeout(updateClock, 1000 - ((Date.now() - state.timeOffset) % 1000) + 10);
};

const logOutEverywhereHandler = () => {
	state.socket.send('logOutEverywhere');
};

const logOutHandler = () => {
	localStorage.removeItem('token');
	state.socket.disconnect();
	main();
};

const changeNicknameHandler = (closeable = true, subtitle = '', startingValue = '') => {
	state.popup.show({
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
			state.popup.setSubtitle({
				subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
			});
			state.popup.shake();
		} else {
			if (value !== state.user.nickname) {
				state.popup.showSpinner();
				state.socket.send('setNickname', {
					nickname: value,
				});
			} else {
				state.popup.hide();
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
	state.popup.show({
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
			state.popup.setSubtitle({
				subtitle: 'Podane nowe hasła nie są identyczne',
			});
			state.popup.shake();
			return;
		}

		state.popup.showSpinner();
		state.socket.send('changePassword', {
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
	state.spinner.hide();
	state.popup.show({
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
		state.popup.showSpinner();
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

		state.popup.setSubtitle({
			subtitle: error,
		});
		state.popup.shake();
		state.popup.hideSpinner();
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
	state.spinner.hide();
	let registrationInProgress = false;
	const popupCaptchaHTML = '<div id="popup-captcha" class="popup-button" style="background-color: var(--border); margin-bottom: 20px;">Nie jestem robotem</div>';
	state.popup.show({
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
				state.popup.setSubtitle({
					subtitle: 'Zbyt wiele nieudanych prób rozwiązania CAPTCHy. Spróbuj ponownie później',
				});
				state.popup.shake();
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
			state.popup.setSubtitle({
				subtitle: error,
			});
			state.popup.shake();
			registrationInProgress = false;
			return;
		}

		state.popup.showSpinner();
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
			state.popup.setSubtitle({
				subtitle: 'Zarejestrowano pomyślnie!',
				subtitleColor: 'var(--green)',
			});
			setTimeout(() => {
				loginHandler();
			}, 1000);
		} else {
			state.popup.hideSpinner();
			state.popup.setSubtitle({
				subtitle: error,
			});
			state.popup.shake();
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

	state.socket.connect();
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
