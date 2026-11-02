/**
 * Reconciles markup with the open Canva design, inside a Canva app: reads a page as markup with sticky
 * `data-id`s and a revision, and applies edited markup as one undo step (diff by data-id, in-place edits
 * where Canva allows them, recreate where it doesn't).
 *
 * Needs a browser and the Canva Apps SDK runtime: it imports `@canva/design` and `@canva/asset`, and lays
 * markup out in a hidden DOM. The lower-level pieces ({@link executeApply}, {@link readLivePage}) take
 * Canva objects as arguments, so they can be driven with fakes.
 *
 * @example
 * ```ts
 * import { CAVILL, serialisePage } from "@thecavillgroup/canva-markup";
 * import { createReconciler } from "@thecavillgroup/canva-markup/canva";
 *
 * const canva = createReconciler({ ...CAVILL, fontUrl: "https://example.com/fonts" });
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
export { executeApply, conflictsWithLive, differences, roundedPath, collectSources, type ApplyDeps, type ExecuteContext, type Settled } from "./apply.ts";
export { readLivePage, snapshotNode, plannedText, type LiveRead, type LiveEntry } from "./read.ts";
export { layout, predictable, type PlanItem } from "./layout.ts";
export { createFontRegistry, ensureMeasureFont, type FontRegistry } from "./fonts.ts";
export { createIdRegistry, fingerprint, revisionOf, walk, type IdRegistry } from "./ids.ts";
export { limited } from "./limit.ts";
export type { Trace } from "./trace.ts";
