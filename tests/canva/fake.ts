// A small in-memory stand-in for the parts of Canva's DesignEditing API the reconciler uses: element lists,
// state builders, text editing and ungroup. Behaviour follows what the real API does in the spike logs,
// not its whole surface.

// deno-lint-ignore-file no-explicit-any
import type { DesignEditing } from "@canva/design";
import type { PageDoc, StyleMap } from "../../mod.ts";
import type { PlanItem } from "../../canva/layout.ts";

type Fmt = Record<string, unknown>;

const container = (ref? : unknown) => {
    const c = { ref, set(v : unknown) { c.ref = v; } };
    return c;
};

function fill(opts? : any) {
    return {
        colorContainer: container(opts?.colorContainer ? { type: "solid", color: opts.colorContainer.color.toUpperCase() } : undefined),
        mediaContainer: container(opts?.mediaContainer ? { type: "image", imageRef: opts.mediaContainer.imageRef } : undefined)
    };
}

function stroke(opts? : any) {
    return { weight: opts?.weight ?? 0, colorContainer: container(opts?.colorContainer ? { type: "solid", color: opts.colorContainer.color } : undefined) };
}

/** Rich text as one formatting record per character; regions merge runs of equal formatting */
function richText(regions : Array<{ text : string, formatting? : Fmt }>) {
    let chars : Array<{ ch : string, f : Fmt }> = regions.flatMap(r => [...r.text].map(ch => ({ ch, f: { ...r.formatting } })));
    const PARA = ["fontRef", "fontSize", "textAlign", "lineHeightEm", "letterSpacingEm", "listLevel", "listMarker"];
    return {
        readPlaintext: () => chars.map(c => c.ch).join(""),
        readTextRegions() {
            const out : Array<{ text : string, formatting : Fmt }> = [];
            for(const c of chars) {
                const last = out.at(-1);
                if(last && JSON.stringify(last.formatting) === JSON.stringify(c.f)) last.text += c.ch;
                else out.push({ text: c.ch, formatting: { ...c.f } });
            }
            return out;
        },
        replaceText(range : { index : number, length : number }, text : string) {
            const f = chars[range.index]?.f ?? chars.at(-1)?.f ?? {};
            chars = [...chars.slice(0, range.index), ...[...text].map(ch => ({ ch, f: { ...f } })), ...chars.slice(range.index + range.length)];
        },
        formatText(range : { index : number, length : number }, fmt : Fmt) {
            for(let i = range.index; i < range.index + range.length; i++) Object.assign(chars[i]!.f, fmt);
        },
        formatParagraph(range : { index : number, length : number }, fmt : Fmt) {
            // Canva widens the range to whole paragraphs
            let a = range.index, b = range.index + range.length;
            while(a > 0 && chars[a - 1]!.ch !== "\n") a--;
            while(b < chars.length && chars[b - 1]?.ch !== "\n") b++;
            const p = Object.fromEntries(Object.entries(fmt).filter(([k]) => PARA.includes(k)));
            for(let i = a; i < b; i++) Object.assign(chars[i]!.f, p);
        }
    };
}

function list<T>(items : Array<T>) {
    return {
        items,
        toArray: () => [...items],
        insertAfter(target : T | undefined, el : T) {
            items.splice(target === undefined ? 0 : items.indexOf(target) + 1, 0, el);
            return el;
        },
        insertBefore(target : T | undefined, el : T) {
            items.splice(target === undefined ? items.length : items.indexOf(target), 0, el);
            return el;
        },
        delete(el : T) {
            const i = items.indexOf(el);
            if(i < 0) throw new Error("deleting an element that isn't on the page");
            items.splice(i, 1);
        },
        moveBefore(target : T, el : T) {
            items.splice(items.indexOf(el), 1);
            items.splice(items.indexOf(target), 0, el);
        },
        moveAfter(target : T, el : T) {
            items.splice(items.indexOf(el), 1);
            items.splice(items.indexOf(target) + 1, 0, el);
        }
    };
}

const base = (o : any) => ({ left: o.left, top: o.top, width: o.width ?? 0, height: o.height ?? 0, rotation: o.rotation ?? 0, transparency: o.transparency ?? 0, locked: o.locked ?? false });

/** Element state builders: states are plain descriptions until inserted */
export const builder = {
    createRectElement: (o : any) => ({ state: "rect", ...o }),
    createShapeElement: (o : any) => ({ state: "shape", ...o }),
    createTextElement: (o : any) => ({ state: "text", ...o })
};

/** A live element from a state (or a description in the same shape) */
export function element(o : any) : any {
    const kind = o.state ?? o.type;
    if(kind === "rect") return { type: "rect", ...base(o), fill: fill(o.fill), stroke: stroke(o.stroke) };
    if(kind === "shape") {
        return {
            type: "shape", ...base(o), viewBox: o.viewBox,
            paths: list(o.paths.map((p : any) => ({ d: p.d, fill: fill(p.fill), ...(p.stroke ? { stroke: stroke(p.stroke) } : {}) })))
        };
    }
    if(kind === "text") {
        const paras = o.text.regions.map((r : any) => r.text).join("").split("\n").length;
        return { type: "text", ...base(o), height: o.height ?? paras * 20, text: richText(o.text.regions) };
    }
    if(kind === "group") return { type: "group", ...base(o), contents: list(o.children.map(element)) };
    if(kind === "embed") return { type: "embed", ...base(o), url: o.url };
    return { type: "unsupported", ...base(o) };
}

export interface FakePage {
    page : DesignEditing.AbsolutePage,
    helpers : DesignEditing.PageHelpers,
    /** top-level live elements, in z order */
    els : () => Array<any>
}

export function fakePage(elements : Array<any>, opts : { id? : string, width? : number, height? : number, background? : string, locked? : boolean } = {}) : FakePage {
    const els = list(elements.map(element));
    const page : any = {
        type: "absolute",
        id: opts.id ?? "PAGE1",
        locked: opts.locked ?? false,
        dimensions: { width: opts.width ?? 800, height: opts.height ?? 600 },
        background: fill(opts.background ? { colorContainer: { color: opts.background } } : undefined),
        elements: {
            toArray: els.toArray,
            delete: els.delete,
            moveBefore: els.moveBefore,
            moveAfter: els.moveAfter,
            insertAfter: (t : any, s : any) => els.insertAfter(t, element(s)),
            insertBefore: (t : any, s : any) => els.insertBefore(t, element(s))
        }
    };
    const helpers : any = {
        elementStateBuilder: builder,
        // Children come out in place of the group, in page coordinates
        ungroup({ element: g } : { element : any }) {
            const kids = g.contents.toArray();
            for(const k of kids) {
                k.left += g.left;
                k.top += g.top;
            }
            els.items.splice(els.items.indexOf(g), 1, ...kids);
            return Promise.resolve(kids);
        }
    };
    return { page, helpers, els: () => els.items };
}

/** Stand-in for findFonts with an empty library */
export const noFonts = (() => Promise.resolve({ fonts: [] })) as any;

const px = (s : StyleMap, k : string) => parseFloat(s[k] ?? "0");

/**
 * Layout for absolutely placed docs, without a DOM: each element's box is its left/top/width/height.
 * Text gets 20px per paragraph. Groups' children are relative to the group's box, as layout() returns them.
 */
export function absolutePlan(doc : PageDoc) : Array<PlanItem> {
    const item = (n : any) : PlanItem => {
        const s = n.style as StyleMap;
        const it : PlanItem = {
            node: n,
            left: px(s, "left"), top: px(s, "top"), width: px(s, "width"),
            height: n.kind === "text" ? n.paragraphs.length * 20 : px(s, "height"),
            rotation: Number(/rotate\((-?[\d.]+)deg\)/.exec(s.transform ?? "")?.[1] ?? 0),
            opacity: s.opacity != null ? Number(s.opacity) : 1
        };
        if(n.kind === "group") {
            const kids = n.children.map(item);
            const minL = Math.min(...kids.map((k : PlanItem) => k.left)), minT = Math.min(...kids.map((k : PlanItem) => k.top));
            for(const k of kids) {
                k.left -= minL;
                k.top -= minT;
            }
            it.left += minL;
            it.top += minT;
            it.width = Math.max(...kids.map((k : PlanItem) => k.left + k.width));
            it.height = Math.max(...kids.map((k : PlanItem) => k.top + k.height));
            it.children = kids;
        }
        return it;
    };
    return doc.children.map(item);
}
