import type { FontRef } from "@canva/asset";
import type { DesignEditing, InlineFormatting, RichtextFormatting, TextRegion } from "@canva/design";
import { fmt } from "../css/mod.ts";
import { DEFAULT_INLINE } from "../parse/mod.ts";
import type { Node, PageDoc, Paragraph, StyleMap } from "../types.ts";
import { walk } from "./ids.ts";

export type El = DesignEditing.AbsoluteElement | DesignEditing.GroupContentElement;
export type CanvaKind = "rect" | "shape" | "text" | "embed" | "group" | "unsupported";

export function radii(s : StyleMap) : Array<string> | undefined {
    const r = s["border-radius"];
    if(!r) return;
    const parts = r.split(" ");
    if(parts.every(p => parseFloat(p) === 0)) return;
    const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
    return [a, b!, c!, d!];
}

export function canvaKind(n : Node) : CanvaKind {
    if(n.kind === "box" || n.kind === "image") return radii(n.style) ? "shape" : "rect";
    if(n.kind === "shape") return "shape";
    return n.kind;
}

export function liveKind(el : El) : CanvaKind {
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

export const bgImage = (s : StyleMap) => /^url\("(.*)"\)$/.exec(s["background-image"] ?? "")?.[1];

export function border(s : StyleMap) : { weight : number, color : string } | undefined {
    const m = /^([\d.]+)px solid (#[0-9a-f]{6})$/.exec(s.border ?? "");
    return m ? { weight: Number(m[1]), color: m[2]! } : undefined;
}

export function inlineOf(f : Paragraph["runs"][number]["format"]) : InlineFormatting {
    const o : InlineFormatting = { color: f.color, fontWeight: f.fontWeight, fontStyle: f.fontStyle, decoration: f.decoration, strikethrough: f.strikethrough };
    if(f.link) o.link = f.link;
    return o;
}

export function paragraphOf(p : Paragraph, fontRefs : Map<string, FontRef>) : RichtextFormatting {
    const f = p.format;
    const o : RichtextFormatting = { fontRef: fontRefs.get(f.fontFamily), fontSize: f.fontSize, textAlign: f.textAlign, lineHeightEm: f.lineHeight, letterSpacingEm: f.letterSpacing, listLevel: f.listLevel };
    if(f.listLevel > 0) o.listMarker = f.listMarker;
    return o;
}

export function regions(paragraphs : Array<Paragraph>, fontRefs : Map<string, FontRef>) : Array<TextRegion> {
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
