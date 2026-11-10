# EasyDocs (Next.js)

Open, edit, save and share PDF, Word, Excel, CSV, text and image files in the browser, or install it as an app on a phone or computer.
Files never leave the device: everything is opened, edited and saved locally.

| File type | What you can do |
|---|---|
| **PDF** | Click any text to change it, add text, erase (white-out), highlight, draw, add pictures and signatures, rotate / reorder / delete / add pages, merge PDFs. Save as PDF, PNG or JPG. |
| **Word (.docx)** | Headings, bold/italic/underline, colours, lists, alignment, links, pictures, tables. Save as .docx, PDF, HTML or text. |
| **Excel (.xlsx, .xls, .ods, .csv, .tsv)** | Multiple sheets, formulas (SUM, AVERAGE, IF, SUMIF, COUNTIF…), insert/delete rows and columns, sort, paste from Excel. Save as .xlsx, .xls, .ods, CSV, TSV or PDF. |
| **Text (.txt, .md, .json, .html, code…)** | Find & replace, JSON formatting. |
| **Images** | Add text, drawings, signatures, white-out. Save as PNG, JPG or PDF. |

## Run

```bash
npm run dev      # development: http://localhost:3000
npm run build && npm start   # production
```

Install as an app and offline mode only work in the production build served over https (or on localhost).

## Deploy

Push to GitHub and import the repo in Vercel (or any host that runs Next.js). No environment variables are needed.

## How it's put together

```
app/
  page.tsx            renders <EasyDocs />
  layout.tsx          title, icons, theme colour
  manifest.ts         app install manifest (/manifest.webmanifest)
  globals.css         Tailwind + EasyDocs styles
components/
  EasyDocs.tsx        page markup; loads the file libraries, then starts the editor
lib/easydocs/
  app.js              open / save / share, home ↔ editor
  pdf.js              PDF + image editor
  word.js, html2docx.js   Word editor and .docx writer
  sheet.js, formula.js    spreadsheet editor and formula engine
  text.js             text editor
  ui.js               toasts, dialogs, save helpers
public/
  vendor/             pdf.js, pdf-lib, mammoth, SheetJS, docx (prebuilt browser files)
  icons/, sw.js       app icons and offline service worker
```

The editors are plain browser JavaScript that work directly with the page's DOM. The React component renders the markup once and then hands control to `lib/easydocs/app.js`.

## Known limits

- PDF text editing covers the old text with a matching-colour box and writes the new text on top in a standard font (Helvetica, Times or Courier). Emoji and non-Latin scripts (e.g. Hindi) can't be written into PDFs yet and become "?".
- Password-protected files can't be edited.
- Word import simplifies headers/footers, comments, tracked changes and complex layouts.
- Excel saves keep values, formulas, sheets and column widths, but not cell colours, fonts or charts.
- Old `.doc` and PowerPoint files aren't supported.
