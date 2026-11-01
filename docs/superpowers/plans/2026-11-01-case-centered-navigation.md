# Case-centered navigation implementation plan

**Goal:** Implement the user's approved case-first structure without changing stored cases, documents, provider settings, or upload limits.

**Architecture:** Keep the existing HTML/CSS/JavaScript and API routes. Make cases the only new-work entry, group analysis views under one case section, and keep `/documents` as a case-scoped editor or an unassigned historical document list. Preserve old document and view deep links. Execute inline in the current working directory and retain the preceding navigation fixes.

## Approved structure

- Global: 案件工作台 / 文书样本 / 系统设置.
- Case: 概览 / 案卷材料 / 案情研判 / 法律文书.
- Analysis: 时间轴 / 人物关系 / 事件进展 / 证据研判.
- Unassigned historical documents remain accessible from the case list; no new standalone generation.
- Keep return controls, dark/light themes, section review, source links, Word/PDF downloads, and empty-state wording.

## Execution and verification

- [x] Navigation and case list: update the global navigation test in `test/cases-ui.test.js` to require exactly three links; run it red, update all five pages and active-route handling, then run green. Put existing cases ahead of a collapsible new-case form.
- [x] Case workspace: test four main sections with a separate four-view analysis navigator, preserve `view` and browser history, then update `public/case-workspace.html`, `public/case-workspace.js`, and navigation styling. Keep one generation action rather than duplicate calls to action.
- [x] Document workspace: extend `test/document-navigation.test.js` for legacy-only listing, case-linked deep links, visible document type selection, no duplicate file uploader, and reset preserving case context. Generate only through `/api/cases/${caseId}/documents`; keep existing review and export APIs.
- [x] End-to-end checks: run `npm test` and `git diff --check`; browser-check global navigation, create/cancel, all case sections, document return/source links, direct historical links, desktop/mobile, and both themes. Use only synthetic fixtures for generated documents, never paid model calls.

No automatic commit or push. No data migrations or deletion.

## Verification results

- 77 automated tests pass, including the navigation red/green regressions.
- Browser checks cover desktop and 390px mobile layouts in both themes, case analysis grouping, retained analysis view, legacy-only lists, source-to-document return, and list reload after leaving the editor.
- An isolated read-only fixture server verifies actual Word and PDF download buttons; both export responses return 200 with valid file signatures. No real case is mutated and no provider is called.
- The design detector still reports pre-existing palette contrast and transition warnings. This navigation change does not redesign the shared palette or existing animations.
