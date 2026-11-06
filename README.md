# Compare

A Windows desktop app for comparing two things side by side and highlighting what changed.

- **Documents** – plain text, Word (`.docx`) and PDF. Changes are marked line by line and word by word, and Word files and PDFs can also be shown as they look, page by page, with the changes marked on them.
- **Spreadsheets** – Excel (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`), OpenDocument (`.ods`) and CSV/TSV, compared cell by cell and sheet by sheet. Workbooks can also be shown as they look in Excel, formatting and all, with the changes marked on them.
- **Files** – any two files, checked by their checksums to see if they're identical. A single file can be checked against a published MD5, SHA-1, SHA-256 or SHA-512 checksum, for example to verify a download.

You can paste text or open files, ignore case or whitespace, and show only the differences (with a few lines of context around each change). Paragraphs always line up side by side, however many blank lines there are between them: a side with fewer blank lines gets empty space to match the other, and blank lines don't count as differences (a patch file still has them, so it turns one text into the other exactly). Find text in a comparison, jump between changes, and export the result as an HTML report, a patch file (documents) or a CSV list of changed cells (spreadsheets). Light, dark and OLED-black themes are included, documents and spreadsheets shown as they look can be shown on light or dark pages, and the app remembers its window, zoom and settings.

## Opening files

- Drop files onto either side, or use **Open file**. Dropping two files at once fills both sides.
- From Explorer: select one or two files and choose **Send to → Compare** (added by the installer). You can also drop files onto the app's icon, or run `Compare.exe original.docx changed.docx`. Files that aren't documents or spreadsheets are compared by checksum.

## Text or document

When you compare Word files or PDFs, the **Text | Document** switch in the top bar changes how they're shown:

- **Text** shows the lines of both side by side.
- **Document** shows the files themselves, pages and all, with the same changes marked on them: removed and changed words in red on the original, added and changed words in green on the changed one.

Going from change to change (F8) and Find work in both. In the Document view each document scrolls on its own, so the mouse wheel moves only the one it's over (the link button at the bottom right makes them scroll together), and the pages fit the width of the window; zoom with − and + or with Ctrl+mouse wheel over the documents. A side with pasted or typed text is shown as a page of plain text. The app remembers which view you used last.

## Table or sheet

When you compare Excel or OpenDocument workbooks, the **Table | Sheet** switch does the same for spreadsheets:

- **Table** lines up the rows of both side by side.
- **Sheet** shows each spreadsheet as Excel does – column widths, row heights, fonts, fill colors, borders, merged cells and gridlines – with the changes marked on it: rows and cells that changed in red on the original and green on the changed one, and the same for rows and columns only one of them has.

F8, Find, the sheet tabs, scrolling (each sheet on its own, or together with the link button) and zoom work as in the Document view; zoom with − and + or with Ctrl+mouse wheel over the sheets, and click the zoom level to go back to 100%. Rows and columns hidden in a workbook stay hidden, unless something changed in them. Excel files (`.xlsx`, `.xlsm`) show all of their formatting; `.xls`, `.xlsb` and `.ods` files show their column widths, row heights and merged cells. A side with pasted cells or a CSV file is shown as a plain sheet.

## Light or dark pages

The moon button at the bottom right of the Document and Sheet views shows the pages dark, with their colors turned around; click it again for light pages. Pictures in Word files keep their colors. A PDF page is drawn as a single picture, so photos in PDFs come out turned around too. The app remembers the choice.

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
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in / out / reset (Ctrl+mouse wheel works too, and over the Document or Sheet view zooms the documents or sheets) |

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
