let username = '';
let socket;
const sessions = {};
const messages = [];
const notifications = [];
const messagesToLoad = 35;
let isDropdownOpen = false, isUsernamePopupOpen = false;

const elements = {
	topBar: document.querySelector('.top-bar'),
	siteBody: document.querySelector('.site-body'),
	bottomBar: document.querySelector('.bottom-bar'),

	popup: document.getElementById('popup'),
	popupTitle: document.getElementById('popup-title'),
	popupSubtitle: document.getElementById('popup-subtitle'),
	popupInput: document.getElementById('popup-input'),

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
			<line x1="0.25" y1="0.5" x2="0.75" y2="0.5" stroke="rgb(164, 164, 164)" stroke-width="0.06"></line>
			<line x1="0.5" y1="0.25" x2="0.5" y2="0.75" stroke="rgb(164, 164, 164)" stroke-width="0.06"></line>
		</svg>`,
	cross: `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 1 1">
			<line x1="0.25" x2="0.75" stroke="rgb(164, 164, 164)" stroke-width="0.06" y1="0.25" y2="0.75"></line>
			<line y1="0.25" y2="0.75" stroke="rgb(164, 164, 164)" stroke-width="0.06" x2="0.25" x1="0.75"></line>
		</svg>`,
};

const showPopup = (title, subtitle = '', input = false) => {
    elements.topBar.style.display = 'none';
    elements.siteBody.style.display = 'none';
    elements.bottomBar.style.display = 'none';

    elements.popup.style.display = '';
    elements.popupTitle.innerHTML = title;

    if (subtitle?.length > 0) {
        elements.popupTitle.style.margin = '16px 16px 16px 0px';
        elements.popupSubtitle.style.display = '';
        elements.popupSubtitle.innerHTML = subtitle;
    } else {
        elements.popupSubtitle.style.display = 'none';
        if (input) {
            elements.popupTitle.style.margin = '';
        } else {
            elements.popupTitle.style.margin = '0px';
        }
    }

    if (input) {
        elements.popupInput.style.display = '';
	} else {
        elements.popupInput.style.display = 'none';
    }
}

const hidePopup = () => {
    elements.topBar.style.display = '';
    elements.siteBody.style.display = '';
    elements.bottomBar.style.display = '';

    elements.popup.style.display = 'none';
}

const propagateUsername = (username) => {
	elements.usernameDisplay.innerText = username;
}

const sha256 = async (message) => {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

const regenSessionID = () => {
    localStorage.removeItem('sessionID');
    socket.close();
}

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
    return `<div class='message' id='${msgData.messageID}'><div class='message-highlight'>[${new Date(msgData.ts).toLocaleString('pl')}]</div><span class='message-highlight'>${sessions[msgData.sessionIDHash].split('<').join('&lt;')}</span><div class='message-content'>${sanitize(msgData.message)}</div></div>`;
}

const addMessage = (msgData) => {
    if (!sessions[msgData.sessionIDHash]) {
        sessions[msgData.sessionIDHash] = msgData.sessionIDHash.slice(0, 10);
        socket.send(JSON.stringify({
            type: 'get-session-id-hash',
            sessionIDHash: msgData.sessionIDHash,
        }));
    }

    const scroll = elements.messageContainer.offsetHeight + elements.messageContainer.scrollTop + 20 > elements.messageContainer.scrollHeight;
    elements.messages.innerHTML += generateMessage(msgData);

    messages.push(msgData);

	if (!document.hasFocus() && Notification.permission === 'granted') {
        let notif = new Notification('Discord 4.0: New Message', {
            body: `${sessions[msgData.sessionIDHash].split('<').join('&lt;')}: ${msgData.message.slice(0, 150)}`,
            icon: '/favicon.ico',
        });

        notif.index = notifications.length;
        notif.onclose = () => {
            notifications.splice(notif.index, 1);
        }

        notifications.push(notif);
    }

    if (scroll) elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight);
}

const insertMessage = (msgData) => {
    if (!sessions[msgData.sessionIDHash]) {
        sessions[msgData.sessionIDHash] = msgData.sessionIDHash.slice(0, 10);
        socket.send(JSON.stringify({
            type: 'get-session-id-hash',
            sessionIDHash: msgData.sessionIDHash,
        }));
    }

    const oldHeight = elements.messageContainer.scrollHeight;

    messages.splice(0, 0, msgData);

    elements.messages.innerHTML = generateMessage(msgData) + elements.messages.innerHTML;
    elements.messageContainer.scrollTo(0, elements.messageContainer.scrollHeight - oldHeight + elements.messageContainer.scrollTop);
}

const loadMessages = () => {
    elements.loadMessagesButton.style.display = 'none';
    socket.send(JSON.stringify({
        type: 'get-messages',
    }));
}

const sanitize = (text) => {
    text = text.split('&').join('&amp;');
    text = text.split('<').join('&lt;');

    return markdownToHTML(text).split('\n').join('<br>');
}

const connect = () => {
    socket = new WebSocket(`wss://${window.location.hostname}:${window.location.port}/ws/`);
    showPopup('Łączenie...');
    let pinger;

    socket.onopen = () => {
        if (localStorage.getItem('sessionID') === null || localStorage.getItem('sessionID').length === 0) {
            let randArr = new Uint32Array(40);
            crypto.getRandomValues(randArr);

            let randString = '';
            for (let rand of randArr) randString += `${rand}`;

            randString = btoa(randString);
            localStorage.setItem('sessionID', randString);
        }

        pinger = setInterval(() => {
            socket.send(JSON.stringify({
                type: 'ping',
            }));
        }, 5000);

        socket.send(JSON.stringify({
            type: 'connect',
            sessionID: localStorage.getItem('sessionID')
        }));
    }

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
            for (const message of data.messages) {
                insertMessage(message);
            }

            if (data.messages.length === messagesToLoad) elements.loadMessagesButton.style.display = 'table';
        } else if (data.type === 'update-username') {
            if (data.sessionIDHash === await sha256(localStorage.getItem('sessionID'))) {
                if (messages.length === 0) {
                    loadMessages();
                    propagateUsername(data.username);
                    username = data.username;
                }
                hidePopup();
            }

            if (data.username.length !== 0) {
                sessions[data.sessionIDHash] = data.username;

                for (const msg of messages) {
                    if (msg.sessionIDHash === data.sessionIDHash) {
                        document.getElementById(msg.messageID).childNodes[1].innerHTML = sessions[data.sessionIDHash];
                    }
                }
            }
        } else if (data.type === 'reload') {
            window.location.reload();
        }
    }

    socket.onclose = () => {
        clearInterval(pinger);
        elements.messages.innerHTML = '';
        showPopup('Łączenie...');

        setTimeout(connect, 1000);
    }
}

elements.popupInput.addEventListener('keyup', event => {
    if(event.code === 'Enter' || event.keyCode === 13) {
        const value = elements.popupInput.value.trim();

        if(value.length < 3 || value.length > 32) {
            showPopup('Ustaw swój pseudonim', 'Pseudonim powinien zawierać od 3 do 32 znaków.', true);
        } else {
            username = value;
            socket.send(JSON.stringify({
                type: 'set-username',
                username,
            }));

            propagateUsername(username);
			isUsernamePopupOpen = false;
        }
    }
});

const changeUsername = () => {
	isUsernamePopupOpen = true;
    showPopup('Ustaw swój pseudonim', '', true);
	elements.popupInput.value = username;
}

elements.input.addEventListener('keydown', event => {
    if((event.code === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
        event.preventDefault();

        let value = elements.input.value.trim();

        if(value === '/tableflip') {
            value = '(╯°□°）╯︵ ┻━┻'
        } else if(value === '/unflip') {
            value = '┬─┬ ノ( ゜-゜ノ)'
        } else if(value === '/shrug') {
            value = '¯\\\\_(ツ)_/¯'
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
document.addEventListener('keyup', (ev) => {
	if (ev.code === 'Escape' && isUsernamePopupOpen) {
		hidePopup();
		isUsernamePopupOpen = false;
	}
});

const updateClock = () => {
	const NOW = new Date();
	elements.clock.innerHTML = `${`${NOW.getHours()}`.padStart(2, '0')}:${`${NOW.getMinutes()}`.padStart(2, '0')}:${`${NOW.getSeconds()}`.padStart(2, '0')}`;
	setTimeout(updateClock, 1000 - (Date.now() % 1000));
};

updateClock();
connect();

elements.messageContainer.onscroll = () => {
	if (Notification.permission === 'default') Notification.requestPermission();
}
