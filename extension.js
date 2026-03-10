import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const DEFAULT_SNIPPET_FILE_NAME = 'snippets.txt';
const USER_SNIPPET_FILE_NAME = 'snippets.local.txt';
const SNIPPET_MARKER = /^%%snippet(?::\s*(.+?))?%%\s*$/;
const PASTE_DELAY_MS = 120;
const CLIPBOARD_RESTORE_DELAY_MS = 80;
const KEYBINDING_TOGGLE_PICKER = 'toggle-picker';
const KEY_KEEP_CLIPBOARD_CONTENT = 'copy-on-activate';
const KEY_SHOW_NOTIFICATIONS = 'show-notifications';

function buildDefaultSnippetFilePath(extensionPath) {
    return GLib.build_filenamev([extensionPath, DEFAULT_SNIPPET_FILE_NAME]);
}

function buildUserSnippetFilePath(extensionPath) {
    return GLib.build_filenamev([extensionPath, USER_SNIPPET_FILE_NAME]);
}

function fileExists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

function getSnippetFilePathForRead(extensionPath) {
    const userPath = buildUserSnippetFilePath(extensionPath);
    if (fileExists(userPath)) {
        return userPath;
    }

    return buildDefaultSnippetFilePath(extensionPath);
}

function ensureUserSnippetFile(extensionPath) {
    const userPath = buildUserSnippetFilePath(extensionPath);
    if (fileExists(userPath)) {
        return userPath;
    }

    const defaultPath = buildDefaultSnippetFilePath(extensionPath);
    const defaultFile = Gio.File.new_for_path(defaultPath);
    const userFile = Gio.File.new_for_path(userPath);

    defaultFile.copy(userFile, Gio.FileCopyFlags.NONE, null, null);
    return userPath;
}

function parseSnippets(contents) {
    const snippets = [];
    const lines = contents.split(/\r?\n/);
    let currentTitle = null;
    let currentLines = null;

    const pushCurrent = () => {
        if (currentLines === null) {
            return;
        }

        const body = currentLines.join('\n').replace(/\n+$/, '');

        if (body.length === 0) {
            currentLines = null;
            currentTitle = null;
            return;
        }

        snippets.push({
            id: snippets.length,
            title: currentTitle || `Snippet ${snippets.length + 1}`,
            markerTitle: currentTitle,
            body,
        });

        currentLines = null;
        currentTitle = null;
    };

    for (const line of lines) {
        const match = line.match(SNIPPET_MARKER);

        if (match) {
            pushCurrent();
            currentTitle = match[1]?.trim() || null;
            currentLines = [];
            continue;
        }

        if (currentLines !== null) {
            currentLines.push(line);
        }
    }

    pushCurrent();
    return snippets;
}

function serializeSnippets(snippets) {
    return snippets.map(snippet => {
        const header = snippet.markerTitle
            ? `%%snippet: ${snippet.markerTitle}%%`
            : '%%snippet%%';
        return `${header}\n${snippet.body}`;
    }).join('\n\n');
}

function loadSnippets(extensionPath) {
    const snippetPath = getSnippetFilePathForRead(extensionPath);
    const file = Gio.File.new_for_path(snippetPath);
    const [, bytes] = file.load_contents(null);
    const contents = new TextDecoder().decode(bytes);

    return {
        snippetPath,
        snippets: parseSnippets(contents),
    };
}

function saveSnippets(extensionPath, snippets) {
    const snippetPath = ensureUserSnippetFile(extensionPath);
    const contents = serializeSnippets(snippets);

    GLib.file_set_contents(snippetPath, contents);
}

function openSnippetFile(extensionPath) {
    const snippetPath = ensureUserSnippetFile(extensionPath);
    const file = Gio.File.new_for_path(snippetPath);
    const uri = file.get_uri();

    Gio.AppInfo.launch_default_for_uri(uri, null);

    return snippetPath;
}

class SnippetPickerIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Snippet Picker', false);

        this._extension = extension;
        this._pasteTimeoutId = null;
        this._clipboardRestoreTimeoutId = null;
        this._searchFocusTimeoutId = null;
        this._focusSearchOnOpen = false;
        this._filterText = '';
        this._filteredSnippets = [];
        this._selectedSnippetIndex = 0;
        this._searchEntry = null;
        this._snippetItems = [];
        this._auxiliaryItems = [];

        const box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });
        box.add_child(new St.Label({
            text: 'Snip',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(box);

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._reloadMenu();
                if (this._focusSearchOnOpen) {
                    this._scheduleSearchFocus();
                }
            } else {
                this._focusSearchOnOpen = false;
                this._filterText = '';
                this._filteredSnippets = [];
                this._selectedSnippetIndex = 0;
            }
        });

        this._reloadMenu();
    }

    openPicker() {
        this._focusSearchOnOpen = true;
        this.menu.open(true);
        this._reloadMenu();
        this._scheduleSearchFocus();
    }

    _appendMessageItem(message) {
        const item = new PopupMenu.PopupMenuItem(message, {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(item);
    }

    _tryPaste() {
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            const keyboard = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE
            );
            const timestamp = Clutter.get_current_event_time();

            keyboard.notify_keyval(timestamp, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(timestamp, Clutter.KEY_v, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(timestamp, Clutter.KEY_v, Clutter.KeyState.RELEASED);
            keyboard.notify_keyval(timestamp, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            return true;
        } catch (error) {
            logError(error, 'Automatic paste failed');
            this._extension.notify(
                'Snippet Picker',
                '自動貼り付けに失敗しました。クリップボードにはコピー済みです。'
            );
            return false;
        }
    }

    _copyAndPaste(snippet) {
        const clipboard = St.Clipboard.get_default();
        const keepClipboardContent = this._extension.shouldKeepClipboardContent();

        clipboard.get_text(
            St.ClipboardType.CLIPBOARD,
            (_clipboard, previousText) => {
                clipboard.set_text(
                    St.ClipboardType.CLIPBOARD,
                    snippet.body
                );

                this.menu.close();

                if (this._pasteTimeoutId !== null) {
                    GLib.Source.remove(this._pasteTimeoutId);
                    this._pasteTimeoutId = null;
                }

                if (this._clipboardRestoreTimeoutId !== null) {
                    GLib.Source.remove(this._clipboardRestoreTimeoutId);
                    this._clipboardRestoreTimeoutId = null;
                }

                this._extension.notify(
                    'Snippet Picker',
                    keepClipboardContent
                        ? `コピーしました: ${snippet.title}`
                        : `貼り付けを試みます: ${snippet.title}`
                );

                this._pasteTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    PASTE_DELAY_MS,
                    () => {
                        this._pasteTimeoutId = null;
                        const pasteTriggered = this._tryPaste();

                        if (!keepClipboardContent && pasteTriggered) {
                            this._clipboardRestoreTimeoutId = GLib.timeout_add(
                                GLib.PRIORITY_DEFAULT,
                                CLIPBOARD_RESTORE_DELAY_MS,
                                () => {
                                    this._clipboardRestoreTimeoutId = null;
                                    clipboard.set_text(
                                        St.ClipboardType.CLIPBOARD,
                                        previousText ?? ''
                                    );
                                    return GLib.SOURCE_REMOVE;
                                }
                            );
                        }

                        return GLib.SOURCE_REMOVE;
                    }
                );
            }
        );
    }

    _scheduleSearchFocus() {
        if (!this._searchEntry) {
            return;
        }

        if (this._searchFocusTimeoutId !== null) {
            GLib.Source.remove(this._searchFocusTimeoutId);
            this._searchFocusTimeoutId = null;
        }

        this._searchFocusTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            1,
            () => {
                this._searchFocusTimeoutId = null;

                if (!this._searchEntry) {
                    return GLib.SOURCE_REMOVE;
                }

                global.stage.set_key_focus(this._searchEntry);
                const clutterText = this._searchEntry.get_clutter_text();
                clutterText.set_cursor_position(-1);
                clutterText.set_selection(0, 0);

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _setSelectedSnippetIndex(index) {
        if (this._filteredSnippets.length === 0) {
            this._selectedSnippetIndex = 0;
            return;
        }

        const lastIndex = this._filteredSnippets.length - 1;
        this._selectedSnippetIndex = Math.min(Math.max(index, 0), lastIndex);
    }

    _updateSelectionHighlight() {
        for (const [index, item] of this._snippetItems.entries()) {
            if (index === this._selectedSnippetIndex) {
                item.add_style_class_name('snippet-picker-item-selected');
            } else {
                item.remove_style_class_name('snippet-picker-item-selected');
            }
        }
    }

    _focusMenuItem(item) {
        if (!item) {
            return;
        }

        const actor = item.actor ?? item;
        actor.grab_key_focus();
    }

    _focusFirstKeyboardTarget() {
        if (this._snippetItems.length > 0) {
            this._focusMenuItem(this._snippetItems[this._selectedSnippetIndex]);
            return;
        }

        this._focusMenuItem(this._auxiliaryItems[0] ?? null);
    }

    _moveSelection(offset) {
        if (this._filteredSnippets.length === 0) {
            return;
        }

        const count = this._filteredSnippets.length;
        const nextIndex = this._selectedSnippetIndex + offset;
        this._selectedSnippetIndex = (nextIndex + count) % count;
        this._updateSelectionHighlight();
    }

    _activateSelection() {
        const snippet = this._filteredSnippets[this._selectedSnippetIndex];
        if (!snippet) {
            return;
        }

        this._copyAndPaste(snippet);
    }

    _handleSearchKeyPress(event) {
        const keyval = event.get_key_symbol();

        switch (keyval) {
        case Clutter.KEY_Up:
            this._moveSelection(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            this._activateSelection();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._focusFirstKeyboardTarget();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            this.menu.close();
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _appendSearchSection() {
        const entry = new St.Entry({
            name: 'snippet-picker-search-entry',
            style_class: 'search-entry',
            can_focus: true,
            hint_text: 'スニペットを検索…',
            track_hover: true,
            x_expand: true,
            y_expand: true,
        });
        entry.set_text(this._filterText);

        const clutterText = entry.get_clutter_text();
        clutterText.connect('text-changed', () => {
            this._filterText = entry.get_text();
            this._selectedSnippetIndex = 0;
            this._reloadMenu();
            this._scheduleSearchFocus();
        });
        clutterText.connect('key-press-event', (_actor, event) => {
            return this._handleSearchKeyPress(event);
        });

        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.add_child(entry);
        this.menu.addMenuItem(item);

        this._searchEntry = entry;
    }

    _filterSnippets(snippets) {
        const query = this._filterText.trim().toLocaleLowerCase();

        if (query.length === 0) {
            return snippets;
        }

        return snippets.filter(snippet => {
            const haystack = `${snippet.title}\n${snippet.body}`.toLocaleLowerCase();
            return haystack.includes(query);
        });
    }

    _deleteSnippet(snippet) {
        try {
            const {snippets} = loadSnippets(this._extension.path);
            const nextSnippets = snippets.filter(
                currentSnippet => currentSnippet.id !== snippet.id
            );

            if (nextSnippets.length === snippets.length) {
                this._extension.notify(
                    'Snippet Picker',
                    `削除対象が見つかりませんでした: ${snippet.title}`
                );
                this._reloadMenu();
                return;
            }

            saveSnippets(this._extension.path, nextSnippets);
            this._extension.notify('Snippet Picker', `削除しました: ${snippet.title}`);
            this._reloadMenu();
        } catch (error) {
            logError(error, 'Failed to delete snippet');
            this._extension.notify(
                'Snippet Picker',
                `削除に失敗しました: ${snippet.title}`
            );
        }
    }

    _appendDeleteSection(snippets) {
        if (snippets.length === 0) {
            return;
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const deleteSection = new PopupMenu.PopupSubMenuMenuItem('削除…');
        this.menu.addMenuItem(deleteSection);
        this._auxiliaryItems.push(deleteSection);

        for (const snippet of snippets) {
            const item = new PopupMenu.PopupMenuItem(snippet.title);
            item.connect('activate', () => {
                this._deleteSnippet(snippet);
            });
            deleteSection.menu.addMenuItem(item);
        }
    }

    _appendManageSection(snippetPath) {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const editItem = new PopupMenu.PopupMenuItem('snippets.txt を開く');
        editItem.connect('activate', () => {
            try {
                const openedPath = openSnippetFile(this._extension.path);
                this._extension.notify('Snippet Picker', `開きました: ${openedPath}`);
            } catch (error) {
                logError(error, 'Failed to open snippet file');
                this._extension.notify(
                    'Snippet Picker',
                    `snippets.txt を開けませんでした: ${snippetPath}`
                );
            }
        });
        this.menu.addMenuItem(editItem);
        this._auxiliaryItems.push(editItem);

        const preferencesItem = new PopupMenu.PopupMenuItem('環境設定を開く');
        preferencesItem.connect('activate', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(preferencesItem);
        this._auxiliaryItems.push(preferencesItem);
    }

    _reloadMenu() {
        this.menu.removeAll();
        this._searchEntry = null;
        this._snippetItems = [];
        this._auxiliaryItems = [];

        const snippetPath = getSnippetFilePathForRead(this._extension.path);
        let snippets;
        try {
            ({snippets} = loadSnippets(this._extension.path));
        } catch (error) {
            logError(error, 'Failed to load snippets');
            this._appendMessageItem('スニペットファイルを読めませんでした');
            this._appendManageSection(snippetPath);
            return;
        }

        this._appendSearchSection();

        this._filteredSnippets = this._filterSnippets(snippets);
        this._setSelectedSnippetIndex(this._selectedSnippetIndex);

        if (snippets.length === 0) {
            this._appendMessageItem('候補がありません');
            this._appendManageSection(snippetPath);
            return;
        }

        if (this._filteredSnippets.length === 0) {
            this._appendMessageItem('該当する候補がありません');
            this._appendDeleteSection(snippets);
            this._appendManageSection(snippetPath);
            return;
        }

        for (const [index, snippet] of this._filteredSnippets.entries()) {
            const item = new PopupMenu.PopupMenuItem(snippet.title);
            item.setOrnament(PopupMenu.Ornament.NONE);
            if (item._ornamentLabel) {
                item._ornamentLabel.hide();
                item._ornamentLabel.set_width(0);
            }
            item.connect('activate', () => {
                this._copyAndPaste(snippet);
            });
            item.connect('key-focus-in', () => {
                this._selectedSnippetIndex = index;
                this._updateSelectionHighlight();
            });
            item.add_style_class_name('snippet-picker-item');
            this._snippetItems.push(item);
            this.menu.addMenuItem(item);
        }
        this._updateSelectionHighlight();

        this._appendDeleteSection(snippets);
        this._appendManageSection(snippetPath);
    }

    destroy() {
        if (this._searchFocusTimeoutId !== null) {
            GLib.Source.remove(this._searchFocusTimeoutId);
            this._searchFocusTimeoutId = null;
        }

        if (this._pasteTimeoutId !== null) {
            GLib.Source.remove(this._pasteTimeoutId);
            this._pasteTimeoutId = null;
        }

        if (this._clipboardRestoreTimeoutId !== null) {
            GLib.Source.remove(this._clipboardRestoreTimeoutId);
            this._clipboardRestoreTimeoutId = null;
        }

        super.destroy();
    }
}

const SnippetPickerIndicatorObj = GObject.registerClass(SnippetPickerIndicator);

function createIndicator(extension) {
    return new SnippetPickerIndicatorObj(extension);
}

export default class SnippetPickerExtension extends Extension {
    shouldKeepClipboardContent() {
        return this._settings?.get_boolean(KEY_KEEP_CLIPBOARD_CONTENT) ?? false;
    }

    shouldShowNotifications() {
        return this._settings?.get_boolean(KEY_SHOW_NOTIFICATIONS) ?? false;
    }

    notify(title, message) {
        if (!this.shouldShowNotifications()) {
            return;
        }

        Main.notify(title, message);
    }

    enable() {
        this._settings = this.getSettings();
        this._indicator = createIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        const mode = Shell.hasOwnProperty('ActionMode')
            ? Shell.ActionMode
            : Shell.KeyBindingMode;

        Main.wm.addKeybinding(
            KEYBINDING_TOGGLE_PICKER,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            mode.ALL,
            () => {
                this._indicator?.openPicker();
            }
        );
    }

    disable() {
        Main.wm.removeKeybinding(KEYBINDING_TOGGLE_PICKER);

        if (this._indicator?._pasteTimeoutId !== null) {
            GLib.Source.remove(this._indicator._pasteTimeoutId);
            this._indicator._pasteTimeoutId = null;
        }

        if (this._indicator?._clipboardRestoreTimeoutId !== null) {
            GLib.Source.remove(this._indicator._clipboardRestoreTimeoutId);
            this._indicator._clipboardRestoreTimeoutId = null;
        }

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
