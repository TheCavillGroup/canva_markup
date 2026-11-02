import type { FontRef, ImageRef } from "@canva/asset";
import type { DesignEditing, InlineFormatting, RichtextFormatting, TextRegion } from "@canva/design";
import { fmt } from "../css/mod.ts";
import { DEFAULT_INLINE, parsePage } from "../parse/mod.ts";
import { serialisePage } from "../serialise.ts";
import { checkAgainstBase } from "../base.ts";
import type { Brand } from "../brand.ts";
import type { ApplyWarning, ElementResult, Issue, Node, PageDoc, Paragraph, StyleMap } from "../types.ts";
import { reconcileError } from "./errors.ts";
import type { FontRegistry } from "./fonts.ts";
import { walk, type IdRegistry } from "./ids.ts";
import type { PlanItem } from "./layout.ts";
import { plannedText, snapshotNode, type LiveEntry, type LiveRead } from "./read.ts";
import { noTrace, type Trace } from "./trace.ts";

// The diff: stages every change to a live page on Canva's snapshot, so the caller's single sync() is one undo step.
// Only Canva *types* are imported here; the session (openDesign, sync, uploads) lives in session.ts.

type El = DesignEditing.AbsoluteElement | DesignEditing.GroupContentElement;
type Builder = DesignEditing.ElementStateBuilder;
type CanvaKind = "rect" | "shape" | "text" | "embed" | "group" | "unsupported";

export interface ApplyDeps {
    fonts : FontRegistry,
    ids : IdRegistry,
    trace? : Trace
}

const EPS = 0.011;
const near = (a : number, b : number) => Math.abs(a - b) < EPS;
// Browser layout rounds to 1/64px, so a laid-out stack can come out a few hundredths off: recreating a box for that would lose its Canva-only effects. Text widths stay exact (they decide line breaks)
const SIZE_EPS = 0.1;
const sameSize = (a : number, b : number) => Math.abs(a - b) < SIZE_EPS;

// --- helpers over plan nodes ---

function radii(s : StyleMap) : Array<string> | undefined {
    const r = s["border-radius"];
    if(!r) return;
    const parts = r.split(" ");
    if(parts.every(p => parseFloat(p) === 0)) return;
    const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
    return [a, b!, c!, d!];
}

function canvaKind(n : Node) : CanvaKind {
    if(n.kind === "box" || n.kind === "image") return radii(n.style) ? "shape" : "rect";
    if(n.kind === "shape") return "shape";
    return n.kind;
}

function liveKind(el : El) : CanvaKind {
    return el.type as CanvaKind;
}

/** Rounded rectangle path (CSS border-radius semantics: % per axis, radii scaled down to fit). */
export function roundedPath(w : number, h : number, r : Array<string>) : string {
    const ax = (v : string, size : number) => v.endsWith("%") ? parseFloat(v) / 100 * size : parseFloat(v);
    let c = r.map(v => [ax(v, w), ax(v, h)] as [number, number]);
    const f = Math.min(1, w / (c[0]![0] + c[1]![0] || 1), w / (c[3]![0] + c[2]![0] || 1), h / (c[0]![1] + c[3]![1] || 1), h / (c[1]![1] + c[2]![1] || 1));
    c = c.map(([x, y]) => [x * f, y * f] as [number, number]);
    const [tl, tr, br, bl] = c as [[number, number], [number, number], [number, number], [number, number]];
    const n = (v : number) => fmt(v, 3);
    const arc = ([rx, ry] : [number, number], x : number, y : number) => rx > 0 && ry > 0 ? ` A${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y)}` : ` L${n(x)} ${n(y)}`;
    return `M${n(tl[0])} 0 H${n(w - tr[0])}${arc(tr, w, tr[1])} V${n(h - br[1])}${arc(br, w - br[0], h)} H${n(bl[0])}${arc(bl, 0, h - bl[1])} V${n(tl[1])}${arc(tl, tl[0], 0)} Z`;
}

const bgImage = (s : StyleMap) => /^url\("(.*)"\)$/.exec(s["background-image"] ?? "")?.[1];

function border(s : StyleMap) : { weight : number, color : string } | undefined {
    const m = /^([\d.]+)px solid (#[0-9a-f]{6})$/.exec(s.border ?? "");
    return m ? { weight: Number(m[1]), color: m[2]! } : undefined;
}

function inlineOf(f : Paragraph["runs"][number]["format"]) : InlineFormatting {
    const o : InlineFormatting = { color: f.color, fontWeight: f.fontWeight, fontStyle: f.fontStyle, decoration: f.decoration, strikethrough: f.strikethrough };
    if(f.link) o.link = f.link;
    return o;
}

function paragraphOf(p : Paragraph, fontRefs : Map<string, FontRef>) : RichtextFormatting {
    const f = p.format;
    const o : RichtextFormatting = { fontRef: fontRefs.get(f.fontFamily), fontSize: f.fontSize, textAlign: f.textAlign, lineHeightEm: f.lineHeight, letterSpacingEm: f.letterSpacing, listLevel: f.listLevel };
    if(f.listLevel > 0) o.listMarker = f.listMarker;
    return o;
}

function regions(paragraphs : Array<Paragraph>, fontRefs : Map<string, FontRef>) : Array<TextRegion> {
    const out : Array<TextRegion> = [];
    paragraphs.forEach((p, i) => {
        const pf = paragraphOf(p, fontRefs);
        const runs = p.runs.length ? p.runs : [{ text: "", format: DEFAULT_INLINE }];
        runs.forEach((r, k) => {
            const text = r.text + (k === runs.length - 1 && i < paragraphs.length - 1 ? "\n" : "");
            if(text) out.push({ text, formatting: { ...pf, ...inlineOf(r.format) } });
        });
    });
    return out.length ? out : [{ text: " ", formatting: paragraphOf(paragraphs[0]!, fontRefs) }];
}

/** Every image src a doc uses: <img>, box backgrounds, the page background and shape fill-images */
export function collectSources(doc : PageDoc) : Set<string> {
    const out = new Set<string>();
    const fromStyle = (s : StyleMap) => {
        const u = bgImage(s);
        if(u) out.add(u);
    };
    fromStyle(doc.style);
    walk(doc.children, n => {
        if(n.kind === "image") out.add(n.src);
        if(n.kind === "box") fromStyle(n.style);
        if(n.kind === "shape") for(const p of n.paths) if(p.fillImage) out.add(p.fillImage);
    });
    return out;
}

const FORMAT_CSS : Record<keyof Paragraph["format"], string> = { fontFamily: "font-family", fontSize: "font-size", textAlign: "text-align", lineHeight: "line-height", letterSpacing: "letter-spacing", listLevel: "list level", listMarker: "list-style-type" };

/** What Canva changed between the state the applier staged and the re-read. Groups are skipped: Canva re-fits them to their members. */
export function differences(want : Node, got : Node) : Array<string> {
    if(want.kind === "group") return [];
    if(want.kind !== got.kind) return [`became a ${got.kind}`];
    const out : Array<string> = [];
    for(const k of new Set([...Object.keys(want.style), ...Object.keys(got.style)])) {
        const a = want.style[k], b = got.style[k];
        if(a === b) continue;
        if(a?.endsWith("px") && b?.endsWith("px") && near(parseFloat(a), parseFloat(b))) continue;
        out.push(`${k} ${a ?? "(none)"} → ${b ?? "(none)"}`);
    }
    if(want.kind === "text" && got.kind === "text") {
        if(want.paragraphs.length !== got.paragraphs.length) {
            out.push(`${want.paragraphs.length} paragraphs → ${got.paragraphs.length}`);
        } else {
            want.paragraphs.forEach((p, i) => {
                const q = got.paragraphs[i]!;
                for(const k in FORMAT_CSS) {
                    const key = k as keyof Paragraph["format"];
                    if(p.format[key] !== q.format[key]) out.push(`paragraph ${i + 1} ${FORMAT_CSS[key]} ${p.format[key]} → ${q.format[key]}`);
                }
                if(p.runs.map(r => r.text).join("") !== q.runs.map(r => r.text).join("")) out.push(`paragraph ${i + 1} text`);
            });
        }
    }
    return out;
}

/** How the applier left the page: pre-order ids for the re-read, and what each touched element should read back as. */
export interface Settled {
    hint? : Array<string | undefined>,
    expected : Map<string, Node>
}

export interface ExecuteContext {
    /** fontFamily → fontRef for every family the doc uses */
    fontRefs : Map<string, FontRef>,
    /** image src → imageRef for every src the doc uses */
    img : (src : string) => ImageRef,
    /** filled in: one entry per element */
    results : Array<ElementResult>,
    /** filled in */
    warnings : Array<ApplyWarning>,
    deps : ApplyDeps,
    /** filled in, for the re-read after sync */
    settled : Settled
}

/**
 * The rules a host checks against the page it served (ids from that page, placeholders and locked elements
 * untouched, page size kept), checked against the live page itself.
 */
export function conflictsWithLive(live : PageDoc, doc : PageDoc, brand : Brand) : Array<Issue> {
    // Round-trip the live doc so it compares like a page the reader parsed back from markup
    const base = parsePage(serialisePage(live, brand), brand).doc;
    return base ? checkAgainstBase(base, doc, brand) : [];
}

/**
 * Stages the changes that turn `live` into `doc` (laid out as `items`) on an open page. Doesn't sync.
 * Returns whether anything changed. `live` must be the page as it is now (check its revision first).
 */
export async function executeApply(page : DesignEditing.AbsolutePage, helpers : DesignEditing.PageHelpers, live : LiveRead, items : Array<PlanItem>, doc : PageDoc, ctx : ExecuteContext) : Promise<boolean> {
    const trace = ctx.deps.trace ?? noTrace;
    const brand = ctx.deps.fonts.brand;
    const b = helpers.elementStateBuilder;
    const els = page.elements;
    const pageId = page.id;
    let changed = false;
    const touched : Array<{ el : El, id : string, node : Node }> = [];

    const planIds = new Map<string, { item : PlanItem, group? : PlanItem }>();
    for(const it of items) {
        if(it.node.id) planIds.set(it.node.id, { item: it });
        for(const c of it.children ?? []) if(c.node.id) planIds.set(c.node.id, { item: c, group: it });
    }
    const entries = new Map(live.entries);

    // --- state builders ---

    const fillOpts = (n : Node) : DesignEditing.FillOpts | undefined => {
        const src = n.kind === "image" ? n.src : bgImage(n.style);
        const color = n.style["background-color"];
        if(src) return { mediaContainer: { type: "image", imageRef: ctx.img(src) }, ...(color ? { colorContainer: { type: "solid", color } } : {}) };
        if(color) return { colorContainer: { type: "solid", color } };
        return undefined;
    };
    const strokeOpts = (n : Node) => {
        const bd = border(n.style);
        return bd ? { weight: bd.weight, colorContainer: { type: "solid" as const, color: bd.color } } : undefined;
    };

    const stateFor = (it : PlanItem, x : number, y : number) => {
        const n = it.node;
        const base = { top: y, left: x, rotation: it.rotation, transparency: Number((1 - it.opacity).toFixed(4)) };
        const kind = canvaKind(n);

        if(n.kind === "text") return b.createTextElement({ ...base, width: it.width, text: { regions: regions(n.paragraphs, ctx.fontRefs) } });
        if(kind === "rect") return b.createRectElement({ ...base, width: it.width, height: it.height, fill: fillOpts(n), stroke: strokeOpts(n) });
        if(n.kind === "shape") {
            return b.createShapeElement({
                ...base, width: it.width, height: it.height,
                viewBox: { left: n.viewBox[0], top: n.viewBox[1], width: n.viewBox[2], height: n.viewBox[3] },
                paths: n.paths.map(p => ({
                    d: p.d,
                    fill: p.fillImage ? { mediaContainer: { type: "image" as const, imageRef: ctx.img(p.fillImage) }, ...(p.fill ? { colorContainer: { type: "solid" as const, color: p.fill } } : {}) } : { colorContainer: { type: "solid" as const, color: p.fill ?? "#000000" } },
                    ...(p.stroke ? { stroke: { weight: p.strokeWidth ?? 1, colorContainer: { type: "solid" as const, color: p.stroke } } } : {})
                }))
            });
        }
        if(kind === "shape" && (n.kind === "box" || n.kind === "image")) {
            const fill = fillOpts(n) ?? { colorContainer: { type: "solid" as const, color: "#ffffff" } };
            const stroke = strokeOpts(n);
            return b.createShapeElement({
                ...base, width: it.width, height: it.height,
                viewBox: { left: 0, top: 0, width: it.width, height: it.height },
                paths: [{ d: roundedPath(it.width, it.height, radii(n.style)!), fill, ...(stroke ? { stroke } : {}) }]
            });
        }
        throw reconcileError("not_supported", `${n.kind} elements can't be created.`);
    };

    // --- comparisons ---


    const needsReplace = (e : LiveEntry, it : PlanItem) : string | undefined => {
        const n = it.node, o = e.node;
        if(n.kind === "unsupported" || n.kind === "embed") return;
        if(canvaKind(n) !== liveKind(e.el)) return "its type changed";
        if(n.kind === "text") return near(e.el.width, it.width) ? undefined : "its width changed";
        if(n.kind === "group") return;
        if(!sameSize(e.el.width, it.width) || !sameSize(e.el.height, it.height)) return "its size changed";
        if(n.kind === "shape" && o.kind === "shape") {
            if(n.viewBox.join() !== o.viewBox.join() || n.paths.length !== o.paths.length) return "its shape changed";
            for(let i = 0; i < n.paths.length; i++) {
                const a = n.paths[i]!, z = o.paths[i]!;
                if(a.d !== z.d || !!a.stroke !== !!z.stroke || a.fillImage !== z.fillImage) return "its shape changed";
            }
        }
        if(canvaKind(n) === "shape" && (n.kind === "box" || n.kind === "image")) {
            if(n.style["border-radius"] !== o.style["border-radius"] || n.style.border !== o.style.border || bgImage(n.style) !== bgImage(o.style) || (n.kind === "image" && o.kind === "image" && n.src !== o.src)) return "its shape changed";
        }
        return;
    };

    /** In-place edits on an existing element. Returns true if anything changed. */
    const update = (e : LiveEntry, it : PlanItem) : boolean => {
        const el = e.el, n = it.node, o = e.node;
        if(el.locked) return false;
        let did = false;
        const set = <K extends "top" | "left" | "rotation" | "transparency">(k : K, v : number) => {
            if(!near(el[k], v)) {
                el[k] = v;
                did = true;
            }
        };
        set("top", it.top);
        set("left", it.left);
        set("rotation", it.rotation);
        set("transparency", Number((1 - it.opacity).toFixed(4)));

        if(el.type === "rect" && (n.kind === "box" || n.kind === "image")) {
            const color = n.style["background-color"], src = n.kind === "image" ? n.src : bgImage(n.style);
            const oColor = o.style["background-color"], oSrc = o.kind === "image" ? o.src : bgImage(o.style);
            if(color !== oColor) {
                el.fill.colorContainer.set(color ? { type: "solid", color } : undefined);
                did = true;
            }
            if(src !== oSrc) {
                el.fill.mediaContainer.set(src ? { type: "image", imageRef: ctx.img(src), flipX: false, flipY: false } : undefined);
                did = true;
            }
            if(n.style.border !== o.style.border) {
                const bd = border(n.style);
                el.stroke.weight = bd?.weight ?? 0;
                if(bd) el.stroke.colorContainer.set({ type: "solid", color: bd.color });
                did = true;
            }
        }

        if(el.type === "shape") {
            const paths = el.paths.toArray();
            const want = n.kind === "shape" ? n.paths : [{ fill: n.style["background-color"], stroke: border(n.style)?.color, strokeWidth: border(n.style)?.weight }];
            const had = o.kind === "shape" ? o.paths : [{ fill: o.style["background-color"], stroke: border(o.style)?.color, strokeWidth: border(o.style)?.weight }];
            want.forEach((p, i) => {
                const lp = paths[i];
                if(!lp) return;
                if(p.fill !== had[i]?.fill && p.fill) {
                    lp.fill.colorContainer.set({ type: "solid", color: p.fill });
                    did = true;
                }
                if(lp.stroke && (p.stroke !== had[i]?.stroke || p.strokeWidth !== had[i]?.strokeWidth)) {
                    if(p.stroke) lp.stroke.colorContainer.set({ type: "solid", color: p.stroke });
                    lp.stroke.weight = p.strokeWidth ?? lp.stroke.weight;
                    did = true;
                }
            });
        }

        if(el.type === "text" && n.kind === "text" && o.kind === "text" && JSON.stringify(n.paragraphs) !== JSON.stringify(o.paragraphs)) {
            const regs = regions(n.paragraphs, ctx.fontRefs);
            const full = regs.map(r => r.text).join("");
            el.text.replaceText({ index: 0, length: el.text.readPlaintext().length }, full);
            let i = 0;
            for(const r of regs) {
                const { fontRef: _a, fontSize: _b, textAlign: _c, lineHeightEm: _d, letterSpacingEm: _e, listLevel: _f, listMarker: _g, ...inl } = r.formatting ?? {};
                el.text.formatText({ index: i, length: r.text.length }, inl);
                i += r.text.length;
            }
            i = 0;
            n.paragraphs.forEach((p, k) => {
                const len = p.runs.reduce((a, r) => a + r.text.length, 0) + (k < n.paragraphs.length - 1 ? 1 : 0);
                if(i < full.length) el.text.formatParagraph({ index: i, length: Math.max(1, Math.min(len, full.length - i)) }, paragraphOf(p, ctx.fontRefs));
                i += len;
            });
            did = true;
        }
        return did;
    };

    // --- pass 1: dissolve groups whose membership or children change structurally ---

    const dissolved = new Set<string>();
    for(const [id, e] of live.entries) {
        if(e.el.type !== "group") continue;
        const group = e.el;
        const want = planIds.get(id);
        const liveKids = [...live.entries.entries()].filter(([, x]) => x.group === group).map(([k]) => k);
        const planKids = want?.item.children?.map(c => c.node.id) ?? [];
        let structural = !want || want.item.node.kind !== "group" || planKids.length !== liveKids.length || planKids.some(k => !k || !liveKids.includes(k));
        if(!structural && want) {
            structural = want.item.children!.some(c => {
                const ce = live.entries.get(c.node.id!)!;
                return !!needsReplace(ce, c);
            });
        }
        // Keep a group that's simply deleted along with all its children: delete it whole
        const childrenElsewhere = liveKids.some(k => planIds.has(k));
        if(!want && !childrenElsewhere) continue;
        if(!structural) continue;
        // Regrouping would need helpers.group(), which breaks the session (Canva bug): only a plain ungroup is allowed
        if(want && want.item.node.kind === "group") {
            throw reconcileError("not_supported", `Group "${id}" would have to be rebuilt (its members changed, or a member was resized or reshaped), and creating groups is currently broken in Canva's API. Keep its members and their sizes as they are, or remove the <group> wrapper to ungroup it.`, { dataId: id });
        }

        const before = group.contents.toArray();
        const loose = await helpers.ungroup({ element: group });
        changed = true;
        dissolved.add(id);
        entries.delete(id);
        liveKids.forEach(k => {
            const x = entries.get(k)!;
            const idx = before.indexOf(x.el as DesignEditing.GroupContentElement);
            entries.set(k, { node: x.node, el: loose[idx] ?? x.el });
        });
    }

    // --- pass 2: deletions ---

    for(const [id, e] of entries) {
        if(planIds.has(id)) continue;
        if(e.group && !dissolved.has(liveIdOf(live, e.group))) continue;
        if(e.el.locked) continue;
        els.delete(e.el as DesignEditing.AbsoluteElement);
        ctx.results.push({ action: "deleted", path: "", id });
        changed = true;
    }

    // --- pass 3: updates, replacements and creations, in plan order ---

    const finalTop : Array<DesignEditing.AbsoluteElement> = [];

    const place = (it : PlanItem, x : number, y : number) : El => {
        const id = it.node.id;
        const e = id ? entries.get(id) : undefined;
        const abs = { ...it, left: x, top: y };

        if(e) {
            const why = needsReplace(e, abs);
            if(!why) {
                const did = update(e, abs);
                if(did) changed = true;
                ctx.results.push({ action: did ? "updated" : "unchanged", path: it.node.path, id });
                touched.push({ el: e.el, id: id!, node: it.node });
                return e.el;
            }
            const created = els.insertAfter(e.el as DesignEditing.AbsoluteElement, stateFor(it, x, y))!;
            els.delete(e.el as DesignEditing.AbsoluteElement);
            changed = true;
            ctx.results.push({ action: "replaced", path: it.node.path, id, warning: `Recreated because ${why}; Canva-only effects on it (filters, crops, animations) may be lost.` });
            touched.push({ el: created, id: id!, node: it.node });
            return created;
        }

        const created = els.insertBefore(undefined, stateFor(it, x, y))!;
        const newId = ctx.deps.ids.mint(pageId, it.node.kind);
        changed = true;
        ctx.results.push({ action: "created", path: it.node.path, newId });
        touched.push({ el: created, id: newId, node: it.node });
        return created;
    };

    for(const it of items) {
        const id = it.node.id;

        if(it.node.kind === "group") {
            const e = id ? entries.get(id) : undefined;
            if(e && e.el.type === "group") {
                // Same membership: move the group, then edit children in place (positions relative to the group)
                let did = update({ ...e, node: { ...e.node } }, it);
                for(const c of it.children ?? []) {
                    const ce = entries.get(c.node.id!)!;
                    const d = update(ce, c);
                    did ||= d;
                    ctx.results.push({ action: d ? "updated" : "unchanged", path: c.node.path, id: c.node.id });
                    touched.push({ el: ce.el, id: c.node.id!, node: c.node });
                }
                if(did) changed = true;
                ctx.results.push({ action: did ? "updated" : "unchanged", path: it.node.path, id });
                touched.push({ el: e.el, id: id!, node: it.node });
                finalTop.push(e.el);
                continue;
            }

            // New groups need helpers.group(), which breaks the session (Canva bug, reproduced with their
            // own docs example; see ARCHITECTURE.md C22 for the creation approach). The server rejects these first.
            throw reconcileError("not_supported", "New groups can't be created right now (a Canva API bug). Remove the <group> wrapper.", { path: it.node.path });
        }

        finalTop.push(place(it, it.left, it.top) as DesignEditing.AbsoluteElement);
    }

    // --- page background ---

    if(page.background) {
        const before = live.doc.style, want = doc.style;
        if(want["background-color"] !== before["background-color"]) {
            page.background.colorContainer.set(want["background-color"] ? { type: "solid", color: want["background-color"] } : undefined);
            changed = true;
        }
        const src = bgImage(want);
        if(src !== bgImage(before)) {
            page.background.mediaContainer.set(src ? { type: "image", imageRef: ctx.img(src), flipX: false, flipY: false } : undefined);
            changed = true;
        }
    }

    trace("pass 4: reorder", { top: finalTop.length });
    // --- pass 4: stacking order = document order ---

    let prev : DesignEditing.AbsoluteElement | undefined;
    let moved = 0;
    for(const el of finalTop) {
        const arr = els.toArray();
        if(prev === undefined) {
            if(arr[0] !== el) {
                els.moveBefore(arr[0], el);
                moved++;
            }
        } else if(arr[arr.indexOf(prev) + 1] !== el) {
            els.moveAfter(prev, el);
            moved++;
        }
        prev = el;
    }
    if(moved) changed = true;

    trace("snapshot", { touched: touched.length });
    // Remember fingerprints so the re-read after sync hands back the same ids
    const refs = new Set<string>();
    for(const t of touched) collectTextRefs(t.el, refs);
    const families = await ctx.deps.fonts.familiesFor([...refs]);
    const w = page.dimensions?.width ?? 1000, h = page.dimensions?.height ?? 1000;
    for(const t of touched) {
        const snap = snapshotNode(t.el, families, w, h, brand);
        await ctx.deps.ids.remember(pageId, snap, t.id);
        if(t.node.kind === "text") {
            const planned = plannedText(t.node, t.el, w, h, brand);
            await ctx.deps.ids.remember(pageId, planned, t.id);
            ctx.settled.expected.set(t.id, planned);
        } else {
            ctx.settled.expected.set(t.id, snap);
        }
    }

    // Same pre-order walk as readPage, so the re-read can line ids up by position
    const idOf = new Map<El, string>(touched.map(t => [t.el, t.id]));
    const hint : Array<string | undefined> = [];
    for(const el of els.toArray()) {
        hint.push(idOf.get(el));
        if(el.type === "group") for(const c of el.contents.toArray()) hint.push(idOf.get(c));
    }
    ctx.settled.hint = hint;

    return changed;
}

function liveIdOf(live : LiveRead, el : DesignEditing.GroupElement) : string {
    for(const [id, e] of live.entries) if(e.el === el) return id;
    return "";
}

function collectTextRefs(el : El, out : Set<string>) {
    if(el.type === "text") for(const r of el.text.readTextRegions()) if(r.formatting?.fontRef) out.add(r.formatting.fontRef);
    if(el.type === "group") for(const c of el.contents.toArray()) collectTextRefs(c, out);
}
