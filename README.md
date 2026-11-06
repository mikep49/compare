# Compare

A Windows desktop app for comparing two things side by side and highlighting what changed.

- **Documents** – plain text, Word (`.docx`) and PDF. Changes are marked line by line and word by word, and Word files and PDFs can also be shown as they look, page by page, with the changes marked on them.
- **Spreadsheets** – Excel (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`), OpenDocument (`.ods`) and CSV/TSV, compared cell by cell and sheet by sheet.
- **Files** – any two files, checked by their checksums to see if they're identical. A single file can be checked against a published MD5, SHA-1, SHA-256 or SHA-512 checksum, for example to verify a download.

You can paste text or open files, ignore case or whitespace, and show only the differences (with a few lines of context around each change). Find text in a comparison, jump between changes, and export the result as an HTML report, a patch file (documents) or a CSV list of changed cells (spreadsheets). Light, dark and OLED-black themes are included, and the app remembers its window, zoom and settings.

## Opening files

- Drop files onto either side, or use **Open file**. Dropping two files at once fills both sides.
- From Explorer: select one or two files and choose **Send to → Compare** (added by the installer). You can also drop files onto the app's icon, or run `Compare.exe original.docx changed.docx`. Files that aren't documents or spreadsheets are compared by checksum.

## Text or document

When you compare Word files or PDFs, the **Text | Document** switch in the top bar changes how they're shown:

- **Text** shows the lines of both side by side.
- **Document** shows the files themselves, pages and all, with the same changes marked on them: removed and changed words in red on the original, added and changed words in green on the changed one.

Going from change to change (F8) and Find work in both. In the Document view the two documents scroll together (the link button at the bottom right turns that off) and the pages fit the width of the window; zoom with − and + or with Ctrl+mouse wheel over the documents. A side with pasted or typed text is shown as a page of plain text. The app remembers which view you used last.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Enter | Compare / back to editing |
| F8 / Shift+F8 | Next / previous difference |
| Ctrl+F | Find in the comparison |
| Enter / Shift+Enter, F3 / Shift+F3 | Next / previous match |
| Ctrl+S | Export an HTML report |
| Ctrl+1, Ctrl+2, Ctrl+3 | Documents, Spreadsheets, Files |
| Ctrl+B | Collapse or expand the sidebar |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset (Ctrl+mouse wheel works too, and over the Document view zooms the documents) |

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

## Releasing

Set `version` in `package.json`, commit, then push a matching tag:

```
git tag v1.1.0
git push origin v1.1.0
```

GitHub Actions runs the tests, builds the installer and the portable exe, and publishes them as a release. Tests also run on every push to `main` and on pull requests.
