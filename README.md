# CV Tailor

A Chrome side panel extension that tailors your LaTeX resume and cover letter to a job description with Gemini, then applies the changes straight into Overleaf. Built with React and TypeScript, featuring keyword gap analysis, word-level diffs, one-click apply (undoable with Ctrl+Z) and PDF export.

## ✨ Features

- **Side Panel**: Stays open next to the job posting and Overleaf as you switch tabs
- **Grab from Page**: Reads the job description from the active tab (LinkedIn, StepStone, Indeed, XING, Greenhouse, Lever, Workday, Personio, JSON-LD, or your text selection)
- **Keyword Analysis**: Sorts the job's keywords into present, missing but supported by your resume, and missing and not supported
- **Match Scores**: A before and after score for how well your resume fits the job
- **Suggestion Cards**: Each change shows a word-level diff with Copy, Skip and Apply, plus Apply all
- **Honest by Design**: Suggestions can only reword what is already in your resume. Invented metrics, skills and unsupported keywords are dropped automatically
- **Add as Skill**: Click a keyword chip to add a skill you really have to your extra facts
- **Cover Letter**: Generates a LaTeX letter from your base letter, with tone (formal, friendly, …) and language (auto, German, English) selectors
- **Overleaf Integration**: Pull your resume and letter from Overleaf and apply changes as editor transactions, so Ctrl+Z works. Resume and cover letter can live in different projects
- **Build PDF**: Writes the tailored version into Overleaf, compiles and downloads the PDF, then restores your master automatically
- **Safe Restore**: A backup is saved before every PDF build. If anything is interrupted, a banner offers Restore now
- **File Naming**: Patterns such as `Murtaza_Dhariwala_Lebenslauf_{company}`, with legal forms dropped and umlauts transliterated
- **Privacy Controls**: Email, phone and address are redacted before anything is sent to Gemini
- **New Job**: One button clears the job, analysis, suggestions and cover letter draft for the next application
- **Configurable Model**: Pick any Gemini model, including a "Show available models" list
- **Bring Your Own Key**: Your Gemini API key is stored only in your browser

## 🚀 Tech Stack

- **Frontend**: React 18, TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui-style components (Radix Slot, class-variance-authority)
- **Validation**: Zod
- **Diffs**: `diff`
- **Icons**: Lucide React
- **Tests**: Vitest, jsdom
- **Extension Platform**: Chrome Manifest V3 with the Side Panel API
- **AI**: Google Gemini API

## 📦 Installation

### Prerequisites

- Node.js 20+
- npm
- Google Chrome 114+ (required for the Side Panel API)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### Setup

1. **Install dependencies**

   ```bash
   npm install --legacy-peer-deps
   ```

2. **Build the extension**

   ```bash
   npm run build
   ```

   This creates a `dist/` folder containing the extension.

3. **Load it into Chrome**

   - Open `chrome://extensions`
   - Turn on **Developer mode**
   - Click **Load unpacked** and select the `dist/` folder

4. **Add your key and your master texts**

   - Click the extension icon in the toolbar to open the side panel
   - Open the **Settings** tab
   - Paste your Gemini API key and choose a model (for example `gemini-3.8-flash`)
   - Paste your full LaTeX resume and cover letter, or use **Pull from Overleaf**
   - Optionally add extra facts (skills you have that are not on the resume) and set your file-name patterns
   - Click **Save**

5. **Connect Overleaf (optional)**

   - Open your resume and cover letter projects in Overleaf tabs
   - In Settings, pick the project and the `.tex` file for each document
   - Make sure the Overleaf editor is not read-only

### Usage

1. **Job tab**: open a job posting and press **Grab from page** (or paste the text), then **Analyse**
2. **Resume tab**: review the suggestions. **Apply** writes into Overleaf, **Copy** puts the new text on your clipboard, **Skip** hides it
3. **Export**: download the tailored `.tex`, or press **Build PDF** to get the PDF while Overleaf returns to your master
4. **Cover Letter tab**: choose tone and language, generate, review the diff, then Copy, Download `.tex`, Build PDF or Apply to Overleaf
5. **New job**: after you have applied, click **New job** in the header to clear everything job-specific. Your settings and master texts stay

### Development

```bash
npm run dev          # start the Vite dev server
npm run typecheck    # run the TypeScript compiler without emitting files
npm run test         # run the vitest suite
npm run build        # typecheck, then production build into dist/
```

After rebuilding, click the reload icon on the extension in `chrome://extensions` to pick up the changes.

## 🧠 How It Works

1. The panel reads the job text from the active tab with a script injected on demand, and your master resume and letter from Settings (or Overleaf).
2. Email, phone and address are replaced with placeholders, then the job and resume go to the Gemini API. The model returns keywords, suggestions and scores as structured JSON.
3. Every suggestion is validated locally before you see it:
   - `original` must appear in your resume, and the stored text is always your real text
   - the replacement keeps LaTeX braces, `$` and `\begin`/`\end` balanced and adds no unescaped `% & # _`
   - new numbers that are not in your resume are rejected
   - suggestions that only exist to cover unsupported keywords are dropped
4. **Apply** sends one CodeMirror 6 transaction to the Overleaf editor, so a single Ctrl+Z undoes it. **Copy** always works as a fallback.
5. **Build PDF** saves a backup, swaps in the tailored text, waits for Overleaf to sync, compiles and downloads the PDF, restores your master and verifies it reads back identical.

Your API key and all your texts are stored in `chrome.storage.local`. There is no backend. Resume and job text are sent only to the Gemini API when you press Analyse or Generate.

## 🔒 Privacy

- **Data goes to Google**: Your resume text and the job description are sent to the Gemini API. On the free tier, Google may use submitted data to improve its products, so do not use it for anything you would not want that to apply to.
- **Redaction**: With the redaction setting on (default), email, phone and address patterns are replaced before sending. Redaction is pattern-based and best effort. Your name and employer names are still sent. Check your resume before relying on it.
- **Local only**: The API key never leaves your browser except in the request header to Google.

## ⚠️ Good to Know

- **AI output can be wrong**: Always read the diffs. The honesty checks catch invented numbers and skills but cannot judge every claim. A "willingness to learn" note is treated as attitude only, never as evidence for a skill.
- **Overleaf can change its page**: The integration relies on Overleaf's editor and toolbar markup. If Overleaf changes it, Apply, file switching or Build PDF may stop working. Copy and Download `.tex` always still work. The file-tree selectors used to list and switch files are the least tested part, so keep the right file open if switching fails.
- **Job-site extraction is best effort**: Sites change their markup. If Grab returns too much or too little, select the description text on the page and press Grab again, or paste it manually.
- **Build PDF needs Auto compile**: It works best with Auto compile on and "Try to compile despite errors" ticked. If the PDF cannot be fetched directly, the browser may download `output.pdf` itself.
- **Interrupted PDF build**: If the panel closes mid-build, reopen it and use **Restore now** on the banner. The backup is kept until the restore is verified.
- **Rate limits and speed**: Limits depend on your Gemini tier and model. If an analysis times out, pick a faster model in Settings.
- **Optional site access**: Chrome asks for permission the first time you grab from a job site.
- **Windows build error**: If `npm run build` fails with a rolldown "Cannot find native binding" error, delete `node_modules` and `package-lock.json`, then run `npm install --legacy-peer-deps` again.

⭐ If you found this project helpful, please give it a star on GitHub!
