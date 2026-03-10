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
const KEY_SHOW_NOTIFICATIONS = 'show-notifications';

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
        const _ = this.gettext.bind(this);
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
            label: _('Open the menu with a shortcut, search, and press Enter to paste.'),
            wrap: true,
            xalign: 0,
        }));

        const keybinding = createKeybindingWidget(settings);
        addKeybinding(
            keybinding.model,
            settings,
            KEYBINDING_TOGGLE_PICKER,
            _('Open Topbar Snips')
        );
        main.append(keybinding.treeView);

        main.append(new Gtk.Label({
            label: _('Use the Up and Down keys to choose a snippet, then press Enter.'),
            wrap: true,
            xalign: 0,
        }));

        const keyboardGroup = new Adw.PreferencesGroup({
            title: _('Keyboard'),
        });
        keyboardGroup.add(main);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
        });
        const copyRow = new Adw.SwitchRow({
            title: _('Keep snippet in clipboard after activation'),
            subtitle: _('When off, the clipboard is swapped temporarily for pasting and restored after Ctrl+V is sent.'),
        });
        settings.bind(
            KEY_KEEP_CLIPBOARD_CONTENT,
            copyRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        behaviorGroup.add(copyRow);

        const notificationRow = new Adw.SwitchRow({
            title: _('Show notifications'),
            subtitle: _('Show notifications for copy, paste, deletion, and file opening actions.'),
        });
        settings.bind(
            KEY_SHOW_NOTIFICATIONS,
            notificationRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        behaviorGroup.add(notificationRow);

        const page = new Adw.PreferencesPage();
        page.add(keyboardGroup);
        page.add(behaviorGroup);

        window.set_default_size(560, 320);
        window.add(page);
    }
}
