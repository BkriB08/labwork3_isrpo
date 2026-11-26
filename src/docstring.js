'use strict';

/**
 * @file Формирование docstring в стиле Google и объединение с уже существующим.
 */

const { parseFunctions, findFunctionAt } = require('./parser');

/** Начало docstring: необязательный префикс и любая кавычка. */
const DOC_START = /^[rRuU]?["']/;

/** Строковый литерал целиком: префикс, кавычки, содержимое. */
const DOC_FULL = /^([rRuU]?)("""|'''|"|')((?:\\[\s\S]|(?!\2)[^\\])*)\2$/;

/** Строка раздела с описанием параметра: "имя (тип): описание". */
const ENTRY = /^(\*{0,2}[\p{L}\p{N}_.]+)\s*(?:\(.*?\))?\s*:\s*(.*)$/u;

/**
 * Тип параметра для документации: из аннотации или по значению по умолчанию.
 * @param {{type: ?string, default: ?string}} param Параметр функции.
 * @returns {?string} Название типа или null, если определить его нельзя.
 */
function typeOf(param) {
  if (param.type) return param.type;
  const value = param.default;
  if (value === null) return null;
  const rules = [
    [/^(True|False)$/, 'bool'],
    [/^-?\d+$/, 'int'],
    [/^-?\d*\.\d+$|^-?\d+\.\d*$/, 'float'],
    [/^["']/, 'str'],
    [/^\[/, 'list'],
    [/^\{\s*\}$|^\{.*:.*\}$/, 'dict'],
    [/^\(/, 'tuple'],
  ];
  const rule = rules.find(([pattern]) => pattern.test(value));
  return rule ? rule[1] : null;
}

/**
 * Разбирает содержимое docstring на описание и разделы.
 * @param {string} content Текст между кавычками без общего отступа.
 * @returns {{summary: string[], sections: Map<string, string[]>}} Разделы
 *   хранятся в словаре "заголовок → строки" в порядке появления.
 */
function parseDocstring(content) {
  const summary = [];
  const sections = new Map();
  let current = summary;
  for (const line of content.split('\n')) {
    const title = /^(Args|Arguments|Keyword Args|Returns|Yields|Raises|Attributes|Note|Notes|Example|Examples|Warning|Warnings|See Also|References|Todo):\s*$/.exec(line);
    if (title) {
      const name = title[1] === 'Arguments' ? 'Args' : title[1];
      if (!sections.has(name)) sections.set(name, []);
      current = sections.get(name);
    } else if (current !== summary && /^\S/.test(line)) {
      current = summary; // обычный текст после раздела
      current.push('', line);
    } else {
      current.push(line);
    }
  }
  for (const lines of [summary, ...sections.values()]) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length && lines[0].trim() === '') lines.shift();
  }
  if (summary.length) summary[0] = summary[0].trimStart();
  return { summary, sections };
}

/**
 * Разбирает строки раздела на записи "имя → строки записи".
 * @param {string[]} lines Строки раздела (с отступом внутри раздела).
 * @returns {Map<string, string[]>} Записи; ключ не содержит звёздочек.
 */
function parseEntries(lines) {
  const entries = new Map();
  const base = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  let current = null;
  for (const line of lines) {
    const text = line.slice(base);
    const match = /^\S/.test(text) ? ENTRY.exec(text) : null;
    if (match) {
      current = [text];
      entries.set(match[1].replace(/^\*+/, ''), current);
    } else if (current && line.trim()) {
      current.push(text);
    }
  }
  return entries;
}

/**
 * Собирает разделы новой документации с учётом старой.
 * Описания, написанные человеком, сохраняются.
 * @param {object} fn Функция из parseFunctions.
 * @param {Map<string, string[]>} old Разделы существующего docstring.
 * @param {string} todo Текст-заполнитель.
 * @returns {{sections: Map<string, string[]>, added: string[], removed: string[]}}
 *   Новые разделы и имена добавленных и удалённых параметров.
 */
function buildSections(fn, old, todo) {
  const sections = new Map();
  const added = [];

  const oldArgs = old.has('Args') ? parseEntries(old.get('Args')) : new Map();
  const args = [];
  for (const param of fn.params) {
    const key = param.name.replace(/^\*+/, '');
    const type = typeOf(param);
    const label = `${param.name}${type ? ` (${type})` : ''}`;
    if (oldArgs.has(key)) {
      const [first, ...rest] = oldArgs.get(key);
      args.push(`${label}: ${ENTRY.exec(first)[2]}`.trimEnd(), ...rest);
      oldArgs.delete(key);
    } else {
      const hint = param.default === null ? '' : ` По умолчанию ${param.default}.`;
      args.push(`${label}: ${todo}.${hint}`);
      added.push(key);
    }
  }
  const removed = [...oldArgs.keys()];
  if (args.length) sections.set('Args', args.map((line) => `    ${line}`));

  const hasValue = fn.returnType !== null && !['None', 'NoReturn'].includes(fn.returnType);
  const resultName = fn.yields ? 'Yields' : 'Returns';
  if (fn.yields || fn.returns || hasValue) {
    if (fn.name !== '__init__') {
      const type = hasValue ? `${fn.returnType}: ` : '';
      sections.set(resultName, old.get(resultName) || [`    ${type}${todo}.`]);
    }
  }

  const oldRaises = old.has('Raises') ? parseEntries(old.get('Raises')) : new Map();
  const raises = [];
  for (const name of fn.raises) {
    raises.push(...(oldRaises.get(name) || [`${name}: ${todo}.`]));
    oldRaises.delete(name);
  }
  // исключения из вызываемых функций мог дописать человек, поэтому они остаются
  for (const entry of oldRaises.values()) raises.push(...entry);
  if (raises.length) sections.set('Raises', raises.map((line) => `    ${line}`));

  // если код не показывает результат (например, абстрактный метод), описание остаётся
  const noResult = !sections.has('Returns') && !sections.has('Yields');
  for (const [name, lines] of old) {
    const isResult = name === 'Returns' || name === 'Yields';
    if (isResult ? noResult : name !== 'Args' && name !== 'Raises') sections.set(name, lines);
  }
  return { sections, added, removed };
}

/**
 * Убирает общий отступ у содержимого существующего docstring.
 * @param {string} content Текст между кавычками.
 * @param {number} bodyIndent Длина отступа тела функции.
 * @returns {string} Текст без отступа.
 */
function dedent(content, bodyIndent) {
  const [first, ...rest] = content.split('\n');
  const indents = rest.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length);
  const base = indents.length ? Math.min(bodyIndent, ...indents) : 0;
  return [first.trim(), ...rest.map((l) => l.slice(base).trimEnd())].join('\n');
}

/**
 * Определяет отступ тела функции, у которой ещё нет тела.
 * @param {string} headerIndent Отступ строки def.
 * @returns {string} Отступ на уровень глубже.
 */
function deeper(headerIndent) {
  return headerIndent + (headerIndent.includes('\t') ? '\t' : '    ');
}

/**
 * Строит правку, которая добавляет или обновляет docstring функции.
 * @param {string[]} lines Строки файла.
 * @param {object} fn Функция из parseFunctions.
 * @param {{todo?: string}} [options] Настройки генерации.
 * @returns {?{start: number, deleteCount: number, newLines: string[],
 *   added: string[], removed: string[], updated: boolean}}
 *   Правка или null, если документация уже соответствует коду.
 * @throws {Error} Если функцию записали в одну строку или docstring не закрыт.
 */
function buildEdit(lines, fn, options = {}) {
  const todo = options.todo || 'TODO';
  if (fn.inline) {
    throw new Error(`Функция ${fn.name} записана в одну строку: перенесите тело на следующую.`);
  }

  const first = fn.body[0];
  const existing = Boolean(first) && DOC_START.test(first.code);
  let prefix = '';
  let quotes = '"""';
  let parsed = { summary: [], sections: new Map() };

  if (existing) {
    const literal = DOC_FULL.exec(first.code.trimEnd());
    if (!literal) throw new Error(`Не удалось разобрать docstring функции ${fn.name}.`);
    const content = literal[3];
    prefix = literal[1];
    // одинарные кавычки заменяются тройными, чтобы docstring мог стать многострочным
    if (literal[2].length === 3) quotes = literal[2];
    else if (content.includes('"""')) quotes = "'''";
    parsed = parseDocstring(dedent(content, first.indentText.length));
  }

  const { sections, added, removed } = buildSections(fn, parsed.sections, todo);
  const summary = parsed.summary.length ? parsed.summary : [`${todo}: описание функции ${fn.name}.`];

  const doc = [...summary];
  for (const [name, body] of sections) doc.push('', `${name}:`, ...body);

  const indent = first ? first.indentText : deeper(fn.header.indentText);
  // кавычка или \ в конце слились бы с закрывающими кавычками
  const oneLine = doc.length === 1 && !doc[0].endsWith(quotes[0]) && !doc[0].endsWith('\\');
  const newLines = oneLine
    ? [`${prefix}${quotes}${doc[0]}${quotes}`]
    : [`${prefix}${quotes}${doc[0]}`, ...doc.slice(1), quotes];
  const indented = newLines.map((l) => (l ? indent + l : ''));

  const start = existing ? first.start : fn.header.end + 1;
  const deleteCount = existing ? first.end - first.start + 1 : 0;
  const same = lines.slice(start, start + deleteCount).join('\n') === indented.join('\n');
  if (same) return null;

  return { start, deleteCount, newLines: indented, added, removed, updated: Boolean(existing) };
}

/**
 * Применяет правку к массиву строк.
 * @param {string[]} lines Исходные строки.
 * @param {{start: number, deleteCount: number, newLines: string[]}} edit Правка.
 * @returns {string[]} Новый массив строк.
 */
function applyEdit(lines, edit) {
  const result = lines.slice();
  result.splice(edit.start, edit.deleteCount, ...edit.newLines);
  return result;
}

/**
 * Документирует функцию под курсором.
 * @param {string[]} lines Строки файла.
 * @param {number} cursorLine Номер строки курсора.
 * @param {{todo?: string}} [options] Настройки генерации.
 * @returns {{fn: ?object, edit: ?object}} Найденная функция и правка.
 */
function documentAt(lines, cursorLine, options) {
  const fn = findFunctionAt(parseFunctions(lines), cursorLine);
  return { fn, edit: fn ? buildEdit(lines, fn, options) : null };
}

/**
 * Строит правки для всех функций файла. Правки идут снизу вверх, поэтому
 * применение одной не сдвигает строки остальных.
 * @param {string[]} lines Строки файла.
 * @param {{todo?: string}} [options] Настройки генерации.
 * @returns {{edits: object[], skipped: string[]}} Правки и причины пропусков.
 */
function documentAll(lines, options) {
  const edits = [];
  const skipped = [];
  for (const fn of parseFunctions(lines).reverse()) {
    try {
      const edit = buildEdit(lines, fn, options);
      if (edit) edits.push(edit);
    } catch (error) {
      skipped.push(error.message);
    }
  }
  return { edits, skipped };
}

module.exports = { typeOf, parseDocstring, buildEdit, applyEdit, documentAt, documentAll };
