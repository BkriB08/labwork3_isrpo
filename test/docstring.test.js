'use strict';

/** @file Тесты парсера и генератора. Запуск: npm test */

const test = require('node:test');
const assert = require('node:assert');
const { parseFunctions } = require('../src/parser');
const { documentAt, documentAll, applyEdit } = require('../src/docstring');

/** Превращает текст в массив строк. */
const src = (text) => text.split('\n');

/** Применяет все правки файла. */
const full = (lines) => documentAll(lines).edits.reduce(applyEdit, lines);

test('разбирает сложные параметры', () => {
  const [fn] = parseFunctions(src([
    'def f(a: dict[str, int] = {"x": 1, "y": 2},  # комментарий )',
    '      b="),(", *, c=lambda x, y: x, **kw) -> list[int]:',
    '    pass',
  ].join('\n')));
  assert.deepStrictEqual(fn.params.map((p) => p.name), ['a', 'b', 'c', '**kw']);
  assert.strictEqual(fn.params[0].type, 'dict[str, int]');
  assert.strictEqual(fn.params[2].default, 'lambda x, y: x');
  assert.strictEqual(fn.returnType, 'list[int]');
});

test('не учитывает вложенные функции, строки и комментарии', () => {
  const [outer, inner] = parseFunctions(src([
    'def outer():',
    '    text = "return 1"  # raise KeyError',
    '    def inner():',
    '        yield 1',
    '        raise TypeError()',
    '    raise ValueError("x")',
  ].join('\n')));
  assert.strictEqual(outer.returns, false);
  assert.strictEqual(outer.yields, false);
  assert.deepStrictEqual(outer.raises, ['ValueError']);
  assert.strictEqual(inner.yields, true);
});

test('создаёт docstring', () => {
  const lines = src('def add(a: int, b=2):\n    return a + b');
  const { edit } = documentAt(lines, 1);
  assert.deepStrictEqual(applyEdit(lines, edit), [
    'def add(a: int, b=2):',
    '    """TODO: описание функции add.',
    '',
    '    Args:',
    '        a (int): TODO.',
    '        b (int): TODO. По умолчанию 2.',
    '',
    '    Returns:',
    '        TODO.',
    '    """',
    '    return a + b',
  ]);
});

test('обновляет docstring и сохраняет описания', () => {
  const lines = src([
    'def f(a, c):',
    '    """Складывает числа.',
    '',
    '    Подробности.',
    '',
    '    Args:',
    '        a: Первое число,',
    '            может быть дробным.',
    '        b: Старое.',
    '',
    '    Example:',
    '        f(1, 2)',
    '    """',
    '    return a + c',
  ].join('\n'));
  const { edit } = documentAt(lines, 0);
  assert.deepStrictEqual(edit.added, ['c']);
  assert.deepStrictEqual(edit.removed, ['b']);
  const text = applyEdit(lines, edit).join('\n');
  for (const part of ['Складывает числа.', 'Подробности.', 'a: Первое число,', 'может быть дробным.', 'c: TODO.', 'f(1, 2)']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!text.includes('Старое'));
});

test('повторный запуск ничего не меняет', () => {
  const lines = src([
    'class A:',
    '    @staticmethod',
    '    def s(self, x=1.5):',
    '        raise errors.BadInput(x)',
    '',
    '    def g(self):',
    '        yield 1',
    '',
    '    def __init__(self):',
    '        pass',
  ].join('\n'));
  const once = full(lines);
  assert.strictEqual(documentAll(once).edits.length, 0);
});

test('однострочная функция пропускается с пояснением', () => {
  const lines = src('def f(): return 1');
  assert.throws(() => documentAt(lines, 0), /одну строку/);
  assert.strictEqual(documentAll(lines).skipped.length, 1);
});

test('курсор вне функции', () => {
  assert.strictEqual(documentAt(src('x = 1'), 0).fn, null);
});

test('кавычка в конце описания не ломает синтаксис', () => {
  const lines = src('def f():\n    """Печатает "hi" """\n    print("hi")');
  const result = full(lines);
  assert.deepStrictEqual(result.slice(1, 3), ['    """Печатает "hi"', '    """']);
  assert.strictEqual(documentAll(result).edits.length, 0);
});

test('сохраняет описание результата абстрактного метода', () => {
  const lines = src([
    'def area():',
    '    """Площадь.',
    '',
    '    Returns:',
    '        Число.',
    '    """',
    '    raise NotImplementedError',
  ].join('\n'));
  assert.ok(full(lines).join('\n').includes('Число.'));
});

test('преобразует docstring в одинарных кавычках', () => {
  const lines = src('def f(x):\n    "Удваивает число."\n    return x * 2');
  const result = full(lines);
  assert.strictEqual(result[1], '    """Удваивает число.');
  assert.strictEqual(result.filter((l) => l.includes('Удваивает')).length, 1);
});

test('повторный запуск стабилен для docstring с первой пустой строкой', () => {
  const lines = src('def f(x):\n    """\n        Текст\n    ещё\n    """');
  assert.strictEqual(documentAll(full(lines)).edits.length, 0);
});
