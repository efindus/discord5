/**
 * @type {import('../types').getElementById}
 */
const getElementP = (id, type, isNullable) => {
	const res = /** @type {any} */ (document.getElementById(id));
	if (!isNullable && !res)
		throw new Error(`Element with id: ${id} is missing!`);

	return res;
};

const getElement = {
	div: (/** @type {string} */ id) => getElementP(id, 'div', false),
	input: (/** @type {string} */ id) => getElementP(id, 'input', false),
	br: (/** @type {string} */ id) => getElementP(id, 'br', false),
};

class ApiManager {
	#app;

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
	}

	/**
	 * @param {string} path
	 * @param {RequestInit} options
	 * @returns {Promise<any>}
	 */
	async #makeRequest(path, options = {}) {
		/** @type {Response} */
		let response;
		let result;

		try {
			response = await fetch(path, options);

			if (response.headers.get('content-type') === 'application/json')
				result = await response.json();
		} catch {
			throw new Error('serverError');
		}

		if (response.status !== 200) {
			if (typeof result?.message === 'string')
				throw new Error(result.message);

			throw { message: response.status.toString(), retryAfter: response.status === 429 ? response.headers.get('retry-after') : null };
		}

		return result;
	}

	/**
	 * @param {string} username
	 * @param {string} password
	 * @returns {Promise<'success' | 'invalidLogin' | '429' | 'serverError'>}
	 */
	async login(username, password) {
		try {
			return (await this.#makeRequest('/api/login', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					username,
					password,
				}),
			})).message;
		} catch (err) {
			return /** @type {any} */ (err).message;
		}
	}

	/**
	 * @param {string} username
	 * @param {string} password
	 * @param {any} captcha
	 * @returns {Promise<'success' | 'usernameAlreadyInUse' | 'invalidSolution' | 'captchaExpired' | '400' | '418' | '429' | 'serverError'>}
	 */
	async register(username, password, captcha) {
		try {
			return (await this.#makeRequest('/api/register', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					username,
					password,
					captcha,
				}),
			})).message;
		} catch (err) {
			return /** @type {any} */ (err).message;
		}
	}

	async getCaptcha() {
		try {
			return await this.#makeRequest('/api/captcha', {
				method: 'POST',
			});
		} catch (err) {
			return /** @type {any} */ (err).message;
		}
	}

	/**
	 * @returns {Promise<({ uid: string } & UserData)?>}
	 */
	async getMe() {
		try {
			return await this.#makeRequest('/api/me');
		} catch (err) {
			if (/** @type {Error} */ (err).message === 'serverError')
				throw new Error();

			return null;
		}
	}

	/**
	 * @param {number} limit
	 * @param {string | undefined} before
	 * @param {string | undefined} after
	 * @returns {Promise<MessageData[]>}
	 */
	async getMessages(limit, before = undefined, after = undefined) {
		const params = new URLSearchParams({ limit: `${limit}` });
		if (before)
			params.set('before', before);

		if (after)
			params.set('after', after);

		try {
			return await this.#makeRequest(`/api/messages?${params.toString()}`);
		} catch (err) {
			throw new Error();
		}
	}

	/**
	 * @param {string} message
	 * @param {string} nonce
	 * @param {{ fileName: string, data: string } | undefined} attachment
	 * @returns {Promise<'success' | 'invalidAttachment' | { message: 'attachmentLimit' | 'newlineLimit' | '429', retryAfter: string }>}
	 */
	async sendMessage(message, nonce, attachment = undefined) {
		try {
			const reqBody = JSON.stringify({
				message,
				nonce,
				attachment,
			});

			if (attachment) {
				return await new Promise((resolve, reject) => {
					const req = new XMLHttpRequest(), srvrError = new Error('serverError');
					this.#app.elements.progressBar.classList.remove('loading');
					this.#app.elements.progressBar.style.width = '0%';
					setTimeout(() => {
						this.#app.elements.progressBar.classList.add('loading');
					});

					let uploadSuccess = false;
					req.upload.addEventListener('load', (ev) => {
						uploadSuccess = true;
					});

					req.upload.addEventListener('timeout', (ev) => {
						this.#app.elements.progressBar.style.width = '0%';
						reject(srvrError);
					});

					req.upload.addEventListener('progress', (ev) => {
						const progress = ev.loaded / ev.total * 100;
						this.#app.elements.progressBar.style.width = `${progress}%`;
					});

					req.upload.addEventListener('loadend', (ev) => {
						this.#app.elements.progressBar.style.width = '0%';
						if (uploadSuccess) {
							this.#app.elements.progressBar.classList.remove('loading');
							return;
						}

						reject(srvrError);
					});

					let downloadSuccess = false;
					req.addEventListener('load', (ev) => {
						downloadSuccess = true;

						const result = JSON.parse(req.responseText);
						if (req.status !== 200) {
							let message = req.status.toString();
							if (typeof result?.message === 'string')
								message = result.message;

							if (req.status === 429)
								reject({ message, retryAfter: req.getResponseHeader('retry-after') });
							else
								reject(new Error(message));
						} else {
							resolve(result.message);
						}
					});

					req.addEventListener('timeout', (ev) => {
						reject(srvrError);
					});

					req.addEventListener('loadend', (ev) => {
						if (downloadSuccess)
							return;

						reject(srvrError);
					});

					req.open('POST', '/api/messages');
					req.setRequestHeader('content-type', 'application/json');
					req.send(reqBody);
				});
			} else {
				return (await this.#makeRequest('/api/messages', {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
					},
					body: reqBody,
				})).message;
			}
		} catch (err) {
			return /** @type {any} */ (err);
		}
	}

	/**
	 * @param {string} currentPassword
	 * @param {string} password
	 * @returns {Promise<'success' | 'invalidLogin' | '429'>}
	 */
	async changePassword(currentPassword, password) {
		try {
			return (await this.#makeRequest('/api/user/password', {
				method: 'PUT',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					currentPassword,
					password,
				}),
			})).message;
		} catch (err) {
			return /** @type {any} */ (err).message;
		}
	}

	/**
	 * @param {string} nickname
	 * @returns {Promise<'success' | 'usernameInvalidLength' | 'usernameInvalidFormat' | '429'>}
	 */
	async changeNickname(nickname) {
		try {
			return (await this.#makeRequest('/api/user/nickname', {
				method: 'PUT',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					nickname,
				}),
			})).message;
		} catch (err) {
			return /** @type {any} */ (err).message;
		}
	}

	/**
	 * @param {string} uid
	 * @returns {Promise<UserData?>}
	 */
	async getUser(uid) {
		try {
			return await this.#makeRequest(`/api/users/${uid}`);
		} catch (err) {
			const x = /** @type {any} */ (err);
			if (x.message === '429' && x.retryAfter !== null) {
				const retryAfter = +x.retryAfter;
				return await new Promise((resolve) => {
					setTimeout(() => {
						resolve(this.getUser(uid));
					}, retryAfter * 1000 + 50);
				});
			}

			throw new Error();
		}
	}

	async logOut() {
		try {
			await this.#makeRequest('/api/log-out', { method: 'POST' });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * @returns {Promise<boolean>}
	 */
	async logOutEverywhere() {
		try {
			await this.#makeRequest('/api/log-out-everywhere', { method: 'POST' });
			return true;
		} catch {
			return false;
		}
	}
}

class SocketManager {
	#app;

	/**
	 * @type {WebSocket | undefined}
	 */
	#socket = undefined;
	/**
	 * @type {NodeJS.Timeout | undefined}
	 */
	#pinger = undefined;

	#reconnect = true;
	#protocolVersion = '1';

	/**
	 * @param {boolean} newVal
	 */
	set reconnect(newVal) {
		this.#reconnect = newVal;
	}

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
	}

	async connect() {
		this.#reconnect = true;

		this.#app.spinner.show();
		this.#app.popup.hide();

		try {
			this.#app.user = await this.#app.api.getMe();
			if (this.#app.user === null) {
				loginHandler();
				return;
			}
		} catch {
			this.#onClose();
			return;
		}

		this.#socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/api/gateway`);

		this.#socket.addEventListener('open', () => this.#setupPinger());
		this.#socket.addEventListener('message', (event) => this.#onMessage(event));
		this.#socket.addEventListener('close', () => this.#onClose());
	}

	disconnect() {
		this.#reconnect = false;
		this.#socket?.close();
	}

	#setupPinger() {
		this.#pinger = setInterval(() => {
			this.#socket?.send('ping');
		}, 50_000);
	}

	#onClose() {
		clearInterval(this.#pinger);
		this.#app.messages.clear();

		if (this.#reconnect) {
			this.#app.spinner.show();
			setTimeout(() => this.connect(), 2500);
		}
	}

	/**
	 * @param {MessageEvent<any>} event
	 */
	async #onMessage(event) {
		if (!this.#app.user)
			return;

		const data = JSON.parse(event.data);
		if (data.packet === 'ready') {
			if (this.#protocolVersion !== data.protocolVersion)
				window.location.reload();

			this.#app.messagesToLoad = data.messagesToLoad;
			this.#app.maxMessageLength = data.maxMessageLength;
			this.#app.timeOffset = Date.now() - data.serverTime;

			this.#app.propagateUserData();
			this.#app.messages.load();
		} else if (data.packet === 'newMessage') {
			if (data.nonce)
				getElementP(data.nonce, 'div', true)?.remove();

			this.#app.messages.insert({
				msgData: data,
				isNew: true,
			});
		} else if (data.packet === 'updateUser') {
			if (data.uid === this.#app.user.uid) {
				this.#app.user = {
					...this.#app.user,
					...data,
				};

				this.#app.propagateUserData();
			}

			this.#app.users[data.uid] = {
				username: data.username,
				nickname: data.nickname,
				type: data.type,
			};

			this.#app.messages.updateNickname(data.uid);
		} else if (data.packet === 'reload') {
			window.location.reload();
		} else if (data.packet === 'clientsOnline') {
			this.#app.elements.onlineSidebar.innerHTML = '';
			for (const client of data.clients) {
				this.#app.getMissingUserData(client);
				this.#app.elements.onlineSidebar.innerHTML += `<div class="online-entry" id="online-${client}" ${this.#app.utils.generateUsernameTooltip(client, true)}>${this.#app.users[client].nickname}</div>`;
			}
		}
	}
}

class PopupManager {
	#elements = {
		container: getElement.div('popup-container'),
		popup: getElement.div('popup'),
		popupClose: getElement.div('popup-close'),
		header: getElement.div('popup-header'),
		title: getElement.div('popup-title'),
		subtitle: getElement.div('popup-subtitle'),
		body: getElement.div('popup-body'),
		footer: getElement.div('popup-footer'),
		spinner: getElement.div('popup-spinner'),
	};

	#isOpen = false;
	#isCloseable = false;

	constructor() {
		this.#elements.popup.addEventListener('animationend', () => {
			this.#elements.popup.classList.remove('shaking');
		});

		this.#elements.popupClose.addEventListener('click', () => this.hide());
		document.addEventListener('keydown', (event) => {
			if (event.code === 'Escape' && this.#isCloseable)
				this.hide();
		});
	}

	get isOpen() {
		return this.#isOpen;
	}

	get isCloseable() {
		return this.#isCloseable;
	}

	/**
	 * @typedef SubtitleData
	 * @property {string} subtitle
	 * @property {string} subtitleColor
	 */

	/**
	 * @typedef PopupData
	 * @property {string} title
	 * @property {boolean} isTranslucent
	 * @property {boolean} closeable
	 * @property {({ label: string, input: { id: string, type: string } & { limit?: number } } | { html: string })[]} body
	 * @property {({ label: string, id: string } & { color?: string })[]} footer
	 */

	/**
	 * Create a modal
	 * @param {{ title: string } & Partial<PopupData> & Partial<SubtitleData>} data Parameters used to construct the modal
	 */
	create(data) {
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

		if (data.isTranslucent)
			this.#elements.container.style.backgroundColor = 'var(--background-translucent)';
		else
			this.#elements.container.style.backgroundColor = 'var(--background-secondary)';

		this.#elements.body.innerHTML = '';
		if (data.body) {
			this.#elements.header.style.margin = '';
			this.#elements.title.style.margin = '';
			for (const row of data.body) {
				const rowElement = document.createElement('div');
				rowElement.classList.add('popup-row');
				if ('input' in row)
					rowElement.innerHTML = `<div class="popup-row-label">${row.label}</div><input id="${row.input.id}" class="popup-row-input" type="${row.input.type}" ${row.input.limit ? ` maxlength="${row.input.limit}"` : ''}>`;
				else
					rowElement.innerHTML = row.html;

				this.#elements.body.appendChild(rowElement);
			}

			/** @type {HTMLDivElement} */ (this.#elements.body.lastChild).style.marginBottom = '0px';
		} else {
			this.#elements.header.style.margin = '0px';
			this.#elements.title.style.margin = '0px';
		}

		this.#elements.footer.innerHTML = '';
		if (data.footer) {
			this.#elements.body.style.marginBottom = '15px';
			for (const button of data.footer) {
				const buttonElement = document.createElement('div');
				buttonElement.classList.add('popup-button');
				buttonElement.id = button.id;
				buttonElement.innerHTML = button.label;
				buttonElement.style.backgroundColor = button.color ?? 'var(--blue)';
				this.#elements.footer.appendChild(buttonElement);
			}
			/** @type {HTMLDivElement} */ (this.#elements.footer.lastChild).style.marginBottom = '0px';
		}
	}

	/**
	 * Set the subtitle
	 * @param {Partial<SubtitleData>} data - Empty to hide; default color: var(--orange)
	 */
	setSubtitle(data) {
		if (data.subtitle && data.subtitle.length > 0) {
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
		container: getElement.div('tooltip-container'),
		tooltip: getElement.div('tooltip'),
	};

	#isOpen = false;

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
		this.#elements.container.addEventListener('click', () => this.hide());
		this.#elements.tooltip.addEventListener('click', (event) => event.stopPropagation());
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
		spinner: getElement.div('spinner'),
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
	#app;
	#elements = {
		usernameContainer: getElement.div('username-container'),
		dropdown: getElement.div('dropdown'),
		dropdownClose: getElement.div('dropdown-close'),
	};

	#isOpen = false;

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;
		this.#elements.usernameContainer.addEventListener('click', () => this.toggle());
		this.#elements.dropdownClose.addEventListener('click', () => this.toggle());
		this.#app.elements.userData.addEventListener('click', (event) => event.stopPropagation());
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
		if (!this.#isOpen)
			this.show();
		else
			this.hide();
	}
}

class NotificationManager {
	/**
	 * @type {Notification[]}
	 */
	#notifications = [];

	/**
	 * @param {App} app
	 */
	constructor(app) {
		document.addEventListener('focus', () => {
			for (const notification of this.#notifications)
				notification.close();

			this.#notifications = [];
		});

		app.elements.messageContainer.addEventListener('scroll', () => {
			if (Notification.permission === 'default')
				Notification.requestPermission();
		});
	}

	/**
	 * Create a new notification
	 * @param {object} data
	 * @param {string} data.title
	 * @param {string} data.body
	 */
	create(data) {
		if (Notification.permission !== 'granted')
			return;

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
		/**
		 * @param {MessageData} msgData
		 * @param {boolean} isContinuation
		 */
		generateMessageMeta: (msgData, isContinuation) => {
			if (isContinuation)
				return '';

			const messageAuthor = `<span class="message-username" ${this.#app.utils.generateUsernameTooltip(msgData.uid)}>${this.#app.users[msgData.uid].nickname}</span>`;
			const messageDate = `<span class="message-date">${new Date(msgData.ts).toLocaleString('pl')}</span>`;
			let messageFor = '';
			if (msgData.originalAuthor)
				messageFor = `<span style="margin-right: 4px;">dla</span><span class="message-username" ${this.#app.utils.generateUsernameTooltip(msgData.originalAuthor)}>${this.#app.users[msgData.originalAuthor].nickname}</span>`;

			return `<div class="message-meta">${messageAuthor}${messageFor}${messageDate}</div>`;
		},
		/**
		 * @param {MessageData} msgData
		 * @param {boolean} isContinuation
		 */
		generateMessageContent: (msgData, isContinuation) => {
			const messageContent = this.#app.utils.markdownToHTML(msgData.message).split('\n').join('<br>');

			return `<div class="message-content" ${isContinuation ? this.#app.utils.generateDateTooltip(msgData.ts) : ''}>${messageContent}</div>`;
		},
		/**
		 * @param {MessageData} msgData
		 * @param {boolean} isNew
		 */
		generateMessageAttachment: (msgData, isNew) => {
			if (!msgData.attachment)
				return '';

			let messageAttachment = `<a class="message-attachment-name" href="/attachments/${msgData.id}/${msgData.attachment}" target="_blank">${msgData.attachment}</a>`;
			if (msgData.attachment && (
				msgData.attachment.endsWith('.png') ||
				msgData.attachment.endsWith('.jpg') ||
				msgData.attachment.endsWith('.jpeg') ||
				msgData.attachment.endsWith('.gif') ||
				msgData.attachment.endsWith('.webp')
			)) {
				messageAttachment = `<img src="/attachments/${msgData.id}/${msgData.attachment}" onload="app.onAttachmentLoad(this, ${isNew ?? false})" onerror="this.remove()"><div>${messageAttachment}</div>`;
			}

			return `<div class="message-attachment message-attachment-file">${messageAttachment}</div>`;
		},
		/**
		 * @param {MessageData | undefined} lastMessage
		 * @param {MessageData} newMessage
		 */
		messageJoinCheck: (lastMessage, newMessage) => {
			let isJoined = (lastMessage?.uid === newMessage.uid);

			if (isJoined && lastMessage) {
				if (lastMessage.originalAuthor !== newMessage.originalAuthor)
					isJoined = false;

				if (lastMessage.attachment)
					isJoined = false;

				if (newMessage.ts - (8 * 60_000) > lastMessage.ts)
					isJoined = false;
			}

			return isJoined;
		},
	};

	#elements = {
		messages: getElement.div('messages'),
		loadMessagesButton: getElement.div('load-messages-button'),

		input: getElement.input('input'),
		uploadInput: getElement.input('upload-input'),
		uploadButton: getElement.input('upload-button'),
		uploadButtonIcon: getElement.div('upload-button-icon'),
	};

	/**
	 * @type {MessageData[]}
	 */
	#messageQueue = [];

	/**
	 * @type {MessageData[]}
	 */
	#messages = [];
	/**
	 * @type {string?}
	 */
	#currentAttachment = null;

	get count() {
		return this.#messages.length;
	}

	/**
	 * @param {App} app
	 */
	constructor(app) {
		this.#app = app;

		document.addEventListener('keydown', (event) => {
			if ((event.code.startsWith('Key') || event.code === 'Space') &&
				document.activeElement === document.body &&
				!this.#app.popup.isOpen &&
				!this.#app.dropdown.isOpen &&
				!this.#app.spinner.isOpen &&
				!this.#app.tooltip.isOpen &&
				!event.ctrlKey
			) {
				this.#elements.input.focus();
			}
		});

		this.#elements.loadMessagesButton.addEventListener('click', () => app.messages.load());
		this.#elements.input.addEventListener('keydown', async (event) => {
			if (!this.#app.user)
				return;

			if ((event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
				event.preventDefault();

				let value = this.#elements.input.innerText.trim();

				if (value === '/tableflip')
					value = '(╯°□°）╯︵ ┻━┻';
				else if (value === '/unflip')
					value = '┬─┬ ノ( ゜-゜ノ)';
				else if (value === '/shrug')
					value = '¯\\\\_(ツ)_/¯';

				if (value.length > 0 && value.length <= this.#app.maxMessageLength) {
					this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight);
					this.#elements.input.innerHTML = '<br id="input-last-br">';

					let attachment = undefined;
					if (this.#currentAttachment && this.#elements.uploadInput.files) {
						attachment = {
							fileName: this.#elements.uploadInput.files[0].name,
							data: this.#currentAttachment,
						};

						this.resetUpload();
					}

					const nonce = `${Date.now()}-99${crypto.randomUUID ? crypto.randomUUID() : Math.random()}`;
					this.queueMessage({
						id: nonce,
						ts: Date.now() - this.#app.timeOffset,
						uid: this.#app.user.uid,
						message: value,
						rawAttachment: attachment,
						nonce,
					});
				}
			} else if (this.#elements.input.innerText.length >= this.#app.maxMessageLength &&
				!(event.code.startsWith('Arrow') || event.code.startsWith('Delete') || event.code.startsWith('Backspace')) &&
				(window.getSelection()?.rangeCount && window.getSelection()?.getRangeAt(0).collapsed) &&
				!event.ctrlKey
			) {
				event.preventDefault();
			}
		});

		this.#elements.input.addEventListener('keyup', (event) => {
			const x = this.#elements.input?.lastChild;
			if (x?.nodeName === 'BR' && (x instanceof HTMLBRElement) && x.id !== 'input-last-br')
				x.id = 'input-last-br';

			const br = getElementP('input-last-br', 'br', true);
			if (br?.previousSibling?.nodeName === 'BR')
				this.#elements.input.insertBefore(document.createTextNode(''), br);
		});

		this.#elements.input.addEventListener('paste', (event) => {
			event.preventDefault();
			const paste = event.clipboardData?.getData('text');
			let limit = this.#app.maxMessageLength;

			const selection = window.getSelection();
			if (!selection?.rangeCount || !paste)
				return;

			selection.deleteFromDocument();
			if (this.#elements.input.innerHTML === '')
				this.#elements.input.innerHTML = '<br id="input-last-br">';

			if (this.#elements.input.innerText.length + paste.length > this.#app.maxMessageLength)
				limit = this.#app.maxMessageLength - this.#elements.input.innerText.length;

			let lastNode = null;
			if (limit > 0) {
				const input = paste.substring(0, limit).split('\n');
				let i = 0;
				for (const frag of input) {
					if (frag.length > 0) {
						const textElement = document.createElement('span');
						textElement.append(frag);

						lastNode = textElement;
						selection.getRangeAt(0).insertNode(textElement);
						selection.collapseToEnd();
					}

					i++;
					if (i < input.length) {
						const nl = document.createElement('br');

						lastNode = nl;
						selection.getRangeAt(0).insertNode(nl);
						selection.collapseToEnd();
					}
				}
			}

			lastNode?.scrollIntoView({
				block: 'end',
			});

			const br = getElementP('input-last-br', 'br', true);
			if (br !== this.#elements.input?.lastChild) {
				br?.remove();
				const x = this.#elements.input.appendChild(document.createElement('br'));
				x.id = 'input-last-br';
			}
		});

		this.#elements.uploadInput.addEventListener('change', () => {
			if (this.#elements.uploadInput.value !== '' && this.#elements.uploadInput.files) {
				if (this.#elements.uploadInput.files[0].name.length >= 250 || this.#elements.uploadInput.files[0].name.includes('/')) {
					app.showRatelimitModal('Hola, hola! Nie nadążam', 'Wybrany przez Ciebie załącznik ma zbyt długą nazwę (lub zawiera ona znak "/")!');
					this.#elements.uploadInput.value = '';
				} else if (this.#elements.uploadInput.files[0].size <= 11_160_000) {
					this.#elements.uploadButtonIcon.style.transform = 'rotate(45deg)';

					const reader = new FileReader();
					reader.addEventListener('load', (event) => {
						if (!event.target?.result || !(event.target.result instanceof ArrayBuffer))
							return;

						this.#currentAttachment = this.#app.utils.fromArrayBufferToBase64(event.target.result);
					});

					reader.readAsArrayBuffer(this.#elements.uploadInput.files[0]);
				} else {
					app.showRatelimitModal('Hola, hola! Nie za dużo?', 'Wybrany przez Ciebie załącznik jest zbyt potężny!');
					this.#elements.uploadInput.value = '';
				}
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

	/**
	 * @param {MessageData} msgData
	 * @param {boolean} isContinuation
	 * @param {boolean} isShadow
	 * @param {boolean} isNew
	 */
	#generateMessage(msgData, isContinuation = false, isShadow = false, isNew = false) {
		const message = document.createElement('div');
		message.id = msgData.id;
		message.classList.add('message');
		if (isShadow) {
			message.classList.add('message-shadow');
			isContinuation = false;
		}

		message.innerHTML = `${this.#utils.generateMessageMeta(msgData, isContinuation)}${this.#utils.generateMessageContent(msgData, isContinuation)}${this.#utils.generateMessageAttachment(msgData, isNew)}${isShadow ? `<div onclick="app.removeQueuedMessage('${msgData.id}')">×</div>` : ''}`;
		return message;
	}

	/**
	 * @param {number} timestamp
	 */
	#generateDaySeparator(timestamp) {
		const separator = document.createElement('div');
		separator.classList.add('day-separator');
		separator.innerHTML = `<span class="day-separator-text">${(new Date(timestamp)).toLocaleDateString('pl')}</span>`;
		return separator;
	}

	/**
	 * @typedef MessageData
	 * @type {{ id: string, ts: number, message: string, uid: string } & Partial<{ originalAuthor: string, attachment: string, nonce: string, rawAttachment: { fileName: string, data: string } }>}
	 */

	/**
	 * Insert a message into the website
	 * @param {{
	 * 	msgData: MessageData,
	 * } & Partial<{
	 * 	msgIndex: number,
	 * 	isLastNew: boolean,
	 * 	isNew: boolean,
	 * 	continuation: boolean,
	 * 	scrollAttachment: boolean,
	 * 	isShadow: boolean,
	 * 	afterElement: Node?,
	 * 	lastMessage: MessageData
	 * }>} data
	 */
	insert(data) {
		this.#app.getMissingUserData(data.msgData.uid);
		if (data.msgData.originalAuthor)
			this.#app.getMissingUserData(data.msgData.originalAuthor);

		if (!data.isNew) {
			if (typeof data.msgIndex === 'undefined')
				throw new Error();

			if (data.msgIndex === 0) {
				this.#elements.messages.insertBefore(this.#generateMessage(data.msgData, false, false, data.scrollAttachment), this.#elements.messages.firstChild);
			} else {
				const lastMessage = this.#messages[data.msgIndex - 1], lastMessageElement = getElement.div(lastMessage.id);
				this.#app.utils.insertAfter(
					this.#elements.messages,
					this.#generateMessage(data.msgData, this.#utils.messageJoinCheck(lastMessage, data.msgData), false, data.scrollAttachment),
					lastMessageElement,
				);

				const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
				if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl'))
					this.#app.utils.insertAfter(this.#elements.messages, this.#generateDaySeparator(data.msgData.ts), lastMessageElement);
			}

			this.#messages.splice(data.msgIndex, 0, data.msgData);

			const nextMessage = this.#messages[data.msgIndex + 1];
			if (data.isLastNew && nextMessage && this.#utils.messageJoinCheck(data.msgData, nextMessage)) {
				getElement.div(nextMessage.id).remove();
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
					if (this.#messages[i].id > data.msgData.id)
						correctIndex++;
				}

				const lastMessage = this.#messages[this.#messages.length - (correctIndex + 1)];
				const nextMessage = this.#messages[this.#messages.length - correctIndex];
				const messageElement = this.#generateMessage(data.msgData, this.#utils.messageJoinCheck(lastMessage, data.msgData), data.isShadow, data.isNew);

				if (correctIndex === 0) {
					this.#app.utils.insertAfter(this.#elements.messages, messageElement, getElement.div(lastMessage.id));

					if (lastMessage && !data.isShadow) {
						const oldDate = new Date(lastMessage.ts), newDate = new Date(data.msgData.ts);
						if (oldDate.toLocaleDateString('pl') !== newDate.toLocaleDateString('pl'))
							this.#elements.messages.insertBefore(this.#generateDaySeparator(data.msgData.ts), getElement.div(data.msgData.id));
					}
				} else {
					this.#elements.messages.insertBefore(messageElement, getElement.div(nextMessage.id));

					getElement.div(nextMessage.id).remove();
					this.insert({
						msgData: nextMessage,
						isNew: true,
						lastMessage: data.msgData,
						afterElement: getElement.div(data.msgData.id),
					});
				}

				if (!data.isShadow)
					this.#messages.splice(this.#messages.length - correctIndex, 0, data.msgData);
			}

			if (!data.isShadow && !document.hasFocus()) {
				this.#app.notifications.create({
					title: 'Discord5: New Message',
					body: `${this.#app.users[data.msgData.uid].nickname}: ${data.msgData.message.slice(0, 150)}`,
				});
			}

			if (scroll)
				this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight);
		}
	}

	/**
	 * @param {MessageData} msgData
	 */
	queueMessage(msgData) {
		this.#messageQueue.push(msgData);

		this.insert({
			msgData: {
				...msgData,
				attachment: msgData.rawAttachment?.fileName,
			},
			isNew: true,
			isShadow: true,
			afterElement: this.#elements.messages.lastChild,
		});

		if (this.#messageQueue.length === 1)
			this.#processMessageQueue();
		else if (this.#messageQueue.length > 2)
			app.showRatelimitModal('Hola, hola! Nie nadążam', 'Wysyłasz wiadomości zbyt szybko!');
	}

	/**
	 * @param {string} id
	 */
	dequeueMessage(id) {
		for (let i = 0; i < this.#messageQueue.length; i++) {
			if (this.#messageQueue[i].id === id) {
				this.#messageQueue.splice(i, 1);
				break;
			}
		}
	}

	async #processMessageQueue(success = false) {
		if (success)
			this.#messageQueue.shift();

		if (!this.#messageQueue.length)
			return;

		const m = this.#messageQueue[0];
		const res = await this.#app.api.sendMessage(m.message, m.id, m.rawAttachment);
		let msg, nextAfter = 75, s = false;
		if (typeof res === 'string')
			msg = res;
		else
			msg = res.message, nextAfter = +(res.retryAfter || 0.075) * 1000;

		switch (msg) {
			case '429':
			case 'newlineLimit':
			case 'attachmentLimit':
				if (!app.popup.isOpen) {
					let title = '', subtitle;
					if (msg === '429')
						title = 'Hola, hola! Nie za szybko?', subtitle = 'Wysyłasz zbyt wiele wiadomości!';
					else if (msg === 'newlineLimit')
						title = 'Hola, hola! Nie za wiele?', subtitle = 'Wysyłasz zbyt długie wiadomości!';
					else
						title = 'Hola, hola! Nie za dużo?', subtitle = 'Wysyłasz zbyt wiele załączników!';

					app.showRatelimitModal(title, subtitle);
				}
				break;
			case 'success':
				s = true;
				break;
			default:
				break;
		}

		setTimeout(() => {
			this.#processMessageQueue(s);
		}, nextAfter);
	}

	clear() {
		this.#elements.messages.innerHTML = '';
		this.#messages = [];
		this.#messageQueue = [];
	}

	async load() {
		this.#elements.loadMessagesButton.style.display = 'none';

		let messages;
		try {
			messages = await this.#app.api.getMessages(this.#app.messagesToLoad, this.#messages[0]?.id ?? undefined);
		} catch {
			app.showRatelimitModal('Hola, hola! Nie za szybko?', 'Wczytujesz zbyt wiele wiadomości!');

			this.#app.messages.showLoadButton();
			return;
		}

		const oldHeight = this.#app.elements.messageContainer.scrollHeight;

		messages.reverse();
		for (let i = 0; i < messages.length; i++) {
			this.#app.messages.insert({
				msgData: messages[i],
				msgIndex: i,
				isLastNew: (i + 1 === messages.length),
				scrollAttachment: this.#app.messages.count < this.#app.messagesToLoad,
			});
		}

		this.#app.elements.messageContainer.scrollTo(0, this.#app.elements.messageContainer.scrollHeight - oldHeight + this.#app.elements.messageContainer.scrollTop);
		if (messages.length === this.#app.messagesToLoad)
			this.#app.messages.showLoadButton();

		if (this.#app.messages.count <= this.#app.messagesToLoad)
			this.#app.spinner.hide();
	}

	showLoadButton() {
		this.#elements.loadMessagesButton.style.display = 'table';
	}

	resetUpload() {
		this.#elements.uploadButtonIcon.style.transform = 'rotate(0deg)';
		this.#elements.uploadInput.value = '';
		this.#currentAttachment = null;
	}

	/**
	 * @param {string} uid
	 */
	updateNickname(uid) {
		for (const msg of this.#messages) {
			if (![ msg.uid, msg.originalAuthor ].includes(uid))
				continue;

			const msgMeta = getElement.div(msg.id).querySelector('.message-meta');

			if (msgMeta) {
				if (msg.uid === uid) {
					const element = msgMeta.children[0];
					if (element)
						element.innerHTML = this.#app.users[uid].nickname;
				}

				if (msg.originalAuthor === uid) {
					const element = msgMeta.children[2];
					if (element)
						element.innerHTML = this.#app.users[uid].nickname;
				}
			}
		}

		const sidebarEntry = getElementP(`online-${uid}`, 'div', true);
		if (sidebarEntry)
			sidebarEntry.innerHTML = this.#app.users[uid].nickname;
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
		std: /^(\s)*(std|cin|cout|cerr|clog|endl)$/g,
		definition: /^(\s)*(stdin|stdout|stderr|NULL)$/g,
		include: /^(\s)*#(\s)*include(\s)*<[^>]*>/g,
		preprocessor: /^(\s)*#(\s)*(ifdef|elif|ifndef|line|else|error|include|define|endif|if|undef)[^A-Za-z0-9_]/g,
		string: /^(\s)*"/g,
		stringEnd: /^(.*?[^\\](\\\\)*)?"/g,
	};

	#markdown = [ [ '**', 'b' ], [ '*', 'i' ], [ '__', 'u' ], [ '~~', 'strike' ] ];

	#mode = 'default';

	/**
	 * @param {string} text
	 * @param {string} value
	 * @param {number} position
	 */
	#isAtPosition(text, value, position) {
		for (let i = 0; i < value.length; i++) {
			if (text[position + i] !== value[i])
				return false;
		}

		return true;
	}

	/**
	 * @param {string} text
	 * @returns {string}
	 */
	#highlightPart(text) {
		if (text.length === 0)
			return '';

		let x;
		if (this.#mode === 'comment') {
			const end = text.indexOf('*/');

			if (end === -1) {
				return `<span class='comment'>${text}</span>`;
			} else {
				this.#mode = 'default';
				return `<span class='comment'>${text.slice(0, end + 2)}</span>${this.#highlightPart(text.slice(end + 2))}`;
			}
		} else if ((x = text.match(this.#expressions.multilineComment)) !== null) {
			const match = x[0];
			this.#mode = 'comment';

			return `<span class='comment'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
		} else if (text.match(this.#expressions.comment) !== null) {
			return `<span class='comment'>${text}</span>`;
		} else if ((x = text.match(this.#expressions.include)) !== null) {
			const match = x[0];
			const index = match.indexOf('<');

			return `<span class='preprocessor'>${text.slice(0, index)}</span><span class='string-special'>&lt;</span><span class='string'>${text.slice(index + 1, match.length - 1)}</span><span class='string-special'>></span>${this.#highlightPart(text.slice(match.length))}`;
		} else if ((x = text.match(this.#expressions.preprocessor)) !== null) {
			const match = x[0];
			return `<span class='preprocessor'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
		} else if ((x = text.match(this.#expressions.string)) !== null) {
			const match = x[0];
			const end = text.slice(match.length).match(this.#expressions.stringEnd);

			if (end === null)
				return `<span class='string'>${this.sanitizeText(text)}</span>`;
			else
				return `<span class='string'>${this.sanitizeText(match + end[0])}</span>${this.#highlightPart(text.slice(end[0].length + match.length))}`;
		} else {
			// @ts-ignore
			let match = text.match(this.#expressions.split)[0];

			if (match.length > 1)
				match = match.slice(0, match.length - 1);

			if (match.match(this.#expressions.keyword) !== null) {
				return `<span class='keyword'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.instruction) !== null) {
				return `<span class='instruction'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.operator) !== null) {
				return `<span class='operator'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.number) !== null) {
				return `<span class='number'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if ((x = text.match(this.#expressions.function)) !== null) {
				let match2 = x[0];
				match2 = match2.slice(0, match2.length - 1);

				return `<span class='function'>${this.sanitizeText(match2)}</span>${this.#highlightPart(text.slice(match2.length))}`;
			} else if (match.match(this.#expressions.definition) !== null) {
				return `<span class='definition'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.std) !== null) {
				return `<span class='std'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else if (match.match(this.#expressions.builtIn) !== null) {
				return `<span class='builtin'>${this.sanitizeText(match)}</span>${this.#highlightPart(text.slice(match.length))}`;
			} else {
				return `<span class='other'>${this.sanitizeText(match)}</span>${(text.length > match.length ? this.#highlightPart(text.slice(match.length)) : '')}`;
			}
		}
	}

	/**
	 * @param {string} text
	 */
	#highlight(text) {
		if (text.startsWith('\n')) text = text.slice(1);
		if (text.endsWith('\n')) text = text.slice(0, -1);

		let result = '';
		const lines = text.split('\n');

		this.#mode = 'default';

		// TODO: maybe remove this
		for (let i = 0; i < lines.length; i++)
			result += `<div class="code-line"><div class="code-line-number">${i + 1}</div><div class="code-line-content">${this.#highlightPart(`${lines[i]}\u200B`)}</div></div>`;

		return `<div class="code-snippet">${result}</div>`;
	}

	/**
	 * @param {string} text
	 * @param {string} value
	 * @param {number} position
	 */
	#findNext(text, value, position) {
		let cancel = false;

		for (let i = position; i < text.length; i++) {
			if (cancel)
				cancel = false;
			else if (text[i] === '\\')
				cancel = true;
			else if (this.#isAtPosition(text, value, i))
				return i;
		}

		return -1;
	}

	/**
	 * @param {string} text
	 */
	markdownToHTML(text) {
		text = text.split('\r').join('');
		let result = '';
		let cancel = false;

		for (let i = 0; i < text.length; i++) {
			if (cancel) {
				if (text[i] !== '*' && text[i] !== '\\' && text[i] !== '_' && text[i] !== '~')
					result += '\\';

				result += this.sanitizeText(text[i]);
				cancel = false;
			} else if (text[i] === '\\') {
				cancel = true;
			} else if (this.#isAtPosition(text, '```', i)) {
				const end = text.indexOf('```', i + 3);

				if (end !== -1) {
					result += this.#highlight(text.slice(i + 3, end));
					i = end + 2;
				} else {
					result += this.sanitizeText(text[i]);
				}
			} else {
				let activated = false;

				for (let position = 0; position < this.#markdown.length; position++) {
					if (this.#isAtPosition(text, this.#markdown[position][0], i)) {
						let next = this.#findNext(text, this.#markdown[position][0], i + this.#markdown[position][0].length);

						if (next !== -1) {
							if (text.slice(i + this.#markdown[position][0].length, next).trim().length === 0)
								next = this.#findNext(text, this.#markdown[position][0], next + 1);

							if (next !== -1) {
								result += `<${this.#markdown[position][1]}>${this.markdownToHTML(text.slice(i + this.#markdown[position][0].length, next))}</${this.#markdown[position][1]}>`;
								activated = true;
								i = next + this.#markdown[position][0].length - 1;

								break;
							}
						}
					}
				}

				if (!activated)
					result += this.sanitizeText(text[i]);
			}
		}

		return result;
	}

	/**
	 * @param {string} message
	 */
	async sha256(message) {
		const msgBuffer = new TextEncoder().encode(message);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex;
	}

	/**
	 * @param {ArrayBuffer} arrayBuffer
	 */
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

	/**
	 * @param {Element} element
	 */
	getElementPosition(element, noOffset = false) {
		const rect = element.getBoundingClientRect();

		let bottom = rect.bottom + window.scrollY, right = rect.right + window.scrollX;
		if (!noOffset)
			bottom = document.documentElement.clientHeight - bottom, right = document.documentElement.clientWidth - right;

		return {
			top: rect.top + window.scrollY,
			left: rect.left + window.scrollX,
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
		if (!referenceChild.nextSibling)
			parent.appendChild(newNode);
		else
			parent.insertBefore(newNode, referenceChild.nextSibling);
	}

	/**
	 * @param {string} username
	 */
	verifyUsername(username) {
		if (username.length < 3 || username.length > 32 || !/^[A-Za-z0-9\-_]*$/.test(username))
			return false;
		else
			return true;
	}

	/**
	 * @param {string} text
	 */
	sanitizeText(text) {
		text = text.split('&').join('&amp;');
		text = text.split('<').join('&lt;');
		return text;
	}

	/**
	 * @param {string} uid
	 */
	generateUsernameTooltip(uid, isSidebar = false) {
		return `onclick="app.showUsernameTooltip(this, '${uid}', ${isSidebar})"`;
	}

	/**
	 * @param {number} timestamp
	 */
	generateDateTooltip(timestamp) {
		return `ondblclick="app.showDateTooltip(this, ${timestamp})"`;
	}
}

class App {
	api;
	socket;
	popup;
	tooltip;
	spinner;
	dropdown;
	notifications;
	messages;
	utils;

	/**
	 * @typedef UserData
	 * @type {{ username: string, nickname: string, type: 'normal' | 'admin' }}
	 */

	/**
	 * @type {{ uid: string } & UserData | null}
	 */
	user = null;
	/**
	 * @type {Record<string, UserData>}
	 */
	users = {};

	timeOffset = 0;
	messagesToLoad = 100;
	maxMessageLength = 2000;

	elements = {
		progressBar: getElement.div('progress-bar'),

		onlineSidebar: getElement.div('online-sidebar'),

		usernameDisplay: getElement.div('username-display'),
		userData: getElement.div('user-data'),

		messageContainer: getElement.div('message-container'),

		clock: getElement.div('clock'),
	};

	constructor() {
		this.api = new ApiManager(this);
		this.socket = new SocketManager(this);
		this.popup = new PopupManager();
		this.tooltip = new TooltipManager(this);
		this.spinner = new SpinnerManager();
		this.dropdown = new DropdownManager(this);
		this.notifications = new NotificationManager(this);
		this.messages = new MessageManager(this);
		this.utils = new Utils();

		// Precache fonts to avoid issues
		const fonts = document.fonts.values();
		let font = fonts.next();
		while (!font.done) {
			font.value.load();
			font = fonts.next();
		}

		this.#updateClock();
	}

	async main() {
		if (location.href !== '/')
			history.replaceState({}, '', '/');

		this.socket.connect();
	}

	#updateClock() {
		const NOW = new Date(Date.now() - this.timeOffset);
		this.elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
		setTimeout(() => this.#updateClock(), 1000 - ((Date.now() - this.timeOffset) % 1000) + 10);
	}

	/**
	 * @param {HTMLImageElement} element
	 * @param {boolean} isNew
	 */
	onAttachmentLoad(element, isNew) {
		element.parentElement?.classList.remove('message-attachment-file');
		element.nextElementSibling?.remove();

		if (isNew)
			this.elements.messageContainer.scrollTop = this.elements.messageContainer.scrollTop + element.height;
	}

	/**
	 * @param {HTMLDivElement | HTMLSpanElement} element
	 * @param {string} uid
	 */
	showUsernameTooltip(element, uid, isSidebar = false) {
		const position = this.utils.getElementPosition(element, true);
		this.tooltip.show({
			x: isSidebar ? position.left - 10 : position.right + 10,
			y: position.top + ((position.bottom - position.top) / 2),
			side: isSidebar ? 'right' : 'left',
			content: `<div class="user-username-row"><span>${this.users[uid].username}</span>${this.users[uid].type === 'admin' ? '<span class="user-type">admin</span>' : ''}</div>ID: ${uid}`,
			withArrow: true,
		});
	}

	/**
	 * @param {HTMLDivElement} element
	 * @param {number} timestamp
	 */
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

	propagateUserData() {
		if (!this.user)
			return;

		this.elements.usernameDisplay.innerText = this.user.username;
		this.elements.userData.innerHTML = `ID: ${this.user.uid}<br>Pseudonim: ${this.user.nickname}${this.user.type === 'admin' ? '<br>Administrator' : ''}`;
	}

	/**
	 * @param {string} uid
	 */
	getMissingUserData(uid) {
		if (!this.users[uid]) {
			this.users[uid] = {
				username: 'Ładowanie...',
				nickname: 'Ładowanie...',
				type: 'normal',
			};

			this.api.getUser(uid).then(res => {
				if (res) {
					this.users[uid] = res;
					this.messages.updateNickname(uid);
				}
			});
		}
	}

	/**
	 * @param {string} title
	 * @param {string} subtitle
	 */
	showRatelimitModal(title, subtitle) {
		if (!app.popup.isOpen) {
			app.popup.create({
				title,
				subtitle,
				subtitleColor: 'var(--text-primary)',
				isTranslucent: true,
				footer: [
					{
						id: 'ratelimit-modal-close',
						label: 'Wrzuć na luz',
					},
				],
			});

			/** @type {HTMLInputElement} */(document.activeElement)?.blur();
			getElement.div('ratelimit-modal-close').addEventListener('click', () => app.popup.hide());
		}
	}

	/**
	 * @param {string} id
	 */
	removeQueuedMessage(id) {
		getElementP(id, 'div', true)?.remove();
		this.messages.dequeueMessage(id);
	}
}

const app = new App();

const logOutEverywhereHandler = async () => {
	app.spinner.show();
	if (!(await app.api.logOutEverywhere())) {
		app.spinner.hide();
		app.showRatelimitModal('Hola, hola! Nie za dużo?', 'Wylogowywujesz się zbyt wiele razy!<br>Bez specjalnej potrzeby używaj zwykłego wylogowywania.');
	}
};

const logOutHandler = async () => {
	app.spinner.show();
	app.socket.disconnect();
	if (await app.api.logOut()) {
		app.main();
	} else {
		app.spinner.hide();
		app.popup.create({
			title: 'Coś poszło nie tak...',
			subtitle: 'Serwis jest chwilowo niedostępny. Spróbuj ponownie później.<br>Jeżeli chcesz wylogować się ręcznie, usuń ciasteczka i dane strony.',
			subtitleColor: 'var(--text-primary)',
			footer: [
				{
					id: 'popup-button-reloadApp',
					label: 'Powrót',
				},
			],
		});

		getElement.div('popup-button-reloadApp').addEventListener('click', () => {
			app.main();
		});
	}
};

const changeNicknameHandler = (closeable = true, subtitle = '', startingValue = '') => {
	app.popup.create({
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

	const nicknameInput = getElement.input('popup-input-username');
	const changeNicknameFormHandler = async () => {
		const value = nicknameInput.value.trim();

		if (!app.utils.verifyUsername(value)) {
			app.popup.setSubtitle({
				subtitle: 'Pseudonim powinien mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _',
			});
			app.popup.shake();
		} else {
			if (value !== app.user?.nickname) {
				app.popup.showSpinner();
				const res = await app.api.changeNickname(value);
				if (res === 'success') {
					if (app.user)
						app.user.nickname = value;

					app.propagateUserData();
					app.popup.hide();
					app.spinner.hide();
				} else {
					if (res === '429') {
						app.popup.setSubtitle({
							subtitle: 'Zbyt wiele zmian pseudonimu. Spróbuj ponownie później',
						});
					}

					app.popup.shake();
				}
			} else {
				app.popup.hide();
			}
		}
	};

	getElement.div('popup-button-changeNickname').onclick = changeNicknameFormHandler;
	nicknameInput.onkeydown = (event) => {
		if (event.code === 'Enter')
			changeNicknameFormHandler();
	};

	nicknameInput.value = startingValue === '' ? app.user?.nickname ?? '' : startingValue;
	nicknameInput.focus();
};

const changePasswordHandler = () => {
	app.popup.create({
		title: 'Zmień hasło',
		closeable: true,
		body: [
			{
				label: 'Stare hasło',
				input: {
					id: 'popup-input-currentPassword',
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

	const currentPasswordInput = getElement.input('popup-input-currentPassword');
	const changePasswordFormHandler = async () => {
		const newPassword = getElement.input('popup-input-password').value;
		if (newPassword !== getElement.input('popup-input-password2').value) {
			app.popup.setSubtitle({
				subtitle: 'Podane nowe hasła nie są identyczne',
			});
			app.popup.shake();
			return;
		}

		app.popup.showSpinner();
		app.socket.reconnect = false;

		const res = await app.api.changePassword(await app.utils.sha256(currentPasswordInput.value), await app.utils.sha256(getElement.input('popup-input-password').value));
		if (res === 'success') {
			app.popup.setSubtitle({
				subtitle: 'Hasło zostało zmienione pomyślnie',
				subtitleColor: 'var(--green)',
			});

			setTimeout(() => {
				app.main();
			}, 1000);
		} else {
			app.socket.reconnect = true;
			app.popup.hideSpinner();
			app.popup.setSubtitle({
				subtitle: res === 'invalidLogin' ? 'Niepoprawne stare hasło' : 'Zbyt wiele prób zmiany hasła. Spróbuj ponownie później',
			});
			app.popup.shake();
		}
	};

	getElement.div('popup-button-changePassword').onclick = changePasswordFormHandler;
	getElement.input('popup-input-password2').onkeydown = (event) => {
		if (event.code === 'Enter')
			changePasswordFormHandler();
	};

	currentPasswordInput.focus();
};

const loginHandler = () => {
	app.spinner.hide();
	app.popup.create({
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

	const usernameInput = getElement.input('popup-input-username');

	const loginFormHandler = async () => {
		app.popup.showSpinner();
		const response = await app.api.login(usernameInput.value, await app.utils.sha256(getElement.input('popup-input-password').value));

		let error = '';
		switch (response) {
			case 'success':
				break;
			case 'invalidLogin':
				error = 'Niepoprawny login lub hasło';
				break;
			case '429':
				error = 'Zbyt wiele nieudanych prób logowania. Spróbuj ponownie później';
				break;
			default:
				error = 'Wystąpił nieznany błąd. Spróbuj ponownie później';
		}

		if (error === '') {
			app.main();
		} else {
			app.popup.setSubtitle({
				subtitle: error,
			});
			app.popup.shake();
			app.popup.hideSpinner();
		}
	};

	getElement.div('popup-button-login').onclick = loginFormHandler;
	getElement.input('popup-input-password').onkeydown = (event) => {
		if (event.code === 'Enter')
			loginFormHandler();
	};

	getElement.div('popup-button-register').onclick = () => {
		registerHandler();
	};

	usernameInput.focus();
};

const registerHandler = () => {
	app.spinner.hide();
	let registrationInProgress = false;
	const popupCaptchaHTML = '<div id="popup-captcha" class="popup-button" style="background-color: var(--border-secondary); margin-bottom: 20px;">Nie jestem robotem</div>';
	app.popup.create({
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

	const usernameInput = getElement.input('popup-input-username');
	const captchaRow = getElement.div('popup-captcha').parentElement;
	/**
	 * @type {{ id: string, content: string, timestamp: number, signature: string }}
	 */
	let captchaData;
	const resetCaptcha = () => {
		if (!captchaRow?.parentElement)
			return;

		captchaRow.innerHTML = popupCaptchaHTML;

		getElement.div('popup-captcha').onclick = async () => {
			const response = await app.api.getCaptcha();

			if (typeof response === 'object') {
				captchaData = response;
				captchaRow.innerHTML = `<div class="popup-row-label">Przepisz tekst z obrazka</div>${captchaData.content}<input id="popup-input-captcha" class="popup-row-input" type="text">`;
				getElement.input('popup-input-captcha').onkeydown = (event) => {
					if (event.code === 'Enter')
						registerFormHandler();
				};

				setTimeout(() => {
					resetCaptcha();
				}, 60_000);
			} else {
				app.popup.setSubtitle({
					subtitle: response === '429' ? 'Zbyt wiele nieudanych prób rozwiązania CAPTCHA. Spróbuj ponownie później' : 'Wystąpił nieznany błąd. Spróbuj ponownie później',
				});
				app.popup.shake();
			}
		};
	};
	resetCaptcha();

	const registerFormHandler = async () => {
		if (registrationInProgress)
			return;
		else
			registrationInProgress = true;

		let error = '';
		const captchaInput = getElement.input('popup-input-captcha');
		if (!captchaInput)
			error = 'Musisz potwierdzić że nie jesteś robotem';

		if (!app.utils.verifyUsername(usernameInput.value))
			error = 'Nazwa użytkownika powinna mieć od 3 do 32 znaków i zawierać tylko litery, cyfry, - i _';

		const password = getElement.input('popup-input-password').value;
		if (password !== getElement.input('popup-input-password2').value)
			error = 'Wpisane hasła nie są identyczne';

		if (error !== '') {
			app.popup.setSubtitle({
				subtitle: error,
			});
			app.popup.shake();
			registrationInProgress = false;
			return;
		}

		app.popup.showSpinner();
		const response = await app.api.register(usernameInput.value, await app.utils.sha256(password), {
			id: captchaData.id,
			timestamp: captchaData.timestamp,
			signature: captchaData.signature,
			solution: captchaInput.value,
		});

		switch (response) {
			case 'success':
				break;
			case 'usernameAlreadyInUse':
				error = 'Ta nazwa użytkownika jest już zajęta';
				resetCaptcha();
				break;
			case '400':
			case 'invalidSolution':
				error = 'Wpisany tekst nie jest poprawnym rozwiązaniem CAPTCHy';
				break;
			case 'captchaExpired':
				error = 'CAPTCHA wygasła';
				resetCaptcha();
				break;
			case '429':
				error = 'Zbyt wiele prób rejestracji. Spróbuj ponownie później';
				break;
			case '418':
				error = 'Rejestracja jest obecnie niedostępna. Spróbuj ponownie później';
				break;
			default:
				error = 'Wystąpił nieznany błąd. Spróbuj ponownie później';
		}

		if (error === '') {
			app.popup.setSubtitle({
				subtitle: 'Zarejestrowano pomyślnie!',
				subtitleColor: 'var(--green)',
			});

			setTimeout(() => {
				app.main();
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

	getElement.div('popup-button-register').onclick = registerFormHandler;

	getElement.div('popup-button-login').onclick = () => {
		loginHandler();
	};

	usernameInput.focus();
};

app.main();
