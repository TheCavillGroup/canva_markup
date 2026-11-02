import { findFonts, upload, type FontRef, type ImageRef } from "@canva/asset";
import { addPage as canvaAddPage, getCurrentPageMetadata, getDesignMetadata, openDesign, type DesignEditing, type PageId } from "@canva/design";
import { CAVILL, assertBrand, type Brand } from "../brand.ts";
import { parsePage } from "../parse/mod.ts";
import type { ApplyWarning, ElementResult, PageDoc, PageSummary } from "../types.ts";
import { collectSources, conflictsWithLive, differences, executeApply, type Settled } from "./apply.ts";
import { reconcileError } from "./errors.ts";
import { createFontRegistry, type FontRegistry } from "./fonts.ts";
import { createIdRegistry, walk, type IdRegistry } from "./ids.ts";
import { layout } from "./layout.ts";
import { limited } from "./limit.ts";
import { readLivePage, type LiveRead } from "./read.ts";
import { noTrace, type Trace } from "./trace.ts";

// The whole loop against the Canva editor: read a page as markup, and apply edited markup as one undo step.
// This module imports the Canva runtime, so it only loads inside a Canva app.

/** Where an image comes from: an imageRef Canva already has, or a URL Canva can upload from */
export type ResolvedImage = { imageRef : string } | { url : string, mimeType : string, thumbnailUrl? : string };

export interface ApplyOptions {
    /** Page index (0-based), used when `pageId` isn't given or no longer matches */
    pageIndex : number,
    /** Page id from the read: the page is found by id first, since the user may have reordered pages */
    pageId? : string,
    /** Revision from the read. If the page changed since, nothing is applied (stale_revision) */
    baseRevision : string,
    /** Resolves every src other than `canva:<ref>` (https URLs, `brand:<key>`). Without it, only `canva:` srcs work */
    resolveImage? : (src : string) => ResolvedImage | Promise<ResolvedImage>
}

export interface ApplyResult {
    results : Array<ElementResult>,
    warnings : Array<ApplyWarning>,
    /** The page as Canva stored it, re-read after sync (new revision, sticky ids) */
    doc : PageDoc,
    pageIndex : number,
    /** src → imageRef for every image uploaded during this apply, so a host can cache them */
    uploaded : Record<string, string>
}

export interface ReconcilerOptions {
    trace? : Trace
}

export interface Reconciler {
    readonly brand : Brand;
    readonly fonts : FontRegistry;
    readonly ids : IdRegistry;
    /** Reads a page (default: the one the user is on) as a canonical doc with data-ids and a revision */
    readPage(pageIndex? : number) : Promise<{ doc : PageDoc, pages : Array<PageSummary>, pageIndex : number }>;
    /**
     * Applies a whole page of markup (or a parsed doc) as one undo step. The markup is validated, and checked
     * against the live page inside the session, so nothing is applied unless all of it can be.
     */
    applyPage(input : string | PageDoc, opt : ApplyOptions) : Promise<ApplyResult>;
    /** Adds a page (optionally sized, titled, and placed after page `after`; -1 = first) */
    addPage(opts? : { width? : number, height? : number, title? : string, after? : number }) : Promise<{ pageId? : string, pageIndex : number, width : number, height : number }>;
    pageSummaries() : Promise<{ pages : Array<PageSummary>, current : number }>;
}

/** Pages of the open design, and which one the user is on */
export async function pageSummaries() : Promise<{ pages : Array<PageSummary>, current : number }> {
    const [meta, cur] = await Promise.all([getDesignMetadata(), getCurrentPageMetadata()]);
    const curId = cur.type === "absolute" ? cur.id : undefined;
    const pages = [...meta.pageMetadata].map((p, index) => ({
        index,
        id: p.type === "absolute" ? p.id : undefined,
        title: p.type === "absolute" ? p.title : undefined,
        width: p.type === "absolute" ? p.dimensions?.width : undefined,
        height: p.type === "absolute" ? p.dimensions?.height : undefined,
        current: p.type === "absolute" && p.id != null && p.id === curId
    }));
    return { pages, current: Math.max(0, pages.findIndex(p => p.current)) };
}

/**
 * Reads and writes pages of the open Canva design as markup, for one brand. Keep one per app: it owns
 * the sticky data-id registry and the font lookups.
 *
 * @example
 * ```ts
 * const r = createReconciler(CAVILL);
 * const { doc } = await r.readPage();
 * const markup = serialisePage(doc).replace("Open Saturday", "Open Sunday");
 * await r.applyPage(markup, { pageIndex: 0, pageId: doc.pageId, baseRevision: doc.revision! });
 * ```
 */
export function createReconciler(brand : Brand = CAVILL, opts : ReconcilerOptions = {}) : Reconciler {
    assertBrand(brand);
    const fonts : FontRegistry = createFontRegistry(brand, findFonts);
    const ids : IdRegistry = createIdRegistry(brand);
    const trace = opts.trace ?? noTrace;
    const deps = { fonts, ids, trace };

    /** Reads a page (default: the one the user is on) as a canonical doc with data-ids and a revision */
    async function readPage(pageIndex? : number) : Promise<{ doc : PageDoc, pages : Array<PageSummary>, pageIndex : number }> {
        const { pages, current } = await pageSummaries();
        const index = pageIndex ?? current;
        if(index < 0 || index >= pages.length) throw reconcileError("bad_request", `There is no page ${index + 1}; the design has ${pages.length} page(s).`);

        let read : LiveRead | undefined;
        await limited(() => openDesign({ type: "all_pages" }, async session => {
            const ref = session.pageRefs.toArray()[index];
            if(!ref || ref.type !== "absolute") throw reconcileError("unsupported_page", "That page can't be read by apps (for example a Canva Docs page).");
            await session.helpers.openPage(ref, async ({ page }) => {
                if(page.type !== "absolute") throw reconcileError("unsupported_page", "Unsupported page type.");
                if(!page.dimensions) throw reconcileError("unsupported_page", "Whiteboard (unbounded) pages aren't supported.");
                read = await readLivePage(page, fonts, ids);
            });
        }));
        if(!read) throw reconcileError("canva_error", "The page couldn't be read.");
        return { doc: read.doc, pages, pageIndex: index };
    }

    /**
     * Applies a whole page of markup (or a parsed doc) as one undo step. The markup is validated, and checked
     * against the live page inside the session, so nothing is applied unless all of it can be.
     */
    async function applyPage(input : string | PageDoc, opt : ApplyOptions) : Promise<ApplyResult> {
        const warnings : Array<ApplyWarning> = [];
        const results : Array<ElementResult> = [];
        const uploaded : Record<string, string> = {};

        let doc : PageDoc;
        if(typeof input === "string") {
            const parsed = parsePage(input, brand);
            if(!parsed.doc) throw reconcileError("validation_failed", "The markup was rejected; nothing was changed.", { issues: parsed.issues });
            doc = parsed.doc;
        } else {
            doc = input;
        }

        // 1. Everything slow happens before the session: layout, fonts, uploads
        const plan = await layout(doc, fonts);
        warnings.push(...plan.warnings);

        const fontRefs = new Map<string, FontRef>();
        const fams = new Set<string>();
        walk(doc.children, n => {
            if(n.kind === "text") for(const p of n.paragraphs) fams.add(p.format.fontFamily);
        });
        for(const f of fams) fontRefs.set(f, await fonts.resolve(f));

        const imageRefs = new Map<string, ImageRef>();
        await Promise.all([...collectSources(doc)].map(async src => {
            if(src.startsWith("canva:")) {
                imageRefs.set(src, src.slice(6) as ImageRef);
                return;
            }
            if(!opt.resolveImage) throw reconcileError("asset_failed", `Image "${src}" can't be used: no image resolver was given.`);
            let a : ResolvedImage;
            try {
                a = await opt.resolveImage(src);
            } catch(err) {
                throw reconcileError("asset_failed", `Image "${src}" couldn't be resolved: ${(err as Error).message}`);
            }
            if("imageRef" in a) {
                imageRefs.set(src, a.imageRef as ImageRef);
                return;
            }
            try {
                const q = await upload({ type: "image", url: a.url, mimeType: a.mimeType as "image/png", thumbnailUrl: a.thumbnailUrl ?? a.url, aiDisclosure: "none" });
                imageRefs.set(src, q.ref);
                uploaded[src] = q.ref;
            } catch(err) {
                throw reconcileError("asset_failed", `Canva couldn't upload "${src}": ${(err as Error).message}`);
            }
        }));
        const img = (src : string) => imageRefs.get(src)!;

        // 2. Find the page by id (the user may have reordered pages)
        const meta = await getDesignMetadata();
        const metaPages = [...meta.pageMetadata];
        let index = opt.pageId ? metaPages.findIndex(p => p.type === "absolute" && p.id === opt.pageId) : -1;
        if(index < 0) index = opt.pageIndex;
        const target = metaPages[index];
        const pageId = opt.pageId ?? (target?.type === "absolute" ? target.id : undefined);

        let after : LiveRead | undefined;
        const settled : Settled = { expected: new Map() };
        trace("apply: prepared", { items: plan.items.length, uploads: Object.keys(uploaded).length });

        const run = async (page : DesignEditing.Page, helpers : DesignEditing.PageHelpers) : Promise<boolean> => {
            if(page.type !== "absolute") throw reconcileError("unsupported_page", "That page can't be edited by apps (e.g. a Canva Docs page).");
            if(page.locked) throw reconcileError("page_locked", "This page is locked in Canva. Ask the user to unlock it.");
            const live = await readLivePage(page, fonts, ids);
            if(live.doc.revision !== opt.baseRevision) throw reconcileError("stale_revision", "The page changed in Canva since it was read. Read it again and redo the edit.");
            // The same rules a host checks against the page it served, here against the page itself
            const issues = conflictsWithLive(live.doc, doc, brand);
            if(issues.length) throw reconcileError("validation_failed", "The markup conflicts with the page you read; nothing was changed.", { issues });
            const changed = await executeApply(page, helpers, live, plan.items, doc, { fontRefs, img, results, warnings, deps, settled });
            trace("apply: executed", { changed });
            return changed;
        };

        // The page the user is looking at is edited in a current_page session (the shape Canva's own
        // examples use for grouping); other pages go through all_pages + openPage.
        const current = await getCurrentPageMetadata();
        if(current.type === "absolute" && pageId != null && current.id === pageId) {
            await limited(() => openDesign({ type: "current_page" }, async session => {
                if(await run(session.page, session.helpers)) {
                    trace("apply: syncing (current_page)");
                    await session.sync();
                    trace("apply: synced");
                }
            }));
        } else {
            await limited(() => openDesign({ type: "all_pages" }, async session => {
                const ref = session.pageRefs.toArray()[index];
                if(!ref || ref.type !== "absolute") throw reconcileError("unsupported_page", "That page can't be edited by apps (e.g. a Canva Docs page).");
                let changed = false;
                const opened = await session.helpers.openPage(ref, async ({ page, helpers }) => {
                    changed = await run(page, helpers);
                });
                if(opened.status !== "executed") throw reconcileError("stale_revision", `The page became unavailable (${opened.reason}). Read it again.`);
                if(changed) {
                    trace("apply: syncing (all_pages)");
                    await session.sync();
                    trace("apply: synced");
                }
            }));
        }

        trace("apply: session closed");
        // Re-read in a fresh session: re-opening the page after sync() in the same session can fail
        // with internal_error (seen after creating a group), which would misreport a successful apply.
        try {
            await limited(() => openDesign({ type: "all_pages" }, async session => {
                const ref = session.pageRefs.toArray()[index];
                if(!ref || ref.type !== "absolute") return;
                await session.helpers.openPage(ref, async ({ page }) => {
                    if(page.type === "absolute") after = await readLivePage(page, fonts, ids, settled.hint);
                });
            }));
        } catch(err) {
            trace("apply: re-read failed", { message: (err as Error)?.message });
        }

        if(!after) throw reconcileError("canva_error", "The change WAS applied, but the page couldn't be re-read. Read it again before editing.");

        // Canva can accept a value at sync and store something else (e.g. list-style-type:unchecked comes back as none)
        const edited = new Map<string, string>();
        for(const r of results) if(r.action !== "unchanged" && r.action !== "deleted") edited.set((r.id ?? r.newId)!, r.path);
        walk(after.doc.children, n => {
            const want = n.id && edited.has(n.id) ? settled.expected.get(n.id) : undefined;
            if(!want) return;
            const diff = differences(want, n);
            if(diff.length) warnings.push({ code: "canva_changed", path: edited.get(n.id!), dataId: n.id, message: `Canva stored this differently from what was sent: ${diff.join("; ")}. The returned markup shows what it kept.` });
        });

        return { results, warnings, doc: after.doc, pageIndex: index, uploaded };
    }

    /** Adds a page (optionally sized, titled, and placed after page `after`; -1 = first) */
    async function addPage(opts : { width? : number, height? : number, title? : string, after? : number } = {}) : Promise<{ pageId? : string, pageIndex : number, width : number, height : number }> {
        const { width, height, title, after } = opts;
        let insertAt : NonNullable<Parameters<typeof canvaAddPage>[0]>["insertAt"];
        if(after != null) {
            const { pages } = await pageSummaries();
            if(after < -1 || after >= pages.length) throw reconcileError("bad_request", `There is no page ${after + 1}; the design has ${pages.length} page(s).`);
            const target = after >= 0 ? pages[after]!.id : undefined;
            if(after >= 0 && !target) throw reconcileError("unsupported_page", `Page ${after + 1} can't be used by apps (for example a Canva Docs page).`);
            insertAt = target ? { mode: "after_target", targetPageId: target as PageId } : { mode: "before_first_page" };
        }
        const meta = await canvaAddPage({ ...(width && height ? { dimensions: { width, height } } : {}), ...(title ? { title } : {}), ...(insertAt ? { insertAt } : {}) });
        if(meta.type !== "absolute") throw reconcileError("canva_error", "Canva added an unsupported page.");
        const { pages } = await pageSummaries();
        return { pageId: meta.id, pageIndex: pages.findIndex(p => p.id === meta.id), width: meta.dimensions?.width ?? width ?? 0, height: meta.dimensions?.height ?? height ?? 0 };
    }

    return { brand, fonts, ids, readPage, applyPage, addPage, pageSummaries };
}

