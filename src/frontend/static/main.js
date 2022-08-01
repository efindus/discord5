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
	#app;

	/**
	 * @type {WebSocket}
	 */
	#socket;
	#pinger;

	#reconnect = true;
	#receiveQueue = {};
	#protocolVersion = '1';
	#messagesToLoad = 100;

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
	}

	connect() {
		this.#socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
		this.#reconnect = true;

		this.#app.spinner.show();
		this.#app.popup.hide();

		this.#socket.addEventListener('open', () => this.#setupPinger());
		this.#socket.addEventListener('message', (event) => this.#onMessage(event));
		this.#socket.addEventListener('close', () => this.#onClose());
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


	#propagateUserData() {
		this.#app.elements.usernameDisplay.innerText = this.#app.user.username;
		this.#app.elements.userData.innerHTML = `ID: ${this.#app.user.uid}<br>Pseudonim: ${this.#app.user.nickname}`;
	}

	getMissingUserData(uid) {
		if (!this.#app.users[uid]) {
			this.#app.users[uid] = {
				username: 'Ładowanie...',
				nickname: 'Ładowanie...',
			};

			this.send('getUser', {
				uid: uid,
			});
		}
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
		this.#app.messages.clear();

		if (this.#reconnect) {
			this.#app.spinner.show();
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

				this.#app.user = data.user;
				this.#messagesToLoad = data.messagesToLoad;
				this.#app.timeOffset = Date.now() - data.serverTime;

				this.#propagateUserData();
				this.#app.messages.load();
			} else if (data.message === 'invalidLogin') {
				logOutHandler();
			}
		} else if (data.type === 'newMessage') {
			if (data.nonce) {
				document.getElementById(data.nonce)?.remove();
			}

			this.#app.messages.insert({
				msgData: data,
				isNew: true,
			});
		} else if (data.type === 'loadMessages') {
			const oldHeight = this.#app.elements.messageContainer.scrollHeight;

			data.messages.reverse();
			for (let i = 0; i < data.messages.length; i++) {
				this.#app.messages.insert({
					msgData: data.messages[i],
					msgIndex: i,
					isLastNew: (i + 1 === data.messages.length),
					scrollAttachment: this.#app.messages.count < this.#messagesToLoad,
				});
			}

			this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight - oldHeight + this.#app.elements.messageContainer.scrollTop);
			if (data.messages.length === this.#messagesToLoad) this.#app.messages.showLoadButton();
			if (this.#app.messages.count <= this.#messagesToLoad) this.#app.spinner.hide();
		} else if (data.type === 'changePasswordCB') {
			if (data.message === 'success') {
				this.#reconnect = false;
				this.#app.popup.setSubtitle({
					subtitle: 'Hasło zostało zmienione pomyślnie',
					subtitleColor: 'var(--green)',
				});
				setTimeout(() => {
					localStorage.removeItem('token');
					this.#app.main();
				}, 1000);
			} else {
				this.#app.popup.hideSpinner();
				this.#app.popup.setSubtitle({
					subtitle: 'Niepoprawne stare hasło',
				});
				this.#app.popup.shake();
			}
		} else if (data.type === 'updateNickname') {
			if (data.uid === this.#app.user.uid) {
				if (data.nickname) {
					this.#app.user.nickname = data.nickname;
					this.#propagateUserData();
					this.#app.popup.hide();
					this.#app.spinner.hide();
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

					this.#app.popup.setSubtitle({
						subtitle: error,
					});
					this.#app.popup.shake();
				}
			}

			if (data.nickname.length !== 0) {
				this.#app.users[data.uid].nickname = data.nickname;

				this.#app.messages.updateNickname(data.uid);
			}
		} else if (data.type === 'updateUser') {
			if (data.username.length !== 0) {
				this.#app.users[data.uid] = {
					username: data.username,
					nickname: data.nickname,
				};

				this.#app.messages.updateNickname(data.uid);
			}
		} else if (data.type === 'reload') {
			window.location.reload();
		} else if (data.type === 'clientsOnline') {
			this.#app.elements.onlineSidebar.innerHTML = '';
			for (const client of data.clients) {
				this.getMissingUserData(client);
				this.#app.elements.onlineSidebar.innerHTML += `<div class="online-entry" id="online-${client}" ${this.#app.utils.generateUsernameTooltip(client, true)}>${this.#app.users[client].nickname}</div>`;
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
		this.#elements.popup.addEventListener('animationend', () => {
			this.#elements.popup.classList.remove('shaking');
		});

		this.#elements.popupClose.addEventListener('click', () => this.hide());
		document.addEventListener('keydown', (event) => {
			if (event.code === 'Escape' && this.#isCloseable) {
				this.hide();
			}
		});
	}

	get isOpen() {
		return this.#isOpen;
	}

	get isCloseable() {
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
		this.hideSpinner();

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
	#app;

	#elements = {
		container: document.querySelector('.tooltip-container'),
		tooltip: document.getElementById('tooltip'),
	};

	#isOpen = false;

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
		this.#elements.container.addEventListener('click', () => this.hide());
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

		const offset = this.#app.utils.getElementPosition(this.#elements.tooltip);
		const position = this.#app.utils.getElementPosition(this.#elements.tooltip, true);
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
		this.#elements.usernameContainer.addEventListener('click', () => this.toggle());
		this.#elements.dropdownClose.addEventListener('click', () => this.toggle());
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

class NotificationManager {
	#notifications = [];

	/**
	 * @param {App} app
	 */
	constructor(app) {
		document.addEventListener('focus', () => {
			for (const notification of this.#notifications) {
				notification.close();
			}

			this.#notifications = [];
		});

		app.elements.messageContainer.addEventListener('scroll', () => {
			if (Notification.permission === 'default') Notification.requestPermission();
		});
	}

	/**
	 * Create a new notification
	 * @param {object} data
	 * @param {string} data.title
	 * @param {string} data.body
	 */
	create(data) {
		if (Notification.permission !== 'granted') return;

		const notification = new Notification(data.title, {
			body: data.body,
			icon: '/favicon.ico',
		});

		notification.addEventListener('close', () => {
			this.#notifications.splice(this.#notifications.indexOf(notification), 1);
		});

		this.#notifications.push(notification);
	}
}

class MessageManager {
	#app;

	#utils = {
		generateMessageMeta: (msgData, isContinuation) => {
			if (isContinuation) return '';

			const messageAuthor = `<div class="message-username" ${this.#app.utils.generateUsernameTooltip(msgData.uid)}>${this.#app.users[msgData.uid].nickname}</div>`;
			const messageDate = `<div class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</div>`;
			let messageFor = '';
			if (msgData.originalAuthor) {
				messageFor = `<div style="margin-right: 6px;">dla</div><div class="message-username" ${this.#app.utils.generateUsernameTooltip(msgData.originalAuthor)}>${this.#app.users[msgData.originalAuthor].nickname}</div>`;
			}

			return `<div class="message-meta">${messageAuthor}${messageFor}${messageDate}</div>`;
		},
		generateMessageContent: (msgData, isContinuation) => {
			const messageContent = this.#app.utils.markdownToHTML(this.#app.utils.sanitizeText(msgData.message)).split('\n').join('<br>');

			return `<div class="message-content" ${isContinuation ? this.#app.utils.generateDateTooltip(msgData.ts) : ''}>${messageContent}</div>`;
		},
		generateMessageAttachment: (msgData, isNew) => {
			if (!msgData.attachment) return '';

			let messageAttachment = `<a class="message-attachment-name" href="/attachments/${msgData.attachment}" target="_blank">${msgData.attachment}</a>`;
			if (msgData.attachment && (
				msgData.attachment.endsWith('.png') ||
				msgData.attachment.endsWith('.jpg') ||
				msgData.attachment.endsWith('.jpeg') ||
				msgData.attachment.endsWith('.gif') ||
				msgData.attachment.endsWith('.webp')
			)) {
				messageAttachment = `<img src="/attachments/${msgData.attachment}" ${isNew ? 'onload="app.onAttachmentLoad(this)" ' : ''}onerror="this.remove()"><div>${messageAttachment}</div>`;
			}

			return `<div class="message-attachment">${messageAttachment}</div>`;
		},
		messageJoinCheck: (lastMessage, newMessage) => {
			let isJoined = (lastMessage?.uid === newMessage.uid);

			if (isJoined && lastMessage) {
				if (lastMessage.originalAuthor !== newMessage.originalAuthor) isJoined = false;
				if (lastMessage.attachment) isJoined = false;
				if (newMessage.ts - (20 * 60_000) > lastMessage.ts) isJoined = false;
			}

			return isJoined;
		},
	};

	#elements = {
		messages: document.getElementById('messages'),
		loadMessagesButton: document.getElementById('load-messages-button'),

		input: document.getElementById('input'),
		uploadInput: document.getElementById('upload-input'),
		uploadButton: document.getElementById('upload-button'),
	};

	#messages = [];
	#currentAttachment = null;

	get count() {
		return this.#messages.length;
	}

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;

		this.#elements.loadMessagesButton.addEventListener('click', () => app.messages.load());
		this.#elements.input.addEventListener('keydown', (event) => {
			if ((event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
				event.preventDefault();

				let value = this.#elements.input.value.trim();

				if (value === '/tableflip') {
					value = '(╯°□°）╯︵ ┻━┻';
				} else if (value === '/unflip') {
					value = '┬─┬ ノ( ゜-゜ノ)';
				} else if (value === '/shrug') {
					value = '¯\\\\_(ツ)_/¯';
				}

				if (value.length > 0 && value.length <= 2000) {
					this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight);
					this.#elements.input.value = '';
					const nonce = `${crypto.randomUUID()}-${Date.now()}`;
					this.insert({
						msgData: {
							id: nonce,
							ts: Date.now() - this.#app.timeOffset,
							uid: this.#app.user.uid,
							message: value,
						},
						isNew: true,
						isShadow: true,
						afterElement: this.#elements.messages.lastChild,
					});

					let attachment = {};
					if (this.#currentAttachment) {
						attachment = {
							attachment: {
								fileName: this.#elements.uploadInput.files[0].name,
								data: this.#currentAttachment,
							},
						};

						this.resetUpload();
					}

					this.#app.socket.send('sendMessage', {
						message: value,
						nonce: nonce,
						...attachment,
					});
				}
			}
		});

		this.#elements.uploadInput.addEventListener('change', () => {
			if (this.#elements.uploadInput.value !== '' && this.#elements.uploadInput.files[0].size <= 11160000) {
				this.#elements.uploadButton.innerHTML = svgs.cross;

				const reader = new FileReader();
				reader.addEventListener('load', (event) => {
					this.#currentAttachment = this.#app.utils.fromArrayBufferToBase64(event.target.result);
				});

				reader.readAsArrayBuffer(this.#elements.uploadInput.files[0]);
			} else {
				this.#elements.uploadInput.value = '';
			}
		});

		this.#elements.uploadButton.addEventListener('click', (event) => {
			if (this.#elements.uploadInput.value !== '') {
				event.preventDefault();
				this.resetUpload();
			}
		});
	}

	#generateMessage(msgData, isContinuation = false, isShadow = false, isNew = false) {
		const message = document.createElement('div');
		message.id = msgData.id;
		message.classList.add('message');
		if (isShadow) {
			message.classList.add('message-shadow');
			isContinuation = false;
		}

		message.innerHTML = `${this.#utils.generateMessageMeta(msgData, isContinuation)}${this.#utils.generateMessageContent(msgData, isContinuation)}${this.#utils.generateMessageAttachment(msgData, isNew)}`;
		return message;
	}

	#generateDaySeparator(timestamp) {
		const separator = document.createElement('div');
		separator.classList.add('day-separator');
		separator.innerHTML = `<span class="day-separator-text">${(new Date(timestamp)).toLocaleDateString('pl')}</span>`;
		return separator;
	}

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
	insert(data) {
		this.#app.socket.getMissingUserData(data.msgData.uid);
		if (data.msgData.originalAuthor) this.#app.socket.getMissingUserData(data.msgData.originalAuthor);

		if (!data.isNew) {
			if (data.msgIndex === 0) {
				this.#elements.messages.insertBefore(this.#generateMessage(data.msgData, false, false, data.scrollAttachment), this.#elements.messages.firstChild);
			} else {
				const lastMessage = this.#messages[data.msgIndex - 1], lastMessageElement = document.getElementById(lastMessage.id);
				this.#app.utils.insertAfter(
					this.#elements.messages,
					this.#generateMessage(data.msgData, this.#utils.messageJoinCheck(lastMessage, data.msgData), false, data.scrollAttachment),
					lastMessageElement,
				);

				const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
				if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
					this.#app.utils.insertAfter(this.#elements.messages, this.#generateDaySeparator(data.msgData.ts), lastMessageElement);
				}
			}

			this.#messages.splice(data.msgIndex, 0, data.msgData);

			const nextMessage = this.#messages[data.msgIndex + 1];
			if (data.isLastNew && nextMessage && this.#utils.messageJoinCheck(data.msgData, nextMessage)) {
				document.getElementById(nextMessage.id).remove();
				this.insert({
					msgData: nextMessage,
					msgIndex: data.msgIndex + 1,
					isNew: false,
				});
				this.#messages.splice(data.msgIndex + 1, 1);
			}
		} else {
			const scroll = this.#app.elements.messageContainer.offsetHeight + this.#app.elements.messageContainer.scrollTop + 20 > this.#app.elements.messageContainer.scrollHeight;

			if (data.afterElement) {
				this.#app.utils.insertAfter(
					this.#elements.messages,
					this.#generateMessage(data.msgData, this.#utils.messageJoinCheck(data.lastMessage, data.msgData), data.isShadow, data.isNew),
					data.afterElement,
				);
			} else {
				let correctIndex = 0;
				for (let i = this.#messages.length - 1; i >= 0; i--) {
					if (this.#messages[i].ts > data.msgData.ts) correctIndex++;
				}

				const lastMessage = this.#messages[this.#messages.length - (correctIndex + 1)];
				const nextMessage = this.#messages[this.#messages.length - correctIndex];
				const messageElement = this.#generateMessage(data.msgData, this.#utils.messageJoinCheck(lastMessage, data.msgData), data.isShadow, data.isNew);

				if (correctIndex === 0) {
					this.#app.utils.insertAfter(this.#elements.messages, messageElement, document.getElementById(lastMessage.id));

					if (lastMessage && !data.isShadow) {
						const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
						if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl')) {
							this.#elements.messages.insertBefore(this.#generateDaySeparator(data.msgData.ts), document.getElementById(data.msgData.id));
						}
					}
				} else {
					this.#elements.messages.insertBefore(messageElement, document.getElementById(nextMessage.id));

					document.getElementById(nextMessage.id).remove();
					this.insert({
						msgData: nextMessage,
						isNew: true,
						lastMessage: data.msgData,
						afterElement: document.getElementById(data.msgData.id),
					});
				}

				if (!data.isShadow) this.#messages.splice(this.#messages.length - correctIndex, 0, data.msgData);
			}

			if (!data.isShadow && !document.hasFocus()) {
				this.#app.notifications.create({
					title: 'Discord5: New Message',
					body: `${this.#app.users[data.msgData.uid].nickname}: ${data.msgData.message.slice(0, 150)}`,
				});
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

			if (scroll) this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight);
		}
	}

	clear() {
		this.#elements.messages.innerHTML = '';
		this.#messages = [];
	}

	load() {
		this.#elements.loadMessagesButton.style.display = 'none';
		this.#app.socket.send('getMessages');
	}

	showLoadButton() {
		this.#elements.loadMessagesButton.style.display = 'table';
	}

	resetUpload() {
		this.#elements.uploadButton.innerHTML = svgs.plus;
		this.#elements.uploadInput.value = '';
		this.currentAttachment = null;
	}

	updateNickname(uid) {
		for (const msg of this.#messages) {
			const msgMeta = document.getElementById(msg.id).querySelector('.message-meta');

			if (msgMeta) {
				if (msg.uid === uid) {
					const element = msgMeta.childNodes[0];
					if (element) element.innerHTML = this.#app.users[uid].nickname;
				}

				if (msg.originalAuthor === uid) {
					const element = msgMeta.childNodes[2];
					if (element) element.innerHTML = this.#app.users[uid].nickname;
				}
			}
		}

		const sidebarEntry = document.getElementById(`online-${uid}`);
		if (sidebarEntry) sidebarEntry.innerHTML = this.#app.users[uid].nickname;
	}
}

class Utils {
	#expressions = {
		split: /(\s)*[A-Za-z0-9_]*[^A-Za-z0-9_]/g,
		multilineComment: /^(\s)*\/\*/g,
		comment: /^(\s)*\/\//g,
		keyword: /^(\s)*(alignas|alignof|auto|bool|char8_t|char16_t|char32_t|char|class|const_cast|const|decltype|delete|double|dynamic_cast|enum|explicit|export|extern|false|float|friend|inline|int|long|mutable|namespace|new|noexcept|nullptr|operator|private|protected|public|register|short|signed|sizeof|static_cast|static_assert|static|struct|template|this|thread_local|true|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t)$/g,
		operator: /^(\s)*(and_eq|and|bitand|bitor|compl|not_eq|not|or_eq|or|xor_eq|xor|\+|-|\*|\/|%|:|;|{|}|\(|\)|&|\||=|\[|]|<|>|,)$/g,
		instruction: /^(\s)*(break|case|catch|continue|default|do|else|for|goto|if|return|switch|throw|try|while)$/g,
		number: /^(\s)*(([1-9][0-9]*)|(0[bB][01]+)|(0[0-8]*)|(0[xX][0-9A-Fa-f]+))$/,
		function: /^(\s)*[A-Za-z0-9_]+(\s)*\(/g,
		builtIn: /^(\s)*(ios_base|string|wstring|stringstream|istringstream|ostringstream|auto_ptr|deque|list|queue|stack|vector|map|set|pair|bitset|multiset|multimap|unordered_set|unordered_map|unordered_multiset|unordered_multimap|priority_queue|array|shared_ptr)$/g,
		white: /^(\s)*(std|cin|cout|cerr|clog|endl)$/g,
		definition: /^(\s)*(stdin|stdout|stderr|NULL)$/g,
		include: /^(\s)*#(\s)*include(\s)*<[^>]*>/g,
		preprocessor: /^(\s)*#(\s)*(ifdef|elif|ifndef|line|else|error|include|define|endif|if|undef)[^A-Za-z0-9_]/g,
		string: /^(\s)*"/g,
		stringEnd: /^(.*[^\\](\\\\)*)?"/g,
	};

	#markdown = [ [ '**', 'b' ], [ '*', 'i' ], [ '__', 'u' ], [ '~~', 'strike' ] ];

	#mode;

	#isAtPosition(text, value, position) {
		for (let i = 0; i < value.length; i++) {
			if (text[position + i] !== value[i]) {
				return false;
			}
		}

		return true;
	}

	#highlightPart(text) {
		if (text.length === 0) return '';

		if (this.#mode === 'comment') {
			const end = text.indexOf('*/');

			if (end === -1) {
				return `<span class='comment'>${text}</span>`;
			} else {
				this.#mode = 'default';
				return `<span class='comment'>${text.slice(0, end + 2)}</span>${this.#highlightPart(text.slice(end + 2))}`;
			}
		} else if (text.match(this.#expressions.multilineComment) !== null) {
			const match = text.match(this.#expressions.multilineComment)[0];
			this.#mode = 'comment';

			return `<span class='comment'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
		} else if (text.match(this.#expressions.comment) !== null) {
			return `<span class='comment'>${text}</span>`;
		} else if (text.match(this.#expressions.include) !== null) {
			const match = text.match(this.#expressions.include)[0];
			const index = match.indexOf('<');

			return `<span class='preprocessor'>${text.slice(0, index)}</span><span class='string-special'>&lt;</span><span class='string'>${text.slice(index + 1, match.length - 1)}</span><span class='string-special'>></span>${this.#highlightPart(text.slice(match.length))}`;
		} else if (text.match(this.#expressions.preprocessor) !== null) {
			const match = text.match(this.#expressions.preprocessor)[0];
			return `<span class='preprocessor'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
		} else if (text.match(this.#expressions.string) !== null) {
			const match = text.match(this.#expressions.string)[0];
			const end = text.slice(match.length).match(this.#expressions.stringEnd);

			if (end === null) {
				return `<span class='string'>${text}</span>`;
			} else {
				return `<span class='string'>${match + end[0]}</span>${this.#highlightPart(text.slice(end[0].length + match.length))}`;
			}
		} else {
			let match = text.match(this.#expressions.split)[0];

			if (match.length > 1) match = match.slice(0, match.length - 1);

			if (match.match(this.#expressions.keyword) !== null) {
				return `<span class='keyword'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.instruction) !== null) {
				return `<span class='instruction'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.operator) !== null) {
				return `<span class='operator'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.number) !== null) {
				return `<span class='number'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (text.match(this.#expressions.function) !== null) {
				let match2 = text.match(this.#expressions.function)[0];
				match2 = match2.slice(0, match2.length - 1);

				return `<span class='function'>${match2}</span>${this.#highlightPart(text.slice(match2.length))}`;
			} else if (match.match(this.#expressions.definition) !== null) {
				return `<span class='definition'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.white) !== null) {
				return `<span class='white'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.builtIn) !== null) {
				return `<span class='builtin'>${match}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else {
				return `<span class='other'>${match}</span>${(text.length > match.length ? this.#highlightPart(text.slice(match.length)) : '')}`;
			}
		}
	}

	#highlight(text) {
		let result = '';
		const lines = text.split('&lt;').join('<').trim().split('\n');

		this.#mode = 'default';

		// TODO: maybe remove this
		for (let i = 0; i < lines.length; i++) {
			result += `<div class="code-line"><div class="code-line-number">${i + 1}</div><div class="code-line-content">${this.#highlightPart(`${lines[i]}\u200B`)}</div></div>`;
		}

		return `<div class="code-snippet">${result}</div>`;
	}

	#findNext(text, value, position) {
		let cancel = false;

		for (let i = position; i < text.length; i++) {
			if (cancel) cancel = false;
			else if (text[i] === '\\') cancel = true;
			else if (this.#isAtPosition(text, value, i)) return i;
		}

		return -1;
	}

	markdownToHTML(text) {
		let result = '';
		let cancel = false;

		for (let i = 0; i < text.length; i++) {
			if (cancel) {
				if (text[i] !== '*' && text[i] !== '\\' && text[i] !== '_' && text[i] !== '~') {
					result += '\\';
				}

				result += text[i];
				cancel = false;
			} else if (text[i] === '\\') {
				cancel = true;
			} else if (this.#isAtPosition(text, '```', i)) {
				const end = text.indexOf('```', i + 3);

				if (end !== -1) {
					result += this.#highlight(text.slice(i + 3, end));
					i = end + 2;
				} else {
					result += text[i];
				}
			} else {
				let activated = false;

				for (let position = 0; position < this.#markdown.length; position++) {
					if (this.#isAtPosition(text, this.#markdown[position][0], i)) {
						let next = this.#findNext(text, this.#markdown[position][0], i + this.#markdown[position][0].length);

						if (next !== -1) {
							if (text.slice(i + this.#markdown[position][0].length, next).trim().length === 0) {
								next = this.#findNext(text, this.#markdown[position][0], next + 1);
							}

							if (next !== -1) {
								result += `<${this.#markdown[position][1]}>${this.markdownToHTML(text.slice(i + this.#markdown[position][0].length, next))}</${this.#markdown[position][1]}>`;
								activated = true;
								i = next + this.#markdown[position][0].length - 1;

								break;
							}
						}
					}
				}

				if (!activated) result += text[i];
			}
		}

		return result;
	}

	async sha256(message) {
		const msgBuffer = new TextEncoder().encode(message);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex;
	}

	fromArrayBufferToBase64(arrayBuffer) {
		let base64 = '';
		const encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

		const bytes = new Uint8Array(arrayBuffer);
		const byteLength = bytes.byteLength;
		const byteRemainder = byteLength % 3;
		const mainLength = byteLength - byteRemainder;

		let a, b, c, d;
		let chunk;

		for (let i = 0; i < mainLength; i = i + 3) {
			chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

			a = (chunk & 16515072) >> 18;
			b = (chunk & 258048) >> 12;
			c = (chunk & 4032) >> 6;
			d = chunk & 63;

			base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
		}

		if (byteRemainder === 1) {
			chunk = bytes[mainLength];

			a = (chunk & 252) >> 2;
			b = (chunk & 3) << 4;

			base64 += encodings[a] + encodings[b] + '==';
		} else if (byteRemainder === 2) {
			chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

			a = (chunk & 64512) >> 10;
			b = (chunk & 1008) >> 4;
			c = (chunk & 15) << 2;

			base64 += encodings[a] + encodings[b] + encodings[c] + '=';
		}

		return base64;
	}

	getElementPosition(element, noOffset = false) {
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
	}

	/**
	 * Insert node after element
	 * @param {Node} parent
	 * @param {Node} newNode
	 * @param {Node} referenceChild
	 */
	insertAfter(parent, newNode, referenceChild) {
		if (!referenceChild.nextSibling) {
			parent.appendChild(newNode);
		} else {
			parent.insertBefore(newNode, referenceChild.nextSibling);
		}
	}

	verifyUsername(username) {
		if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9\-_]*$/.test(username)) return false;
		else return true;
	}

	sanitizeText(text) {
		text = text.split('&').join('&amp;');
		text = text.split('<').join('&lt;');
		return text;
	}

	generateUsernameTooltip(uid, isSidebar = false) {
		return `onclick="app.showUsernameTooltip(this, '${uid}', ${isSidebar})"`;
	}

	generateDateTooltip(timestamp) {
		return `ondblclick="app.showDateTooltip(this, ${timestamp})"`;
	}
}

class App {
	socket;
	popup;
	tooltip;
	spinner;
	dropdown;
	notifications;
	messages;
	utils;

	user = {};
	users = {};

	timeOffset = 0;

	elements = {
		onlineSidebar: document.querySelector('.online-sidebar'),

		usernameDisplay: document.getElementById('username-display'),
		userData: document.getElementById('user-data'),

		messageContainer: document.getElementById('message-container'),

		clock: document.getElementById('clock'),
	};

	constructor() {
		this.socket = new SocketManager(this);
		this.popup = new PopupManager();
		this.tooltip = new TooltipManager(this);
		this.spinner = new SpinnerManager();
		this.dropdown = new DropdownManager();
		this.notifications = new NotificationManager(this);
		this.messages = new MessageManager(this);
		this.utils = new Utils();

		this.#updateClock();
	}

	async main() {
		const token = localStorage.getItem('token');
		if (!token) {
			loginHandler();
			return;
		}

		this.socket.connect();
	}

	#updateClock() {
		const NOW = new Date(Date.now() - this.timeOffset);
		this.elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
		setTimeout(() => this.#updateClock(), 1000 - ((Date.now() - this.timeOffset) % 1000) + 10);
	}

	onAttachmentLoad(element) {
		this.elements.messageContainer.scrollTop = this.elements.messageContainer.scrollTop + element.height;
	}

	showUsernameTooltip(element, uid, isSidebar = false) {
		const position = this.utils.getElementPosition(element, true);
		this.tooltip.show({
			x: isSidebar ? position.left - 10 : position.right + 10,
			y: position.top + ((position.bottom - position.top) / 2),
			side: isSidebar ? 'right' : 'left',
			content: `${this.users[uid].username}<br>ID: ${uid}`,
			withArrow: true,
		});
	}

	showDateTooltip(element, timestamp) {
		const position = this.utils.getElementPosition(element, true);
		this.tooltip.show({
			x: position.left,
			y: position.top - 10,
			side: 'bottom',
			content: `${new Date(timestamp).toLocaleString('pl')}`,
			withArrow: true,
		});
	}
}

const app = new App();

const logOutEverywhereHandler = () => {
	app.socket.send('logOutEverywhere');
};

const logOutHandler = () => {
	localStorage.removeItem('token');
	app.socket.disconnect();
	app.main();
};

const changeNicknameHandler = (closeable = true, subtitle = '', startingValue = '') => {
	app.popup.show({
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

		if (!app.utils.verifyUsername(value)) {
			app.popup.setSubtitle({
				subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
			});
			app.popup.shake();
		} else {
			if (value !== app.user.nickname) {
				app.popup.showSpinner();
				app.socket.send('setNickname', {
					nickname: value,
				});
			} else {
				app.popup.hide();
			}
		}
	};

	document.getElementById('popup-button-changeNickname').onclick = changeNicknameFormHandler;
	nicknameInput.onkeydown = (event) => {
		if (event.code === 'Enter' || event.keyCode === 13) {
			changeNicknameFormHandler();
		}
	};

	nicknameInput.value = startingValue === '' ? app.user.nickname : startingValue;
	nicknameInput.focus();
};

const changePasswordHandler = () => {
	app.popup.show({
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
			app.popup.setSubtitle({
				subtitle: 'Podane nowe hasła nie są identyczne',
			});
			app.popup.shake();
			return;
		}

		app.popup.showSpinner();
		app.socket.send('changePassword', {
			oldPassword: await app.utils.sha256(oldPasswordInput.value),
			password: await app.utils.sha256(document.getElementById('popup-input-password').value),
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
	app.spinner.hide();
	app.popup.show({
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
		app.popup.showSpinner();
		const response = await fetch('/api/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username: usernameInput.value,
				password: await app.utils.sha256(document.getElementById('popup-input-password').value),
			}),
		});

		let error = 'Nieznany błąd. Spróbuj ponownie później';
		if (response.status === 200 || response.status === 400) {
			const data = await response.json();
			if (data.message === 'invalidLogin') {
				error = 'Niepoprawny login lub hasło';
			} else if (data.message === 'success') {
				localStorage.setItem('token', data.token);
				app.main();
				return;
			}
		} else if (response.status === 429) {
			error = 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie później';
		}

		app.popup.setSubtitle({
			subtitle: error,
		});
		app.popup.shake();
		app.popup.hideSpinner();
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
	app.spinner.hide();
	let registrationInProgress = false;
	const popupCaptchaHTML = '<div id="popup-captcha" class="popup-button" style="background-color: var(--border); margin-bottom: 20px;">Nie jestem robotem</div>';
	app.popup.show({
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
				app.popup.setSubtitle({
					subtitle: 'Zbyt wiele nieudanych prób rozwiązania CAPTCHy. Spróbuj ponownie później',
				});
				app.popup.shake();
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

		if (!app.utils.verifyUsername(usernameInput.value)) {
			error = 'Nazwa użytkownika powinna mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';
		}

		const password = document.getElementById('popup-input-password').value;
		if (password !== document.getElementById('popup-input-password2').value) {
			error = 'Wpisane hasła nie są identyczne';
		}

		if (error !== '') {
			app.popup.setSubtitle({
				subtitle: error,
			});
			app.popup.shake();
			registrationInProgress = false;
			return;
		}

		app.popup.showSpinner();
		const response = await fetch('/api/register', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				username: usernameInput.value,
				password: await app.utils.sha256(password),
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
			app.popup.setSubtitle({
				subtitle: 'Zarejestrowano pomyślnie!',
				subtitleColor: 'var(--green)',
			});
			setTimeout(() => {
				loginHandler();
			}, 1000);
		} else {
			app.popup.hideSpinner();
			app.popup.setSubtitle({
				subtitle: error,
			});
			app.popup.shake();
			registrationInProgress = false;
		}
	};

	document.getElementById('popup-button-register').onclick = registerFormHandler;

	document.getElementById('popup-button-login').onclick = () => {
		loginHandler();
	};

	usernameInput.focus();
};

app.main();
