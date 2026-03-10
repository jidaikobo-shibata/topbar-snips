# Topbar Snips

Topbar Snips is a GNOME Shell extension for picking text snippets from the top bar, copying them to the clipboard, and attempting automatic paste when possible.

## Features

- Open the picker from the top bar or a keyboard shortcut
- Filter snippets incrementally from a search entry
- Press `Enter` to copy a snippet and try `Ctrl+V`
- Edit snippets in a plain text file
- Optional notifications and clipboard restore behavior
- Japanese translations included

## Requirements

- GNOME Shell 45, 46, 47, or 48

## Installation

1. Place this directory at:
   `~/.local/share/gnome-shell/extensions/topbar-snips@jidaikobo.shibata`
2. Compile the schema:

```bash
glib-compile-schemas \
  ~/.local/share/gnome-shell/extensions/topbar-snips@jidaikobo.shibata/schemas
```

3. If needed, compile the Japanese translation catalog:

```bash
msgfmt \
  ~/.local/share/gnome-shell/extensions/topbar-snips@jidaikobo.shibata/locale/ja/LC_MESSAGES/topbar-snips.po \
  -o \
  ~/.local/share/gnome-shell/extensions/topbar-snips@jidaikobo.shibata/locale/ja/LC_MESSAGES/topbar-snips.mo
```

4. Log out and log back in if GNOME Shell does not detect the extension immediately.
5. Enable the extension from Extensions or with:

```bash
gnome-extensions enable topbar-snips@jidaikobo.shibata
```

## Snippet File Format

The bundled file is `snippets.txt`.

When you edit snippets from the extension, it creates and uses `snippets.local.txt`.

Each snippet starts with a marker line:

```text
%%snippet: Greeting%%
Hello world.

%%snippet: Signature%%
Best regards,
Your Name
```

Rules:

- Start each snippet with `%%snippet%%` or `%%snippet: Title%%`
- Text after the marker becomes the snippet body
- Empty snippet bodies are ignored
- `snippets.local.txt` is preferred over `snippets.txt` unless developer mode is enabled and bundled snippets are explicitly selected

## Usage

1. Open the menu from the top bar, or trigger the configured shortcut.
2. Type to filter snippets.
3. Use `Up` and `Down` to move through the results.
4. Press `Enter` to copy the selected snippet and attempt paste.
5. Use the menu action to open the snippet file in your default editor.

## Preferences

- Keyboard shortcut for opening the picker
- Keep snippet in clipboard after activation
- Show notifications
- Developer mode options for checking the bundled `snippets.txt`

## Notes

- Automatic paste is best-effort and depends on the current GNOME session and focused application.
- This extension is intended for local desktop use. Review snippet contents carefully if they may contain sensitive information.

## Development

This extension is built with a 100% Codex-assisted workflow.
From implementation to cleanup and documentation, all development is done through Codex in the local workspace.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
