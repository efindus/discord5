const expressions = {
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

let mode;

const isAtPosition = (text, value, position) => {
	for (let i = 0; i < value.length; i++) {
		if (text[position + i] !== value[i]) {
			return false;
		}
	}

	return true;
};

const highlightPart = (text) => {
	if (text.length === 0) return '';

	if (mode === 'comment') {
		const end = text.indexOf('*/');

		if (end === -1) {
			return `<span class='comment'>${text}</span>`;
		} else {
			mode = 'default';
			return `<span class='comment'>${text.slice(0, end + 2)}</span>${highlightPart(text.slice(end + 2))}`;
		}
	} else if (text.match(expressions.multilineComment) !== null) {
		const match = text.match(expressions.multilineComment)[0];
		mode = 'comment';

		return `<span class='comment'>${match}</span>${highlightPart(text.slice(match.length))}`;
	} else if (text.match(expressions.comment) !== null) {
		return `<span class='comment'>${text}</span>`;
	} else if (text.match(expressions.include) !== null) {
		const match = text.match(expressions.include)[0];
		const index = match.indexOf('<');

		return `<span class='preprocessor'>${text.slice(0, index)}</span><span class='string-special'>&lt;</span><span class='string'>${text.slice(index + 1, match.length - 1)}</span><span class='string-special'>></span>${highlightPart(text.slice(match.length))}`;
	} else if (text.match(expressions.preprocessor) !== null) {
		const match = text.match(expressions.preprocessor)[0];
		return `<span class='preprocessor'>${match}</span>${highlightPart(text.slice(match.length))}`;
	} else if (text.match(expressions.string) !== null) {
		const match = text.match(expressions.string)[0];
		const end = text.slice(match.length).match(expressions.stringEnd);

		if (end === null) {
			return `<span class='string'>${text}</span>`;
		} else {
			return `<span class='string'>${match + end[0]}</span>${highlightPart(text.slice(end[0].length + match.length))}`;
		}
	} else {
		let match = text.match(expressions.split)[0];

		if (match.length > 1) match = match.slice(0, match.length - 1);

		if (match.match(expressions.keyword) !== null) {
			return `<span class='keyword'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (match.match(expressions.instruction) !== null) {
			return `<span class='instruction'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (match.match(expressions.operator) !== null) {
			return `<span class='operator'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (match.match(expressions.number) !== null) {
			return `<span class='number'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (text.match(expressions.function) !== null) {
			let match2 = text.match(expressions.function)[0];
			match2 = match2.slice(0, match2.length - 1);

			return `<span class='function'>${match2}</span>${highlightPart(text.slice(match2.length))}`;
		} else if (match.match(expressions.definition) !== null) {
			return `<span class='definition'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (match.match(expressions.white) !== null) {
			return `<span class='white'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else if (match.match(expressions.builtIn) !== null) {
			return `<span class='builtin'>${match}</span>${highlightPart(text.slice(match.length))}`;
		} else {
			return `<span class='other'>${match}</span>${(text.length > match.length ? highlightPart(text.slice(match.length)) : '')}`;
		}
	}
};

const highlight = (text) => {
	let result = '<table><tbody>';
	const lines = text.split('&lt;').join('<').trim().split('\n');

	mode = 'default';

	for (let i = 0; i < lines.length; i++) {
		result += `<tr><td line='${i + 1}'><td>${highlightPart(`${lines[i]}\u200B`)}</tr>`;
	}

	return `${result}</tbody></table>`;
};

const findNext = (text, value, position) => {
	let cancel = false;

	for (let i = position; i < text.length; i++) {
		if (cancel) cancel = false;
		else if (text[i] === '\\') cancel = true;
		else if (isAtPosition(text, value, i)) return i;
	}

	return -1;
};

const markdown = [ [ '**', 'b' ], [ '*', 'i' ], [ '__', 'u' ], [ '~~', 'strike' ] ];

const markdownToHTML = (text) => {
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
		} else if (isAtPosition(text, '```', i)) {
			const end = text.indexOf('```', i + 3);

			if (end !== -1) {
				result += highlight(text.slice(i + 3, end));
				i = end + 2;
			} else {
				result += text[i];
			}
		} else {
			let activated = false;

			for (let position = 0; position < markdown.length; position++) {
				if (isAtPosition(text, markdown[position][0], i)) {
					let next = findNext(text, markdown[position][0], i + markdown[position][0].length);

					if (next !== -1) {
						if (text.slice(i + markdown[position][0].length, next).trim().length === 0) {
							next = findNext(text, markdown[position][0], next + 1);
						}

						if (next !== -1) {
							result += `<${markdown[position][1]}>${markdownToHTML(text.slice(i + markdown[position][0].length, next))}</${markdown[position][1]}>`;
							activated = true;
							i = next + markdown[position][0].length - 1;

							break;
						}
					}
				}
			}

			if (!activated) result += text[i];
		}
	}

	return result;
};
