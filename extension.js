import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SNIPPET_FILE_NAME = 'snippets.txt';
const SNIPPET_MARKER = /^%%snippet(?::\s*(.+?))?%%\s*$/;
const PASTE_DELAY_MS = 120;

function buildSnippetFilePath(extensionPath) {
    return GLib.build_filenamev([extensionPath, SNIPPET_FILE_NAME]);
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
            title: currentTitle || `Snippet ${snippets.length + 1}`,
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

class SnippetPickerIndicator extends PanelMenu.Button {
    constructor(extension) {
        super(0.0, 'Snippet Picker', false);

        this._extension = extension;
        this._pasteTimeoutId = null;

        const label = new St.Label({
            text: 'Snip',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(label);

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._reloadMenu();
            }
        });
    }

    _reloadMenu() {
        this.menu.removeAll();

        let snippets;
        try {
            const snippetPath = buildSnippetFilePath(this._extension.path);
            const file = Gio.File.new_for_path(snippetPath);
            const [, bytes] = file.load_contents(null);
            const contents = new TextDecoder().decode(bytes);
            snippets = parseSnippets(contents);
        } catch (error) {
            logError(error, 'Failed to load snippets');
            this._appendMessageItem('スニペットファイルを読めませんでした');
            return;
        }

        if (snippets.length === 0) {
            this._appendMessageItem('候補がありません');
            return;
        }

        for (const snippet of snippets) {
            const item = new PopupMenu.PopupMenuItem(snippet.title);
            item.connect('activate', () => {
                this._copyAndPaste(snippet);
            });
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._appendMessageItem(`ファイル: ${buildSnippetFilePath(this._extension.path)}`);
    }

    _appendMessageItem(message) {
        const item = new PopupMenu.PopupMenuItem(message, {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(item);
    }

    _copyAndPaste(snippet) {
        St.Clipboard.get_default().set_text(
            St.ClipboardType.CLIPBOARD,
            snippet.body
        );

        this.menu.close();

        if (this._pasteTimeoutId !== null) {
            GLib.Source.remove(this._pasteTimeoutId);
            this._pasteTimeoutId = null;
        }

        Main.notify('Snippet Picker', `コピーしました: ${snippet.title}`);

        this._pasteTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PASTE_DELAY_MS,
            () => {
                this._pasteTimeoutId = null;
                this._tryPaste();
                return GLib.SOURCE_REMOVE;
            }
        );
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
        } catch (error) {
            logError(error, 'Automatic paste failed');
            Main.notify(
                'Snippet Picker',
                '自動貼り付けに失敗しました。クリップボードにはコピー済みです。'
            );
        }
    }

    destroy() {
        if (this._pasteTimeoutId !== null) {
            GLib.Source.remove(this._pasteTimeoutId);
            this._pasteTimeoutId = null;
        }

        super.destroy();
    }
}

export default class SnippetPickerExtension extends Extension {
    enable() {
        this._indicator = new SnippetPickerIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
