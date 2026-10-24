# Compare

A Windows desktop app for comparing two things side by side and highlighting what changed.

- **Documents** – plain text, Word (`.docx`) and PDF. Changes are marked line by line and word by word.
- **Spreadsheets** – Excel (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`), OpenDocument (`.ods`) and CSV/TSV, compared cell by cell and sheet by sheet.
- **Files** – any two files, checked by their SHA-256 checksums to see if they're identical.

You can paste text or open files, ignore case or whitespace, show only the differences, and jump between changes with F8 / Shift+F8. Light, dark and OLED-black themes are included.

## Download

Get the latest version from the [Releases](../../releases) page:

- `Compare-Setup-x.x.x.exe` – installer
- `Compare-Portable-x.x.x.exe` – runs without installing

The app isn't code-signed, so Windows SmartScreen may warn you the first time you run it. Click **More info → Run anyway**.

## Building from source

Requires [Node.js](https://nodejs.org/).

```
npm install
npm start                # run the app
npm test                 # run the tests
npm run dist:installer   # build the installer and portable exe into dist/
```
