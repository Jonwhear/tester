# Question Bank — Examination

A local-first web application for working through medical question-bank questions one at a time,
in the style of professional examination software: a fixed question-status rail on the left, a
restrained top toolbar, and dense question content in the centre.

Everything runs in the browser. There is no server, no account, and no network call — question
banks and attempt progress live in IndexedDB on the machine you are using.

---

## Contents

- [Install and run](#install-and-run)
- [What it does](#what-it-does)
- [Directory structure](#directory-structure)
- [Normalized question-bank schema](#normalized-question-bank-schema)
- [Excel row-format compatibility](#excel-row-format-compatibility)
- [Importing a bank](#importing-a-bank)
- [Editing a bank](#editing-a-bank)
- [Applying an answer key](#applying-an-answer-key)
- [Where to put your generated JSON](#where-to-put-your-generated-json)
- [Save and progress architecture](#save-and-progress-architecture)
- [Exam mode vs Tutor mode](#exam-mode-vs-tutor-mode)
- [Grading](#grading)
- [Extending ContentBlock](#extending-contentblock)
- [Schema versioning](#schema-versioning)
- [Export and import](#export-and-import)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Testing](#testing)
- [Design notes and deliberate decisions](#design-notes-and-deliberate-decisions)

---

## Install and run

```bash
npm install
npm run dev        # development server (prints the local URL)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
npm test           # run the test suite once
npm run test:watch # watch mode
```

Requires Node 18+. The application ships with a small synthetic fixture bank, so it is usable the
moment `npm run dev` comes up — no import step needed to try it.

---

## What it does

- Load one or more question banks and keep them side by side (by id **and** version).
- Import straight from Excel (`.xlsx`), CSV/TSV, or JSON — no conversion script needed.
- Edit banks in a built-in authoring tool: fix text, set answer keys, attach images, save to disk.
- Work through questions sequentially, jump from the left status rail, or use Previous/Next.
- Single-select and multiple-select questions, with any number of options (A–D, A–E, A–H, …).
- **Exam mode** (nothing revealed until submission) and **Tutor mode** (immediate feedback).
- Mark questions for review, cross out options, and write per-question notes.
- Automatic save after every meaningful change; close the tab and resume later.
- Finish an attempt, then review by correct / incorrect / unanswered / marked and reopen any item.
- Keep a history of completed attempts and start new ones without destroying old ones.
- Export and import progress as JSON.
- Built-in lab-values reference, calculator and tutorial panels.

---

## Directory structure

```
src/
  app/                    application root, boot, routing between screens
    App.tsx                 loads storage, owns which screen is shown
    AttemptWorkspace.tsx    owns one live attempt; switches exam <-> review
  components/
    common/               Modal (focus-trapped), ConfirmDialog
    exam/                 ExamScreen, QuestionContent, AnswerOptions, richText
    navigation/           QuestionRail (virtualized status rail)
    toolbar/              ExamToolbar, toolbarExtensions (optional-tool seam)
    dialogs/              Notes, LabValues, Calculator, Help, Finish, Settings,
                          BankManagerScreen
    editor/               BankEditorScreen and friends (authoring; back-office only)
    review/               ReviewScreen, AttemptHistoryScreen
    start/                StartScreen, NewAttemptDialog
  data/
    schema.ts             Zod schemas — the ONLY place untrusted JSON is validated
    normalize.ts          checksums, bank summaries, shared import types
    answerKey.ts          applying a separate answer-key list to a bank
    labValues.ts          lab-values reference data (replace this file)
    importers/
      normalizedJson.ts   importer for already-normalized QuestionBank JSON
      rowFormat.ts        adapter for the Excel row export
      tabular.ts          .xlsx / .csv / .tsv entry point + column aliasing
  grading/
    grade.ts              pure grading functions; no React, no storage, no clock
  hooks/
    useAttemptEngine.ts   live attempt state + targeted persistence
    useSettings.ts        settings, persisted and reflected onto <html>
    useKeyboardShortcuts.ts
  state/
    attemptFactory.ts     attempt creation + bank-compatibility checks
    attemptReducer.ts     every attempt state transition, as pure functions
    bankEditor.ts         every authoring edit + validation, as pure functions
    statusModel.ts        what the candidate is allowed to SEE about correctness
  storage/
    db.ts                 small promise wrapper over IndexedDB
    repositories.ts       banks / attempts / responses / settings repositories
    exportImport.ts       portable save-file formats
  sample-data/            bundled development fixtures (delete freely)
  styles/                 tokens.css + one stylesheet per area
  types/                  question.ts, attempt.ts, settings.ts
  utils/                  id, hash, download, cn, csv, xlsx, fileSystem, image
  answer-keys/            plain-text answer keys kept alongside the code
```

The separation that matters most: **UI components only ever see the normalized `QuestionBank`
model.** Nothing under `components/` knows that spreadsheet rows exist.

---

## Normalized question-bank schema

This is the format the application consumes. Your conversion script should emit exactly this.

```ts
type QuestionBank = {
  schemaVersion: number;      // 1
  bankId: string;             // stable identifier, e.g. "part1-2024"
  bankVersion: string;        // bump when content changes
  title: string;
  description?: string;
  createdAt?: string;         // ISO 8601
  source?: { exam?: string; years?: number[] };
  questions: Question[];
};

type Question = {
  id: string;                          // source id, e.g. "2024-P1-Q006"
  sourceQuestionNumber?: number | string;
  year?: number;
  part?: number | string;

  questionType: 'single' | 'multiple';
  selectCount?: number;                // for "Select three." -> 3

  stem: string;                        // used when contentBlocks is absent
  stemFormat?: 'plain' | 'markdown';
  contentBlocks?: ContentBlock[];       // rendered INSTEAD of stem when present

  options: { label: string; text: string }[];

  correctAnswer?: string[];            // ALWAYS an array; optional
  explanation?: string;
  educationalObjective?: string;
  references?: string[];
  metadata?: { subject?: string; system?: string; topic?: string };

  reviewNote?: string;                 // upstream reviewer annotation
  cleaned?: boolean;
  assets?: QuestionAsset[];
  suggestedHighlights?: { text: string; note?: string }[];
};

type ContentBlock =
  | { type: 'paragraph'; text: string; emphasis?: boolean }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
  | { type: 'image'; src: string; alt?: string; caption?: string };
```

### A complete, valid example

```json
{
  "schemaVersion": 1,
  "bankId": "part1-2024",
  "bankVersion": "2024.1",
  "title": "Part 1 — 2024",
  "description": "Generated from the cleaned row dataset on 2024-03-02.",
  "createdAt": "2024-03-02T09:00:00.000Z",
  "source": { "exam": "Part 1", "years": [2024] },
  "questions": [
    {
      "id": "2024-P1-Q006",
      "sourceQuestionNumber": 6,
      "year": 2024,
      "part": 1,
      "questionType": "single",
      "stem": "",
      "contentBlocks": [
        { "type": "paragraph", "text": "A 4-year-old girl is brought to the emergency department with fatigue. Laboratory results are as follows:" },
        {
          "type": "table",
          "columns": ["", ""],
          "rows": [
            ["Hemoglobin", "5.0 g/dL"],
            ["Reticulocytes", "0.1%"]
          ]
        },
        { "type": "paragraph", "text": "Which of the following is the most likely diagnosis?" }
      ],
      "options": [
        { "label": "A", "text": "Acute chest syndrome" },
        { "label": "B", "text": "Aplastic crisis" },
        { "label": "C", "text": "Hyperhemolytic crisis" },
        { "label": "D", "text": "Splenic sequestration" },
        { "label": "E", "text": "Stroke" }
      ],
      "correctAnswer": ["B"],
      "explanation": "The reticulocyte count of 0.1% indicates a failure of production.",
      "educationalObjective": "Use the reticulocyte response to separate production failure from destruction.",
      "cleaned": true
    },
    {
      "id": "2024-P1-Q007",
      "questionType": "multiple",
      "selectCount": 3,
      "stem": "Which of the following are appropriate? (Select three.)",
      "options": [
        { "label": "A", "text": "First option" },
        { "label": "B", "text": "Second option" },
        { "label": "C", "text": "Third option" },
        { "label": "D", "text": "Fourth option" },
        { "label": "E", "text": "Fifth option" },
        { "label": "F", "text": "Sixth option" }
      ],
      "correctAnswer": ["A", "C", "E"]
    },
    {
      "id": "2024-P1-Q008",
      "questionType": "single",
      "stem": "[SOURCE PAGE MISSING — stem not recovered from the scan]",
      "options": [
        { "label": "A", "text": "[OPTION TEXT MISSING — not recovered from the scan]" },
        { "label": "B", "text": "Second option" }
      ],
      "reviewNote": "Page 12 illegible; placeholders inserted deliberately.",
      "cleaned": false
    }
  ]
}
```

Notes on that example:

- `correctAnswer` is an array **even for single-answer questions**.
- The third question has **no** `correctAnswer`. It can still be answered; it is reported as
  *answered — no answer key* and is excluded from the score denominator. The application never
  infers a correct answer.
- A lab table with `"columns": ["", ""]` renders with **no heading row**, matching the source
  layout. The first cell of each row becomes a row header for assistive technology. Supply real
  column labels if you do want a visible heading row.
- Placeholders are displayed exactly as written. The application never repairs them.

---

## Excel row-format compatibility

The adapter in `src/data/importers/rowFormat.ts` consumes a JSON rendering of the current
spreadsheet: one object per row, in file order.

| Column | Meaning |
| --- | --- |
| `index` | source row number, used to report problems back to you |
| `row_type` | `question` or `option` (plus the optional extensions below) |
| `option_label` | option label on `option` rows, verbatim |
| `row_text` | option text on `option` rows |
| `question_id` | ties option rows to their question row |
| `source_question_number` | preserved as `sourceQuestionNumber` |
| `year`, `part` | preserved |
| `cleaned` | `TRUE`/`FALSE`/`yes`/`no`/`1`/`0` |
| `question_text` | the stem, on `question` rows |
| `review_note` | preserved as `reviewNote` |

A question is a `question` row followed by its `option` rows:

```json
[
  { "index": 1, "row_type": "question", "question_id": "2024-P1-Q017",
    "source_question_number": 17, "year": 2024, "part": 1, "cleaned": "TRUE",
    "question_text": "A 45-year-old man...", "review_note": "" },
  { "index": 2, "row_type": "option", "option_label": "A", "row_text": "Option A text",
    "question_id": "2024-P1-Q017" },
  { "index": 3, "row_type": "option", "option_label": "B", "row_text": "Option B text",
    "question_id": "2024-P1-Q017" }
]
```

A bare array works, or you can wrap it to supply bank identity:

```json
{ "bankId": "part1-2023", "bankVersion": "2023.1", "title": "Part 1 — 2023",
  "exam": "Part 1", "rows": [ ... ] }
```

**Optional forward-compatible columns**, read when present and ignored when absent:
`question_type` (`single`/`multiple`), `select_count`, `correct_answer` (e.g. `"B"` or `"B, D, F"`),
`explanation`, `educational_objective`, `subject`, `system`, `topic`.

**Optional extension row types**, so the pipeline can grow without a schema break:
`correct_answer`, `explanation`, `educational_objective`, `reference` — each carries its payload in
`row_text` and attaches to the preceding question.

### Guarantees the adapter keeps

- Option **order is source row order**. Nothing is sorted.
- Option **labels are verbatim**. Nothing is renumbered.
- **No assumption of five options.** A–D, A–E and A–H all import unchanged.
- Stems and option text are never rewritten, paraphrased or "medically corrected".
- Deliberate placeholders are preserved exactly.
- A correct answer is only ever *read* from the source, never inferred.
- `(Select three.)` in the stem sets `questionType: "multiple"` and `selectCount: 3`, and the
  import reports a warning telling you to state it explicitly with a `question_type` column. This
  reads an instruction the author wrote; it is not a guess about content.

### When the source is malformed

Nothing is silently discarded. The import fails and reports each problem with the question id and
the source row number — an option row before its question row, a missing `option_label`, a
duplicate label, an unrecognized `row_type`, a question with no options, an answer key naming an
option that is not present. Fix the spreadsheet, re-export, re-import.

---

## Importing a bank

**Settings → Manage question banks**, or **Question Bank** on the start screen.

1. Drop a file on the drop zone, or choose one from disk. Accepted:
   - **`.xlsx` / `.xlsm`** — an Excel workbook in the row format. Read directly; no conversion
     step. The first sheet is used, and the others are named in the summary.
   - **`.csv` / `.tsv`** — the same row format exported as text.
   - **`.json`** — either normalized bank JSON or row-format JSON.
2. The format selector applies to `.json` only and defaults to **Auto** — an array, or an object
   with a `rows` property, is treated as the row export; anything else is treated as normalized
   JSON. Spreadsheets are always read as rows.
3. The bank is validated and summarized (title, id, version, question count, years, parts, whether
   an answer key is present, content checksum) **before** anything is stored.
4. Errors and warnings are listed with the question id and source row.
5. Press **Install bank** to store it, or **Open in editor** to fix it up first.

### Column names

Headers are matched case-insensitively, ignoring spaces, hyphens and underscores, so
`question_id`, `Question ID` and `question-id` are the same column. Each canonical column accepts
several spellings — the answer key, for instance, is read from any of `correct_answer`, `answer`,
`answers`, `answer_key`, `key`, `correct`, `correct_option`, `correct_label`, `correct_choice`,
`ans` or `solution`. A column that is not recognized is passed through untouched rather than
dropped, and the import summary lists which ones were ignored.

Old `.xls` files are not supported — re-save as `.xlsx` or export CSV.

Banks are keyed by `bankId` **and** `bankVersion`, so several versions can coexist and an old
attempt keeps pointing at the version it was taken against.

---

## Editing a bank

The editor is a back-office tool. It lives in bank management and nowhere else — most people never
edit a bank, and it has no presence in the exam interface.

Reach it from **Question Bank** on the start screen (or **Settings → Manage question banks**):

| Action | What it does |
| --- | --- |
| **Edit** next to an installed bank | Opens that bank as a draft |
| **Open a bank file to edit…** | Opens a `.json` from disk, keeping a write handle where the browser allows it |
| **Create a new bank** | Starts an empty bank |
| **Open in editor** after an import | Fixes up a freshly imported spreadsheet before installing it |

### What you can change

- Question id, source number, year, part, and the `cleaned` flag
- The stem, either as plain text or as **content blocks** (paragraphs, lab tables, images)
- Options: text, labels, order, add and delete
- The answer key, by ticking options; single vs multiple answer, and how many to choose
- Explanation, educational objective and the review note

Renaming an option label carries the answer key with it, and deleting an option removes it from the
key — so an edit never silently invalidates the key. **Relabel A–Z** renumbers every option in its
current order and remaps the key to match; reordering alone deliberately does *not* renumber,
because the source labels are what the printed exam and the answer key refer to.

### Attaching images

Switch the stem to **blocks**, then **Image**. The file is embedded in the bank as a data URL, so a
bank stays a single portable file that can be emailed or committed — a relative path would break as
soon as the file moved.

Images wider or taller than 1400px are downscaled and re-encoded before embedding (JPEG, or PNG
where transparency matters), and the result is only used if it is actually smaller than the
original. SVG is passed through untouched. Each image shows its embedded size, so you can see a
bank growing. Give every image **alt text**; it is what a screen reader announces.

### The question list

The rail shows one row per question with a health dot:

| Dot | Meaning |
| --- | --- |
| Grey-green | No problems |
| Amber | Warnings only — e.g. no answer key, or an option with no text |
| Red | Errors — the bank will not install or re-import until they are fixed |

The filter strip above it narrows the list to **Err**, **Warn**, **No key**, **Raw** (not marked
cleaned) or **Noted** (carries a review note). For cleaning up an OCR pass, **Raw** and **Noted**
are the two to live in.

### Saving

**Save** (or <kbd>Ctrl</kbd>+<kbd>S</kbd>) writes the bank as JSON.

- In Chrome and Edge it writes back to the same file you opened, in place.
- Firefox and Safari have no such API, so it downloads a copy instead and says so.

A dot next to the bank title means unsaved changes; closing with unsaved work asks first, and so
does reloading the tab. If the bank still has errors, saving asks for confirmation and warns that
the file will not re-import until they are fixed — it still saves, because losing work is worse.

**Install into the application** is separate from saving. It stores the bank in this browser so you
can start an attempt on it, and it refuses banks that fail validation. Editing a file and
installing it are deliberately two different actions.

> Bump **bankVersion** (Bank → Bump) whenever you change content. Attempts are tied to a bank by id
> *and* version, and the checksum guard will otherwise warn that a bank changed underneath them.

---

## Applying an answer key

Answer keys usually arrive separately, as a flat list in question order:

```
# PRITE 2023, Part 1
D
A
D
...
EFH
```

In the editor, press **Key**. Paste the list or load it from a file, then check the preview before
applying.

- One answer per line. Lines starting with `#` and blank lines are ignored, and a leading question
  number (`12. D`) is stripped.
- A multi-answer question can be written run together (`EFH`) or separated (`E, F, H`). A
  run-together key is only split when the whole token matches no option label *and* every character
  does — so a genuine multi-character label like `iii` is never chopped up.
- Applying a key of several labels switches that question to multiple-select and sets how many to
  choose.

**The join is verified before anything is written.** A positional key that is off by one produces a
bank that looks fine and is wrong everywhere, so the operation is all-or-nothing:

| Situation | Result |
| --- | --- |
| Key length ≠ question count | Refused. Nothing applied. |
| A key line names an option the question does not have | Refused, naming the question |
| Joining by question number and the numbers have a gap | Refused, naming the missing number |
| A question already has a *different* key | Left alone with a warning, unless **Replace them** is on |
| A question already has the *same* key | Counted as already applied |

Join by **Position** (line N ↔ question N) or by **Question number** (line N ↔ the question whose
`sourceQuestionNumber` is N). The second survives a reordered bank, so prefer it when your source
numbers are trustworthy.

A worked example lives in [`answer-keys/2023-part1.txt`](answer-keys/2023-part1.txt) — 150 answers,
147 single and 3 multi-answer.

---

## Where to put your generated JSON

**You do not need to touch the source tree.** The intended path is to import your generated bank
at runtime through *Settings → Manage question banks*. It is stored in IndexedDB and survives
reloads.

If you would rather bundle a bank with the build so it installs automatically on first run:

> **Replace `src/sample-data/sample-bank.json` with your generated bank.**

That one file is what `src/app/App.tsx` installs when no bank is present. Nothing else references
it. `src/sample-data/sample-rows.json` is the row-format example behind the *Preview bundled
row-format sample* button; delete it and the `SAMPLE_ROWS` export in
`src/sample-data/index.ts` if you do not want it.

To delete the fixtures entirely: remove `src/sample-data/`, then remove the `SAMPLE_BANK` import
and the first-run install block in `src/app/App.tsx` and the two sample buttons in
`src/components/dialogs/BankManagerScreen.tsx`.

---

## Save and progress architecture

Question-bank content and attempt state are **completely separate**. An attempt never writes into
a bank.

```ts
type Attempt = {
  schemaVersion: number;
  attemptId: string;
  bankId: string;
  bankVersion: string;
  bankChecksum?: string;     // content hash at attempt creation
  bankTitle: string;

  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  mode: 'exam' | 'tutor';
  questionOrder: string[];   // may be a subset of the bank
  currentQuestionId: string;
  responses: Record<string, QuestionResponse>;
};

type QuestionResponse = {
  selectedAnswers: string[];
  status: 'unseen' | 'seen' | 'answered' | 'correct' | 'incorrect';
  marked: boolean;
  notes?: string;
  firstViewedAt?: string;
  answeredAt?: string;
  gradedAt?: string;
  ungradable?: boolean;      // answered, but the bank has no key for it
  crossedOut?: string[];     // options struck through as an elimination aid
};
```

### Where the data lives

IndexedDB database **`qbank-exam`** (version 1), in the browser profile you are using. Four object
stores:

| Store | Key | Holds |
| --- | --- | --- |
| `banks` | `"<bankId>::<bankVersion>"` | the bank plus checksum, import time, counts |
| `attempts` | `attemptId` | the attempt header (everything except responses) |
| `responses` | `"<attemptId>::<questionId>"` | one record per answered question, indexed by attempt |
| `kv` | `"settings"`, `"activeAttemptId"` | settings and which attempt to resume |

Per-question responses are stored as **separate records**, not as a blob on the attempt. Answering
one question in a 2,000-question bank writes exactly two records (that response, and the attempt
header) rather than rewriting 2,000. `applyAction` in `state/attemptReducer.ts` returns which
records actually changed, and `useAttemptEngine` writes only those.

### When it saves

Automatically, after: answer selection, grading, navigation, mark/unmark, cross-out, note edits
(short idle debounce, plus on close), mode change, and submission. There is no Save button. If a
write fails, the failure is shown in the question pane rather than being swallowed.

### Resuming

`activeAttemptId` is restored on boot. The start screen offers **Resume Attempt** with the bank,
mode, position and answered count. Before an attempt is opened, its `bankId` / `bankVersion` are
checked against the installed banks — see [Schema versioning](#schema-versioning).

---

## Exam mode vs Tutor mode

`state/statusModel.ts` is the single place that decides what the candidate may see. Every
surface — the rail, the options, the review list — derives its appearance from it, which is what
keeps exam mode from leaking grading.

### Exam mode

- A selection is recorded and shown as selected (cyan), nothing more.
- No option is coloured green or red. The answer key is not shown. No explanation is rendered.
- The rail shows *answered*, never correct or incorrect.
- Answers can be changed freely until the attempt is submitted.
- Grading happens on submission, after which review shows correctness.

### Tutor mode

- A **single-select** question is graded the instant an option is chosen: the choice turns green if
  correct, red if not, and the correct option turns green. The question then locks.
- A **multiple-select** question accepts selections up to `selectCount`, then offers an explicit
  **Check Answer** control, so the candidate can revise before committing.
- The rail turns restrained green or red to match, so a glance down the rail shows which completed
  questions were right.
- The current question keeps its cyan row highlight *and* its correctness dot — current and
  correct/incorrect are independent.

Switching mode mid-attempt is allowed and does **not** retroactively grade earlier answers.

---

## Grading

`grading/grade.ts` is pure and exhaustively tested.

```ts
gradeQuestion(question, selectedAnswers)
// -> { gradable: true, correct: false, selected: ['A'], expected: ['B'] }
// -> { gradable: false, reason: 'no-answer-key', selected: ['A'] }
```

- Single and multiple select share one rule: the selected set must **exactly equal** the answer-key
  set. Order never matters. A partial multiple-select match is never credited.
- Labels are normalized **for comparison only** (`" b) "` matches `"B"`). Displayed labels are
  always the source labels.
- No answer key means `gradable: false`. The question is recorded as answered and reported as
  ungraded; nothing is guessed.
- The review screen reports the percentage over **graded** items, and separately over every item
  that has an answer key (so unanswered keyed items are visible as a second denominator).

A discriminated union is used rather than a bag of optional fields, so a caller cannot read
`correct` without first proving `gradable`.

---

## Extending ContentBlock

1. Add the variant to `ContentBlock` in `src/types/question.ts`.
2. Add the matching member to `contentBlockSchema` in `src/data/schema.ts` (the discriminated union
   keyed on `type`).
3. Add a `case` to `Block` in `src/components/exam/QuestionContent.tsx`.
4. Style it in `src/styles/exam.css`.

For example, a video block:

```ts
// types/question.ts
| { type: 'video'; src: string; caption?: string }

// data/schema.ts
z.object({ type: z.literal('video'), src: z.string(), caption: z.string().optional() }),

// components/exam/QuestionContent.tsx
case 'video':
  return (
    <figure className="stem-figure">
      <video src={block.src} controls />
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
```

Bump `CURRENT_BANK_SCHEMA_VERSION` if existing banks would not round-trip.

---

## Schema versioning

Three independent version numbers:

| Constant | Where | Purpose |
| --- | --- | --- |
| `CURRENT_BANK_SCHEMA_VERSION` | `types/question.ts` | shape of a `QuestionBank` |
| `CURRENT_ATTEMPT_SCHEMA_VERSION` | `types/attempt.ts` | shape of an `Attempt` |
| `PROGRESS_FILE_VERSION` | `storage/exportImport.ts` | shape of a save file |

A bank declaring a **newer** `schemaVersion` than the build supports is refused with a readable
message naming both numbers, rather than crashing. Older payloads pass through the `migrate()`
boundary in `data/importers/normalizedJson.ts` before validation — that function is where upgrade
steps go as the format grows.

### Bank-compatibility guard

`checkAttemptCompatibility` in `state/attemptFactory.ts` runs before an attempt is opened or
imported:

| Condition | Result |
| --- | --- |
| bank not installed | **error** — import that bank version first |
| `bankId` differs | **error** |
| `bankVersion` differs | **error** — question order may no longer mean anything |
| attempt references questions absent from the bank | **error**, naming them |
| same version, different content checksum | **warning** — same declared version, edited content |

This is why you should bump `bankVersion` whenever content changes.

---

## Export and import

Three formats, all plain JSON:

| Action | `kind` | Contains |
| --- | --- | --- |
| **Export progress** | `qbank-progress` | attempts only, plus bank id/version/checksum |
| **Export portable session** | `qbank-portable-session` | the same, with the whole bank embedded |
| *(accepted on import)* | — | a bare `Attempt` object, for hand-edited files |

Progress export is the default and deliberately does **not** duplicate the bank — a large bank in
every save file would be wasteful. The portable session is the opt-in choice for moving to a
machine that does not have the bank installed; importing one installs the embedded bank if it is
missing.

**Import progress** validates the file, then checks every attempt in it against the installed bank
before storing anything. Incompatible attempts are rejected with a reason; compatible ones are
stored and the most recent becomes resumable.

A progress file looks like:

```json
{
  "kind": "qbank-progress",
  "fileVersion": 1,
  "exportedAt": "2024-03-02T10:15:00.000Z",
  "bank": {
    "bankId": "part1-2024",
    "bankVersion": "2024.1",
    "checksum": "3f1a9c2b7d40e155",
    "title": "Part 1 — 2024",
    "questionCount": 150
  },
  "attempts": [ { "schemaVersion": 1, "attemptId": "attempt_…", "…": "…" } ]
}
```

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>←</kbd> / <kbd>→</kbd> | previous / next item |
| <kbd>A</kbd>–<kbd>H</kbd> | choose the matching option |
| <kbd>M</kbd> | mark / unmark the current item |
| <kbd>N</kbd> | open notes |
| <kbd>Esc</kbd> | close a dialog or drawer |

Shortcuts do not fire while focus is in a text field, while a modifier is held, or while a dialog
is open, and can be turned off entirely in Settings.

In the **editor**, where almost everything is a text field, the shortcuts are modified instead:

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> | Save |
| <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | Previous / next question |

---

## Testing

```bash
npm test
```

Covers the behaviour most likely to break:

- row-format importer: option ordering, variable option counts, question-id preservation,
  placeholder fidelity, `(Select three.)` detection, and every malformed-source case
- normalized importer: schema-version refusal, per-question error reporting, duplicate ids
- grading: correct/incorrect single, unanswered, correct/wrong/partial/superset multiple,
  missing answer key, label normalization, attempt summaries and score denominators
- attempt reducer: navigation boundaries, exam mode withholding correctness, tutor mode revealing
  it, tutor locking, multiple-select Check Answer, marks, notes, cross-outs, mode changes
- persistence: attempt serialization and restoration, single-response writes, resume after
  refresh, attempt deletion, settings round-trip
- compatibility: missing bank, wrong version, missing questions, checksum drift
- save files: progress and portable-session round-trips, rejection of malformed files
- UI: exam mode exposing nothing before submission and everything after, tutor green/red in both
  the options and the rail, mark persistence across navigation, notes, keyboard shortcuts,
  review filters and reopening
- rail: virtualization window with 2,000 questions, every status indicator, exam-mode masking
- spreadsheet reading: quoted commas, escaped quotes, newlines inside a field, CRLF, BOM,
  delimiter detection, shared vs inline strings, omitted cells keeping columns aligned, sheet
  selection, column-name aliasing
- answer keys: run-together vs separated multi-answers, multi-character labels left intact,
  length-mismatch refusal, unknown-option refusal, gap detection, overwrite behaviour
- authoring: every edit operation, label renames carrying the key, validation levels, and the
  editor UI — dirty tracking, rail filters, install refusal, discard confirmation, key dialog

---

## Design notes and deliberate decisions

A few places where a judgement call was made; each is here so it can be reversed knowingly.

**Markdown is not parsed.** Imported bank content is untrusted and is never passed to
`dangerouslySetInnerHTML`. Rather than adding a Markdown parser plus a sanitizer, `stemFormat:
"markdown"` is handled by a tiny inline formatter (`**bold**`, `*italic*`, `` `code` ``) that
builds React elements directly. Anything else, including raw HTML in the source, renders as literal
text. This removes the sanitizer from the trust path entirely. Extending it means adding cases to
`components/exam/richText.tsx`, not enabling raw HTML.

**No "Ask" tool is shipped.** The reference interface has one, backed by a remote service. The exam
engine must not depend on a network service, and a visible control that does nothing is worse than
no control — so the seam exists (`components/toolbar/toolbarExtensions.ts`, the
`toolbarExtensions` prop on `ExamScreen`) and renders nothing by default. A host can pass a tool
descriptor in and it will render with the same density as the built-in tools.

**A per-option cross-out control was added.** It appears in the reference interface as the struck-
through "ab" at the right of each option and is real exam-software behaviour, so it is implemented
rather than drawn: it persists as `crossedOut` on the response, and it never affects grading.

**"Suggested Highlights" appears only when the bank supplies highlights** for the current question,
for the same reason — otherwise it would be a control that does nothing. When it appears, it toggles
`suggestedHighlights` from the bank data. No highlight text is ever generated.

**Per-option verdicts are a glyph, not a word.** A green/red ✓/✗ with screen-reader text keeps the
option list at the reference's density while staying legible without colour.

**Correctness is derived in one place.** `state/statusModel.ts` decides what may be shown;
components never read `response.status` directly. That is what makes "exam mode reveals nothing"
a single testable rule instead of a property of a dozen components.

**Responses are stored per question.** See [Save and progress architecture](#save-and-progress-architecture).

**The rail is virtualized.** Only the visible window of rows is mounted, so a 1,000+ question
attempt stays responsive. The scroll surface still reserves full height, so the scrollbar is honest.

**Narrow viewports get a two-row toolbar**, not a hidden menu: identity and navigation on the first
row, a horizontally scrollable tool strip on the second, and the status rail becomes a drawer.
Desktop density was not softened to achieve this.

**The editor is a separate mode, not a mode switch.** Banks stay immutable as far as attempts are
concerned: the editor works on a detached draft, and installing the result is an explicit second
step. That is why "Save" (to a file) and "Install" (into the app) are two different buttons rather
than one.

**Images are embedded, not linked.** A bank is meant to be one file you can send someone. A
relative image path would break the moment it moved, so images become data URLs — with downscaling
on the way in, because otherwise a handful of phone photos makes a bank unusable.

**The xlsx reader is hand-rolled.** It unzips with `fflate` and walks the XML with the platform
`DOMParser`, reading cell values only. Spreadsheet libraries are large and this parses files the
user picked off disk, so keeping third-party code out of that path is worth the narrower feature
set. Anything it cannot handle has an escape hatch: export as CSV.

**Answer-key joins are all-or-nothing.** A partially applied positional key is worse than none,
because the wrong answers look exactly like the right ones. Everything is validated before the
first write.

**The bundled fixtures are fixtures.** `src/sample-data/sample-bank.json` contains synthetic
questions written to exercise the renderer (A–D, A–E, A–H, select-two, select-three, a lab table,
an image, a long stem with highlights, a question with no answer key, and a question full of
deliberate source placeholders). They are not a medical reference and their answer keys carry no
authority. `src/data/labValues.ts` is likewise a small placeholder table, clearly labelled as such
in the UI, and is meant to be replaced with your examination's published reference ranges.
