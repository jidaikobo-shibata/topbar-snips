import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const COLUMN_ID = 0;
const COLUMN_DESCRIPTION = 1;
const COLUMN_KEY = 2;
const COLUMN_MODS = 3;
const KEYBINDING_TOGGLE_PICKER = 'toggle-picker';
const KEY_KEEP_CLIPBOARD_CONTENT = 'copy-on-activate';

function addKeybinding(model, settings, id, description) {
    const accelerators = settings.get_strv(id);
    const accelerator = accelerators.length > 0 ? accelerators[0] : null;
    let key;
    let mods;

    if (accelerator === null || accelerator === '') {
        [key, mods] = [0, 0];
    } else {
        [, key, mods] = Gtk.accelerator_parse(accelerator);
    }

    const row = model.insert(100);
    model.set(
        row,
        [COLUMN_ID, COLUMN_DESCRIPTION, COLUMN_KEY, COLUMN_MODS],
        [id, description, key, mods]
    );
}

function createKeybindingWidget(settings) {
    const model = new Gtk.ListStore();
    model.set_column_types([
        GObject.TYPE_STRING,
        GObject.TYPE_STRING,
        GObject.TYPE_INT,
        GObject.TYPE_INT,
    ]);

    const treeView = new Gtk.TreeView({
        model,
        headers_visible: false,
        hexpand: true,
        vexpand: false,
    });

    let renderer = new Gtk.CellRendererText();
    let column = new Gtk.TreeViewColumn();
    column.expand = true;
    column.pack_start(renderer, true);
    column.add_attribute(renderer, 'text', COLUMN_DESCRIPTION);
    treeView.append_column(column);

    renderer = new Gtk.CellRendererAccel({
        editable: true,
        accel_mode: Gtk.CellRendererAccelMode.GTK,
    });
    renderer.connect('accel-edited', (_renderer, path, key, mods) => {
        const [ok, iter] = model.get_iter_from_string(path);
        if (!ok) {
            return;
        }

        model.set(iter, [COLUMN_KEY, COLUMN_MODS], [key, mods]);

        const id = model.get_value(iter, COLUMN_ID);
        settings.set_strv(id, [Gtk.accelerator_name(key, mods)]);
    });
    renderer.connect('accel-cleared', (_renderer, path) => {
        const [ok, iter] = model.get_iter_from_string(path);
        if (!ok) {
            return;
        }

        model.set(iter, [COLUMN_KEY, COLUMN_MODS], [0, 0]);

        const id = model.get_value(iter, COLUMN_ID);
        settings.set_strv(id, []);
    });

    column = new Gtk.TreeViewColumn();
    column.pack_end(renderer, false);
    column.add_attribute(renderer, 'accel-key', COLUMN_KEY);
    column.add_attribute(renderer, 'accel-mods', COLUMN_MODS);
    treeView.append_column(column);

    return {model, treeView};
}

export default class SnippetPickerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const main = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });

        main.append(new Gtk.Label({
            label: 'ショートカットでメニューを開き、検索して Enter で貼り付けできます。',
            wrap: true,
            xalign: 0,
        }));

        const keybinding = createKeybindingWidget(settings);
        addKeybinding(
            keybinding.model,
            settings,
            KEYBINDING_TOGGLE_PICKER,
            'スニペット選択メニューを開く'
        );
        main.append(keybinding.treeView);

        main.append(new Gtk.Label({
            label: '上向き/下向きキーで候補を選び、Enter で確定します。',
            wrap: true,
            xalign: 0,
        }));

        const keyboardGroup = new Adw.PreferencesGroup({
            title: 'キーボード',
        });
        keyboardGroup.add(main);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: '動作',
        });
        const copyRow = new Adw.SwitchRow({
            title: '確定後もクリップボードに残す',
            subtitle: 'OFF のときは貼り付け用に一時差し替えし、Ctrl+V 送出後に元へ戻します。',
        });
        settings.bind(
            KEY_KEEP_CLIPBOARD_CONTENT,
            copyRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        behaviorGroup.add(copyRow);

        const page = new Adw.PreferencesPage();
        page.add(keyboardGroup);
        page.add(behaviorGroup);

        window.set_default_size(560, 320);
        window.add(page);
    }
}
