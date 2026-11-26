'use strict';

/**
 * @file Разбор исходного кода Python: логические строки, функции, параметры.
 * Модуль не зависит от VS Code, поэтому его можно тестировать отдельно.
 */

/** Соответствие закрывающих скобок открывающим. */
const PAIRS = { ')': '(', ']': '[', '}': '{' };

/**
 * Логическая строка Python (может занимать несколько физических строк).
 * @typedef {object} LogicalLine
 * @property {number} start   Номер первой физической строки (с нуля).
 * @property {number} end     Номер последней физической строки.
 * @property {number} indent  Ширина отступа (табуляция выравнивается до 8).
 * @property {string} indentText Символы отступа.
 * @property {string} code    Текст без комментариев.
 * @property {string} masked  Тот же текст, где содержимое строк заменено на "_".
 */

/**
 * Вычисляет ширину отступа по правилам Python.
 * @param {string} text Символы отступа.
 * @returns {number} Ширина отступа в позициях.
 */
function indentWidth(text) {
  let width = 0;
  for (const ch of text) {
    width = ch === '\t' ? width + 8 - (width % 8) : width + 1;
  }
  return width;
}

/**
 * Делит код на логические строки. Стек скобок и состояние строкового литерала
 * показывают, заканчивается ли инструкция на переносе строки.
 * @param {string[]} lines Физические строки файла.
 * @returns {LogicalLine[]} Непустые логические строки.
 */
function toLogicalLines(lines) {
  const result = [];
  const brackets = [];
  let quote = null; // открытая кавычка: ', ", ''' или """
  let current = null;

  lines.forEach((line, number) => {
    let i = 0;
    if (!current) {
      const indentText = /^[ \t\f]*/.exec(line)[0];
      const rest = line.slice(indentText.length);
      if (rest === '' || rest.startsWith('#')) return;
      current = { start: number, end: number, indent: indentWidth(indentText), indentText, code: '', masked: '' };
      i = indentText.length;
    }

    /** Добавляет фрагмент в обе версии логической строки. */
    const push = (code, masked = code) => {
      current.code += code;
      current.masked += masked;
    };

    let continued = false;
    while (i < line.length) {
      const ch = line[i];
      if (quote) {
        if (ch === '\\') {
          const pair = line.slice(i, i + 2);
          push(pair, '_'.repeat(pair.length));
          if (i === line.length - 1) continued = true;
          i += 2;
        } else if (line.startsWith(quote, i)) {
          push(quote);
          i += quote.length;
          quote = null;
        } else {
          push(ch, '_');
          i += 1;
        }
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        const triple = ch.repeat(3);
        quote = line.startsWith(triple, i) ? triple : ch;
        push(quote);
        i += quote.length;
        continue;
      }
      if (ch === '\\' && i === line.length - 1) {
        continued = true;
        break;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        brackets.push(ch);
      } else if (PAIRS[ch] && brackets[brackets.length - 1] === PAIRS[ch]) {
        brackets.pop();
      }
      push(ch);
      i += 1;
    }

    current.end = number;
    const tripleOpen = quote !== null && quote.length === 3;
    if (quote && !tripleOpen && !continued) quote = null; // незакрытая строка

    if (tripleOpen) {
      push('\n', '_');
    } else if (brackets.length > 0 || continued) {
      if (!quote) push(' ');
    } else {
      result.push(current);
      current = null;
    }
  });

  if (current) result.push(current);
  return result;
}

/**
 * Разбивает фрагмент по запятым верхнего уровня.
 * Запятые внутри скобок и в списке параметров lambda пропускаются.
 * @param {string} code Исходный фрагмент.
 * @param {string} masked Замаскированная версия той же длины.
 * @returns {{code: string, masked: string}[]} Непустые части.
 */
function splitTopLevel(code, masked) {
  const parts = [];
  const stack = [];
  let from = 0;
  let inLambda = false;

  const cut = (to) => {
    if (code.slice(from, to).trim() !== '') {
      parts.push({ code: code.slice(from, to), masked: masked.slice(from, to) });
    }
    from = to + 1;
  };

  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if ('([{'.includes(ch)) stack.push(ch);
    else if (PAIRS[ch]) stack.pop();
    else if (stack.length === 0) {
      if (/^lambda\b/.test(masked.slice(i)) && !/\w/.test(masked[i - 1] || '')) inLambda = true;
      else if (ch === ':') inLambda = false;
      else if (ch === ',' && !inLambda) cut(i);
    }
  }
  cut(masked.length);
  return parts;
}

/**
 * Ищет первое вхождение символа вне скобок.
 * @param {string} masked Замаскированный текст.
 * @param {string} target Искомый символ.
 * @param {number} [from] Позиция начала поиска.
 * @returns {number} Индекс символа или -1.
 */
function findTopLevel(masked, target, from = 0) {
  const stack = [];
  for (let i = from; i < masked.length; i += 1) {
    const ch = masked[i];
    if (stack.length === 0 && ch === target) return i;
    if ('([{'.includes(ch)) stack.push(ch);
    else if (PAIRS[ch]) stack.pop();
  }
  return -1;
}

/**
 * Ищет скобку, закрывающую скобку в позиции open.
 * @param {string} masked Замаскированный текст.
 * @param {number} open Позиция открывающей скобки.
 * @returns {number} Позиция закрывающей скобки или -1.
 */
function matchingBracket(masked, open) {
  const stack = [];
  for (let i = open; i < masked.length; i += 1) {
    const ch = masked[i];
    if ('([{'.includes(ch)) stack.push(ch);
    else if (PAIRS[ch]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/**
 * Разбирает один параметр вида "имя: тип = значение".
 * @param {{code: string, masked: string}} part Фрагмент списка параметров.
 * @returns {{name: string, type: ?string, default: ?string}} Описание параметра.
 */
function parseParam({ code, masked }) {
  const equals = findTopLevel(masked, '=');
  const head = equals === -1 ? masked : masked.slice(0, equals);
  const colon = findTopLevel(head, ':');
  const nameEnd = colon !== -1 ? colon : head.length;
  return {
    name: code.slice(0, nameEnd).replace(/\s+/g, ''),
    type: colon === -1 ? null : code.slice(colon + 1, head.length).trim(),
    default: equals === -1 ? null : code.slice(equals + 1).trim(),
  };
}

/**
 * Разбирает заголовок функции.
 * @param {LogicalLine} line Логическая строка, начинающаяся с def.
 * @returns {?object} Имя, параметры, тип результата и признак однострочной
 *   функции; null, если заголовок записан не полностью.
 */
function parseSignature(line) {
  const { code, masked } = line;
  const head = /^(?:async\s+)?def\s+([^\s([:]+)\s*/.exec(masked);
  if (!head) return null;

  let open = head[0].length;
  if (masked[open] === '[') open = matchingBracket(masked, open) + 1; // def f[T](x)
  open = masked.indexOf('(', open);
  if (open === -1) return null;
  const close = matchingBracket(masked, open);
  if (close === -1) return null;
  const colon = findTopLevel(masked, ':', close + 1);
  if (colon === -1) return null;

  const params = splitTopLevel(code.slice(open + 1, close), masked.slice(open + 1, close))
    .map(parseParam)
    .filter((p) => p.name !== '*' && p.name !== '/');
  const arrow = masked.slice(close + 1, colon).indexOf('->');
  const returnType = arrow === -1 ? null : code.slice(close + 1 + arrow + 2, colon).trim();

  return {
    name: head[1],
    params,
    returnType,
    inline: masked.slice(colon + 1).trim() !== '',
  };
}

/**
 * Определяет, что возвращает и какие исключения выбрасывает функция.
 * Вложенные функции и классы пропускаются.
 * @param {LogicalLine[]} body Логические строки тела функции.
 * @returns {{returns: boolean, yields: boolean, raises: string[]}} Результат.
 */
function analyzeBody(body) {
  let returns = false;
  let yields = false;
  const raises = new Set();
  let skipIndent = null; // отступ вложенного блока, который пропускается

  for (const line of body) {
    if (skipIndent !== null) {
      if (line.indent > skipIndent) continue;
      skipIndent = null;
    }
    if (/^(?:async\s+def|def|class)\b/.test(line.masked)) {
      skipIndent = line.indent;
      continue;
    }
    for (const match of line.masked.matchAll(/\breturn\b([^;]*)/g)) {
      const value = match[1].trim();
      if (value !== '' && value !== 'None') returns = true;
    }
    if (/\byield\b/.test(line.masked)) yields = true;
    for (const match of line.masked.matchAll(/\braise\s+([\p{L}_][\p{L}\p{N}_.]*)/gu)) {
      // имя класса исключения начинается с заглавной буквы: raise err не считается
      if (/^\p{Lu}/u.test(match[1].split('.').pop())) raises.add(match[1]);
    }
  }
  return { returns, yields, raises: [...raises] };
}

/**
 * Находит все функции файла.
 * @param {string[]} lines Физические строки файла.
 * @returns {object[]} Функции в порядке объявления.
 */
function parseFunctions(lines) {
  const logical = toLogicalLines(lines);
  const functions = [];
  const blocks = []; // стек объемлющих def и class
  let decorators = [];

  logical.forEach((line, index) => {
    while (blocks.length && blocks[blocks.length - 1].indent >= line.indent) blocks.pop();

    if (line.masked.startsWith('@')) {
      decorators.push(line);
      return;
    }

    if (/^class\b/.test(line.masked)) {
      blocks.push({ indent: line.indent, kind: 'class' });
    } else if (/^(?:async\s+)?def\b/.test(line.masked)) {
      const signature = parseSignature(line);
      if (signature) {
        let last = index + 1;
        while (last < logical.length && logical[last].indent > line.indent) last += 1;
        const body = signature.inline ? [] : logical.slice(index + 1, last);

        const parent = blocks[blocks.length - 1];
        const isStatic = decorators.some((d) => /^@\s*staticmethod\b/.test(d.masked));
        let { params } = signature;
        if (parent && parent.kind === 'class' && !isStatic
            && params.length && ['self', 'cls'].includes(params[0].name)) {
          params = params.slice(1);
        }

        functions.push({
          ...signature,
          ...analyzeBody(body),
          params,
          header: line,
          body,
          startLine: decorators.length ? decorators[0].start : line.start,
          endLine: body.length ? body[body.length - 1].end : line.end,
        });
      }
      blocks.push({ indent: line.indent, kind: 'def' });
    }
    decorators = [];
  });

  return functions;
}

/**
 * Находит самую внутреннюю функцию, содержащую строку курсора.
 * @param {object[]} functions Результат parseFunctions.
 * @param {number} line Номер строки курсора.
 * @returns {?object} Найденная функция или null.
 */
function findFunctionAt(functions, line) {
  let found = null;
  for (const fn of functions) {
    if (fn.startLine <= line && line <= fn.endLine) found = fn;
  }
  return found;
}

module.exports = { toLogicalLines, splitTopLevel, parseFunctions, findFunctionAt };
