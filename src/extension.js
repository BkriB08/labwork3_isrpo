'use strict';

/**
 * @file Точка входа расширения: связывает команды VS Code с генератором.
 */

const vscode = require('vscode');
const { documentAt, documentAll } = require('./docstring');

/**
 * Читает все строки документа.
 * @param {import('vscode').TextDocument} document Открытый документ.
 * @returns {string[]} Строки без символов перевода строки.
 */
function readLines(document) {
  return Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
}

/**
 * Читает настройки расширения.
 * @returns {{todo: string}} Настройки генерации.
 */
function readOptions() {
  const config = vscode.workspace.getConfiguration('docstringGenerator');
  return { todo: config.get('placeholder', 'TODO') };
}

/**
 * Вносит правки в редактор одной операцией (отменяется одним Ctrl+Z).
 * @param {import('vscode').TextEditor} editor Активный редактор.
 * @param {object[]} edits Правки из модуля docstring.
 * @returns {Thenable<boolean>} true, если изменения применены.
 */
function applyToEditor(editor, edits) {
  const { document } = editor;
  const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  return editor.edit((builder) => {
    for (const edit of edits) {
      const text = edit.newLines.join(eol);
      if (edit.deleteCount > 0) {
        const last = edit.start + edit.deleteCount - 1;
        const range = new vscode.Range(edit.start, 0, last, document.lineAt(last).text.length);
        builder.replace(range, text);
      } else {
        // вставка в конец предыдущей строки работает и на последней строке файла
        const previous = edit.start - 1;
        const position = new vscode.Position(previous, document.lineAt(previous).text.length);
        builder.insert(position, eol + text);
      }
    }
  });
}

/**
 * Возвращает активный редактор с файлом Python и предупреждает, если его нет.
 * @returns {?import('vscode').TextEditor} Редактор или null.
 */
function pythonEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'python') {
    vscode.window.showWarningMessage('Откройте файл Python.');
    return null;
  }
  return editor;
}

/**
 * Команда: создать или обновить docstring функции под курсором.
 * @returns {Promise<void>}
 */
async function generateCurrent() {
  const editor = pythonEditor();
  if (!editor) return;
  try {
    const { fn, edit } = documentAt(readLines(editor.document), editor.selection.active.line, readOptions());
    if (!fn) {
      vscode.window.showWarningMessage('Поставьте курсор внутрь функции.');
      return;
    }
    if (!edit) {
      vscode.window.showInformationMessage(`Документация функции ${fn.name} актуальна.`);
      return;
    }
    if (!(await applyToEditor(editor, [edit]))) {
      vscode.window.showErrorMessage('Не удалось изменить файл.');
      return;
    }
    const notes = [];
    if (edit.updated && edit.added.length) notes.push(`добавлены: ${edit.added.join(', ')}`);
    if (edit.removed.length) notes.push(`удалены: ${edit.removed.join(', ')}`);
    const action = edit.updated ? 'обновлена' : 'создана';
    const details = notes.length ? ` Параметры ${notes.join('; ')}.` : '';
    vscode.window.showInformationMessage(`Документация функции ${fn.name} ${action}.${details}`);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

/**
 * Команда: задокументировать все функции файла.
 * @returns {Promise<void>}
 */
async function generateAll() {
  const editor = pythonEditor();
  if (!editor) return;
  const { edits, skipped } = documentAll(readLines(editor.document), readOptions());
  if (edits.length && !(await applyToEditor(editor, edits))) {
    vscode.window.showErrorMessage('Не удалось изменить файл.');
    return;
  }
  const note = skipped.length ? ` Пропущено: ${skipped.join(' ')}` : '';
  vscode.window.showInformationMessage(`Изменено функций: ${edits.length}.${note}`);
}

/**
 * Вызывается VS Code при активации расширения.
 * @param {import('vscode').ExtensionContext} context Контекст расширения.
 * @returns {void}
 */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('docstringGenerator.generate', generateCurrent),
    vscode.commands.registerCommand('docstringGenerator.generateAll', generateAll),
  );
}

/**
 * Вызывается при отключении расширения. Освобождать нечего.
 * @returns {void}
 */
function deactivate() {}

module.exports = { activate, deactivate };
