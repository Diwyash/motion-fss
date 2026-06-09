This is a custom UI extension for Chrome fullscreen mode.

## Development

Install dependencies:

```bash
npm install
```

Build the unpacked extension:

```bash
npm run build
```

For development builds that rebuild on file changes:

```bash
npm run dev
```

Load the generated `dist` folder in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this project's `dist` folder.

The extension registers `Alt+W` as the suggested shortcut for toggling the overlay in the active tab. If Chrome does not assign it automatically, open `chrome://extensions/shortcuts` and set the shortcut for "Toggle the Motion FSS overlay".
