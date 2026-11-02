import type { DesignEditing, TextRegion } from "@canva/design";
import { fmt } from "../css/mod.ts";
import { DEFAULT_INLINE, paragraphDefaults, parsePage } from "../parse/mod.ts";
import { serialiseNode } from "../serialise.ts";
import { CAVILL, type Brand } from "../brand.ts";
import type { InlineFormat, Node, PageDoc, Paragraph, ParagraphFormat, ShapePath, StyleMap, TextNode } from "../types.ts";
import type { FontRegistry } from "./fonts.ts";
import { revisionOf, walk, type IdRegistry } from "./ids.ts";

// Live Canva page → canonical PageDoc (exactly what get_page shows Claude), plus a map from each
// node to its live element so the applier can act on it.

type Live = DesignEditing.AbsoluteElement | DesignEditing.GroupContentElement;

export interface LiveEntry {
    node : Node,
    el : Live,
    group? : DesignEditing.GroupElement
}

export interface LiveRead {
    doc : PageDoc,
    entries : Map<string, LiveEntry>,
    /** top-level live elements in z-order, with their ids */
    order : Array<{ id : string, el : DesignEditing.AbsoluteElement }>
}

const px = (n : number) => `${fmt(n)}px`;

function geometry(el : Live, withHeight = true) : StyleMap {
    const s : StyleMap = { position: "absolute", left: px(el.left), top: px(el.top), width: px(el.width) };
    if(withHeight) s.height = px(el.height);
    if(Math.abs(el.rotation) > 0.004) s.transform = `rotate(${fmt(el.rotation)}deg)`;
    if(el.transparency > 0.0005) s.opacity = fmt(1 - el.transparency, 3);
    return s;
}

const placeholder = (el : Live, detail : string) : Node => ({ kind: "unsupported", path: "", detail, style: geometry(el), ...(el.locked ? { locked: true } : {}) });

const solid = (ref : DesignEditing.ColorFill | undefined) : string | undefined | null =>
    ref == null ? undefined : ref.type === "solid" ? ref.color.toLowerCase() : null;

function inline(f : Partial<TextRegion["formatting"]> | undefined) : InlineFormat {
    return {
        color: f?.color?.toLowerCase() ?? DEFAULT_INLINE.color,
        fontWeight: f?.fontWeight ?? DEFAULT_INLINE.fontWeight,
        fontStyle: f?.fontStyle ?? DEFAULT_INLINE.fontStyle,
        decoration: f?.decoration ?? DEFAULT_INLINE.decoration,
        strikethrough: f?.strikethrough ?? DEFAULT_INLINE.strikethrough,
        link: f?.link ?? DEFAULT_INLINE.link
    };
}

function paragraphFormat(f : Partial<TextRegion["formatting"]> | undefined, families : Map<string, string>, brand : Brand) : ParagraphFormat {
    const DEFAULT_PARAGRAPH = paragraphDefaults(brand);
    return {
        fontFamily: f?.fontRef ? families.get(f.fontRef) ?? `ref:${f.fontRef}` : DEFAULT_PARAGRAPH.fontFamily,
        fontSize: f?.fontSize != null ? Number(fmt(f.fontSize)) : DEFAULT_PARAGRAPH.fontSize,
        textAlign: f?.textAlign ?? DEFAULT_PARAGRAPH.textAlign,
        lineHeight: f?.lineHeightEm != null ? Number(f.lineHeightEm.toFixed(4)) : DEFAULT_PARAGRAPH.lineHeight,
        letterSpacing: f?.letterSpacingEm != null ? Number(f.letterSpacingEm.toFixed(4)) : DEFAULT_PARAGRAPH.letterSpacing,
        listLevel: f?.listLevel ?? 0,
        listMarker: (f?.listLevel ?? 0) > 0 ? f?.listMarker ?? "disc" : "none"
    };
}

function readText(el : DesignEditing.TextElement, families : Map<string, string>, brand : Brand) : Array<Paragraph> {
    const paragraphs : Array<Paragraph> = [];
    let cur : Paragraph | undefined;
    let last : TextRegion | undefined;
    for(const region of el.text.readTextRegions()) {
        last = region;
        const parts = region.text.split("\n");
        parts.forEach((part, i) => {
            const ends = i < parts.length - 1;
            // A paragraph takes its format from the region its first character is in; the "\n" before it belongs to the previous one
            if(part || ends) cur ??= { format: paragraphFormat(region.formatting, families, brand), runs: [] };
            if(part) cur!.runs.push({ text: part, format: inline(region.formatting) });
            if(ends) {
                paragraphs.push(cur!);
                cur = undefined;
            }
        });
    }
    // Text ending in "\n" has an empty last paragraph, formatted like the one before it
    if(!cur && last?.text.endsWith("\n")) cur = { format: paragraphFormat(last.formatting, families, brand), runs: [] };
    if(cur || paragraphs.length === 0) paragraphs.push(cur ?? { format: paragraphDefaults(brand), runs: [] });
    return paragraphs;
}

function readFill(fill : DesignEditing.Fill | DesignEditing.PathFill) : { color? : string, image? : string } | null {
    const media = fill.mediaContainer?.ref;
    if(media?.type === "video") return null;
    const color = solid(fill.colorContainer?.ref);
    if(color === null) return null;
    return { color, image: media?.type === "image" ? `canva:${media.imageRef}` : undefined };
}

function readElement(el : Live, families : Map<string, string>, brand : Brand) : Node {
    const locked = el.locked ? { locked: true } : {};

    if(el.type === "rect") {
        const fill = readFill(el.fill);
        if(!fill) return placeholder(el, el.fill.mediaContainer?.ref?.type === "video" ? "video" : "gradient");
        const style = geometry(el);
        if(el.stroke.weight > 0) {
            const c = solid(el.stroke.colorContainer.ref);
            if(c == null) return placeholder(el, "stroke");
            style.border = `${fmt(el.stroke.weight)}px solid ${c}`;
        }
        if(fill.image) return { kind: "image", path: "", src: fill.image, style, ...locked };
        if(fill.color) style["background-color"] = fill.color;
        if(!fill.color && !style.border) return placeholder(el, "empty");
        return { kind: "box", path: "", style, children: [], ...locked };
    }

    if(el.type === "shape") {
        const paths : Array<ShapePath> = [];
        for(const p of el.paths.toArray()) {
            const fill = readFill(p.fill);
            if(!fill) return placeholder(el, "shape-fill");
            const sp : ShapePath = { d: p.d };
            if(fill.color) sp.fill = fill.color;
            if(fill.image) sp.fillImage = fill.image;
            if(p.stroke && p.stroke.weight > 0) {
                const c = solid(p.stroke.colorContainer.ref);
                if(c == null) return placeholder(el, "stroke");
                sp.stroke = c;
                sp.strokeWidth = Number(fmt(p.stroke.weight));
            }
            paths.push(sp);
        }
        const vb = el.viewBox;
        return { kind: "shape", path: "", viewBox: [vb.left, vb.top, vb.width, vb.height], paths, style: geometry(el), ...locked };
    }

    if(el.type === "text") {
        return { kind: "text", path: "", style: geometry(el, false), paragraphs: readText(el, families, brand), measuredHeight: Number(fmt(el.height)), ...locked };
    }

    if(el.type === "embed") return { kind: "embed", path: "", src: el.url, style: geometry(el), ...locked };

    if(el.type === "group") {
        const children = el.contents.toArray().map(c => readElement(c, families, brand));
        return { kind: "group", path: "", style: geometry(el), children, ...locked };
    }

    return placeholder(el, "unsupported");
}

/** Anything the validator would reject (e.g. odd Canva paths) is preserved as a placeholder instead. */
function canonicalise(n : Node, el : Live, width : number, height : number, brand : Brand) : Node {
    if(n.kind === "group") {
        const kids = (el as DesignEditing.GroupElement).contents.toArray();
        n.children = n.children.map((c, i) => canonicalise(c, kids[i]!, width, height, brand));
        // A group whose children all collapsed is still a group of placeholders: keep it
    }
    // Placeholders and embeds are only valid with a data-id, so check with temporary ids
    let k = 0;
    const tagged = structuredClone(n);
    walk([tagged], x => { x.id = `tmp${k++}`; });
    // Page sizes can be fractional (559.37 x 793.7) but <page> only takes whole px
    const parsed = parsePage(`<page width="${Math.max(40, Math.min(8000, Math.round(width)))}" height="${Math.max(40, Math.min(8000, Math.round(height)))}">${serialiseNode(tagged, brand)}</page>`, brand);
    const out = parsed.doc?.children[0];
    if(!out) return placeholder(el, "unreadable");
    walk([out], x => { delete x.id; });
    return out;
}

/** Canonical node for one live element (used to fingerprint elements right after editing them). */
export function snapshotNode(el : Live, families : Map<string, string>, width : number, height : number, brand : Brand = CAVILL) : Node {
    return canonicalise(readElement(el, families, brand), el, width, height, brand);
}

/** What an edited text element reads back as after sync (read in-session, Canva can drop the colour of some list items). */
export function plannedText(n : TextNode, el : Live, width : number, height : number, brand : Brand = CAVILL) : Node {
    return canonicalise({ kind: "text", path: "", style: geometry(el, false), paragraphs: n.paragraphs, ...(el.locked ? { locked: true } : {}) }, el, width, height, brand);
}

function collectRefs(el : Live, out : Set<string>) {
    if(el.type === "text") for(const r of el.text.readTextRegions()) if(r.formatting?.fontRef) out.add(r.formatting.fontRef);
    if(el.type === "group") for(const c of el.contents.toArray()) collectRefs(c, out);
}

/**
 * Reads a live page as canonical markup (what a reader of the page should see), with sticky data-ids and a revision.
 * `hint` is the id list an apply left the page in (see {@link IdRegistry}).
 */
export async function readLivePage(page : DesignEditing.AbsolutePage, fonts : FontRegistry, ids : IdRegistry, hint? : Array<string | undefined>) : Promise<LiveRead> {
    const brand = fonts.brand;
    const dims = page.dimensions ?? { width: 0, height: 0 };
    const width = Math.round(dims.width), height = Math.round(dims.height);
    const els = page.elements.toArray();

    const refs = new Set<string>();
    for(const el of els) collectRefs(el, refs);
    const families = await fonts.familiesFor([...refs]);

    const style : StyleMap = {};
    if(page.background) {
        const bg = readFill(page.background);
        if(bg?.color) style["background-color"] = bg.color;
        if(bg?.image) style["background-image"] = `url("${bg.image}")`;
    }

    const children = els.map(el => canonicalise(readElement(el, families, brand), el, width, height, brand));
    const doc : PageDoc = { width, height, pageId: page.id, style, children };
    if(page.locked) doc.locked = true;

    await ids.assign(page.id, doc, hint);
    doc.revision = await revisionOf(doc, brand);

    const entries = new Map<string, LiveEntry>();
    const order : LiveRead["order"] = [];
    doc.children.forEach((n, i) => {
        const el = els[i]!;
        entries.set(n.id!, { node: n, el });
        order.push({ id: n.id!, el });
        if(n.kind === "group" && el.type === "group") {
            const kids = el.contents.toArray();
            n.children.forEach((c, k) => entries.set(c.id!, { node: c, el: kids[k]!, group: el }));
        }
    });

    // Every id must map to a live element
    walk(doc.children, n => {
        if(n.id && !entries.has(n.id)) throw new Error(`Serialiser lost element ${n.id}`);
    });
    return { doc, entries, order };
}
