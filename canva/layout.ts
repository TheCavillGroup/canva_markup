import { intrinsicWidths, layoutParagraphs, supportsFont, weightVisible, type ParagraphInput } from "@thecavillgroup/canva-textmetrics";
import { fmt } from "../css/mod.ts";
import { isVisualBox } from "../parse/mod.ts";
import { CAVILL, type Brand } from "../brand.ts";
import type { ApplyWarning, Node, PageDoc, Paragraph, StyleMap, TextNode } from "../types.ts";
import { ensureMeasureFont, type FontRegistry } from "./fonts.ts";

// Lays the markup out in a hidden DOM inside the app iframe and measures every element.
// All of this happens before openDesign, so the 1-minute session is only spent on edits.
// Text in fonts @thecavillgroup/canva-textmetrics knows isn't measured by the browser: it predicts Canva's own layout
// exactly, and the DOM only sees a stand-in box of that size.

export interface PlanItem {
    node : Node,
    /** relative to the page, or to the enclosing group's bounding box */
    left : number,
    top : number,
    width : number,
    height : number,
    rotation : number,
    opacity : number,
    children? : Array<PlanItem>
}

const SKIP = new Set(["transform", "opacity", "background-color", "background-image", "background-size", "background-position", "background-repeat", "object-fit"]);
const WEIGHT : Record<string, string> = { thin: "100", extralight: "200", light: "300", normal: "400", medium: "500", semibold: "600", bold: "700", ultrabold: "800", heavy: "900" };
const r2 = (n : number) => Number(fmt(n));

function css(el : HTMLElement, style : StyleMap) {
    for(const k in style) if(!SKIP.has(k)) el.style.setProperty(k, style[k]!);
}

export const rotationOf = (s : StyleMap) => Number(/rotate\((-?[\d.]+)deg\)/.exec(s.transform ?? "")?.[1] ?? 0);
export const opacityOf = (s : StyleMap) => s.opacity != null ? Number(s.opacity) : 1;

function paragraphEl(p : Paragraph, fonts : FontRegistry) : HTMLElement {
    const el = document.createElement("p");
    const f = p.format;
    el.style.cssText = `margin:0; padding:0; white-space:pre-wrap; overflow-wrap:break-word; font-family:"${fonts.measureFamily(f.fontFamily)}"; font-size:${f.fontSize}px; line-height:${f.lineHeight}; letter-spacing:${f.letterSpacing}em; text-align:${f.textAlign === "start" ? "left" : f.textAlign === "end" ? "right" : f.textAlign};`;
    if(f.listLevel > 0) el.style.paddingLeft = `${f.listLevel * 1.5}em`;
    if(p.runs.length === 0) el.textContent = "​";
    for(const r of p.runs) {
        const span = document.createElement("span");
        span.style.fontWeight = WEIGHT[r.format.fontWeight] ?? "400";
        span.style.fontStyle = r.format.fontStyle;
        span.textContent = r.text;
        el.appendChild(span);
    }
    return el;
}

/** Paragraphs as Canva will get them from apply.ts, if every font is one textmetrics knows (it takes fontRefs) */
export function predictable(n : TextNode, brand : Brand = CAVILL) : Array<ParagraphInput> | undefined {
    const out : Array<ParagraphInput> = [];
    for(const p of n.paragraphs) {
        const f = p.format;
        const font = brand.fonts[f.fontFamily]?.ref ?? (f.fontFamily.startsWith("ref:") ? f.fontFamily.slice(4) : f.fontFamily);
        if(!supportsFont(font)) return undefined;
        out.push({
            runs: p.runs.map(r => ({ text: r.text, weight: r.format.fontWeight })),
            style: { font, fontSize: f.fontSize, lineHeight: f.lineHeight, letterSpacing: f.letterSpacing, listLevel: f.listLevel }
        });
    }
    if(!out.length) return undefined;
    // regions() never sends an empty last paragraph, so Canva gives it the previous paragraph's style
    const last = out.at(-1)!;
    if(out.length > 1 && last.runs.every(r => !r.text)) last.style = out.at(-2)!.style;
    return out;
}

/** Stand-in with the text's min-content and max-content widths, so flex/grid size the box as they would the text */
function sizeProbe(min : number, max : number) : HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = "font-size:0; line-height:0;";
    const piece = Math.max(min, 1);
    for(let left = max; left > 0; left -= piece) {
        const s = document.createElement("span");
        s.style.cssText = `display:inline-block; height:0; width:${Math.min(piece, left)}px;`;
        el.appendChild(s);
        el.appendChild(document.createTextNode("​"));
    }
    return el;
}

function build(n : Node, fonts : FontRegistry, dom : Map<Node, HTMLElement>, predicted : Map<Node, Array<ParagraphInput>>) : HTMLElement {
    const el = document.createElement("div");
    el.style.boxSizing = "border-box";
    el.style.margin = "0";
    dom.set(n, el);

    if(n.kind === "shape" && (n.style.width == null) !== (n.style.height == null)) {
        el.style.aspectRatio = `${n.viewBox[2]} / ${n.viewBox[3]}`;
    }
    if(n.kind === "group" && !n.style.position) el.style.position = "relative";
    css(el, n.style);

    if(n.kind === "box" || n.kind === "group") for(const c of n.children) el.appendChild(build(c, fonts, dom, predicted));
    if(n.kind === "text") {
        const paras = predicted.get(n);
        if(paras) {
            const { min, max } = intrinsicWidths(paras);
            el.appendChild(sizeProbe(min, max));
        } else {
            for(const p of n.paragraphs) el.appendChild(paragraphEl(p, fonts));
        }
    }
    return el;
}

/** Fonts whose metrics affect the result: browser-measured text that is laid out (not absolutely placed with a fixed width). */
function families(nodes : Array<Node>, predicted : Map<Node, unknown>, out = new Set<string>()) : Set<string> {
    for(const n of nodes) {
        const fixed = n.style.position === "absolute" && n.style.width != null && !n.style.width.endsWith("%");
        if(n.kind === "text" && !fixed && !predicted.has(n)) for(const p of n.paragraphs) out.add(p.format.fontFamily);
        if(n.kind === "box" || n.kind === "group") families(n.children, predicted, out);
    }
    return out;
}

function findPredictable(nodes : Array<Node>, brand : Brand, out = new Map<Node, Array<ParagraphInput>>()) {
    for(const n of nodes) {
        if(n.kind === "text") {
            const p = predictable(n, brand);
            if(p) out.set(n, p);
        }
        if(n.kind === "box" || n.kind === "group") findPredictable(n.children, brand, out);
    }
    return out;
}

/**
 * Lays the page out in a hidden DOM and returns every element's box (and warnings). Needs a browser
 * document; brand fonts the browser lacks are fetched from `brand.fontUrl` first.
 */
export async function layout(doc : PageDoc, fonts : FontRegistry) : Promise<{ items : Array<PlanItem>, warnings : Array<ApplyWarning> }> {
    const warnings : Array<ApplyWarning> = [];
    const brand = fonts.brand;
    const predicted = findPredictable(doc.children, brand);

    // Brand fonts are missing most weights and Canva doesn't fake them, so e.g. bold Questrial looks normal
    const invisible = new Set<string>();
    for(const [n, paras] of predicted) {
        (n as TextNode).paragraphs.forEach((para, i) => {
            const p = paras[i]!;
            for(const r of p.runs) {
                const name = para.format.fontFamily;
                const key = `${name}/${r.weight}`;
                if(!r.weight || !r.text.trim() || weightVisible(p.style.font, r.weight) || invisible.has(key)) continue;
                invisible.add(key);
                const has = Object.entries(brand.fonts).filter(([, f]) => f.weights?.includes(r.weight!)).map(([a]) => a);
                warnings.push({ code: "font_weight", path: n.path, dataId: n.id, message: `${name} has no ${r.weight} face, so Canva shows that text at its normal weight. For emphasis use colour or size${has.length ? `, or ${has.join(" / ")} (which has ${r.weight})` : ""}.` });
            }
        });
    }

    const fams = [...families(doc.children, predicted)];
    const results = await Promise.all(fams.map(f => ensureMeasureFont(fonts.measureFamily(f), brand.fontUrl)));
    fams.forEach((f, i) => {
        if(!results[i]) warnings.push({ code: "measure_font", message: `Layout for "${f}" was measured with a fallback font, so line breaks may differ slightly from Canva.` });
    });
    await document.fonts.ready;

    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed; left:-200000px; top:0; visibility:hidden; pointer-events:none;";
    const root = document.createElement("div");
    root.style.cssText = `position:relative; box-sizing:border-box; margin:0; width:${doc.width}px; height:${doc.height}px;`;
    css(root, doc.style);
    const dom = new Map<Node, HTMLElement>();
    for(const n of doc.children) root.appendChild(build(n, fonts, dom, predicted));
    host.appendChild(root);
    document.body.appendChild(host);

    try {
        // Pass 2: fix each predicted text box at the width layout gave it and the height Canva will give it
        const sizes = new Map<Node, { width : number, height : number }>();
        for(const [n, paras] of predicted) {
            const width = dom.get(n)!.getBoundingClientRect().width;
            sizes.set(n, { width, height: layoutParagraphs(paras, width).height });
        }
        for(const [n, s] of sizes) {
            const el = dom.get(n)!;
            el.replaceChildren();
            el.style.width = `${s.width}px`;
            el.style.height = `${s.height}px`;
        }

        const rect = (n : Node) => dom.get(n)!.getBoundingClientRect();

        // Browser layout snaps to 1/64px (373.2 lands at 373.1875, then rounds to 373.19). A px offset against the
        // origin itself is exact, so it's taken as written
        const pinned = (n : Node, from : HTMLElement, axis : "left" | "top", measured : number) => {
            const v = n.style[axis];
            if(n.style.position !== "absolute" || v == null || !(v === "0" || v.endsWith("px")) || dom.get(n)!.offsetParent !== from) return measured;
            if(Object.keys(n.style).some(k => k.startsWith("margin"))) return measured;
            return parseFloat(v);
        };

        const items = (nodes : Array<Node>, origin : { left : number, top : number }, from : HTMLElement) : Array<PlanItem> => {
            const out : Array<PlanItem> = [];
            for(const n of nodes) {
                // Layout-only boxes produce no element; their children are placed relative to the same origin
                if(n.kind === "box" && !isVisualBox(n)) {
                    out.push(...items(n.children, origin, from));
                    continue;
                }
                const r = rect(n);
                const item : PlanItem = {
                    node: n,
                    left: pinned(n, from, "left", r.left - origin.left),
                    top: pinned(n, from, "top", r.top - origin.top),
                    width: r.width,
                    height: r.height,
                    rotation: rotationOf(n.style),
                    opacity: opacityOf(n.style)
                };
                const size = sizes.get(n);
                if(size) {
                    // Exact; round the width up so rounding can't make Canva wrap a line that should fit
                    item.width = Math.ceil(size.width * 100) / 100;
                    item.height = size.height;
                } else if(n.kind === "text" && n.style.width == null) {
                    item.width += 1;
                }

                if(n.kind === "group") {
                    // Canva sizes a group to its children: re-base children on their bounding box
                    const kids = items(n.children, { left: r.left, top: r.top }, dom.get(n)!);
                    const minL = Math.min(...kids.map(k => k.left)), minT = Math.min(...kids.map(k => k.top));
                    item.left += minL;
                    item.top += minT;
                    item.width = Math.max(...kids.map(k => k.left + k.width)) - minL;
                    item.height = Math.max(...kids.map(k => k.top + k.height)) - minT;
                    for(const k of kids) {
                        k.left -= minL;
                        k.top -= minT;
                    }
                    item.children = kids;
                } else if(n.kind === "box") {
                    out.push(round(item));
                    out.push(...items(n.children, origin, from));
                    continue;
                }
                out.push(round(item));
            }
            return out;
        };

        const r = root.getBoundingClientRect();
        return { items: items(doc.children, { left: r.left, top: r.top }, root), warnings };
    } finally {
        host.remove();
    }
}

function round(i : PlanItem) : PlanItem {
    i.left = r2(i.left);
    i.top = r2(i.top);
    i.width = r2(i.width);
    i.height = r2(i.height);
    if(i.children) i.children = i.children.map(round);
    return i;
}
