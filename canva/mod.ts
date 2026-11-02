/**
 * Reconciles markup with the open Canva design, inside a Canva app: reads a page as markup with sticky
 * `data-id`s and a revision, and applies edited markup as one undo step (diff by data-id, in-place edits
 * where Canva allows them, recreate where it doesn't).
 *
 * Needs a browser and the Canva Apps SDK runtime: it imports `@canva/design` and `@canva/asset`, and lays
 * markup out in a hidden DOM.
 *
 * @example
 * ```ts
 * import { CAVILL, serialisePage } from "@thecavillgroup/canva-markup";
 * import { createReconciler } from "@thecavillgroup/canva-markup/canva";
 *
 * const canva = createReconciler(CAVILL);
 * const { doc, pageIndex } = await canva.readPage();
 * const markup = serialisePage(doc).replace("Open Saturday", "Open Sunday");
 * const res = await canva.applyPage(markup, { pageIndex, pageId: doc.pageId, baseRevision: doc.revision!, resolveImage: src => ({ url: src, mimeType: "image/jpeg" }) });
 * console.log(res.results, res.warnings);
 * ```
 *
 * @module
 */
export { createReconciler, pageSummaries, type Reconciler, type ReconcilerOptions, type ApplyOptions, type ApplyResult, type ResolvedImage } from "./session.ts";
export { ReconcileError, isReconcileError, type ReconcileErrorCode } from "./errors.ts";
export type { ApplyAction, ElementResult, ApplyWarning, PageSummary } from "./types.ts";
export type { Trace } from "./trace.ts";
