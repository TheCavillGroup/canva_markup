import { fmt, serialiseStyle } from "./css/mod.ts";
import { DEFAULT_INLINE, paragraphDefaults } from "./parse/mod.ts";
import { CAVILL, type Brand } from "./brand.ts";
import type { InlineFormat, Node, PageDoc, Paragraph, Run, StyleMap } from "./types.ts";

// Canonical markup: fixed attribute and style order, explicit paragraph styles, 2-space indent.
// serialisePage(parsePage(x).doc) is a fixed point, which is what makes untouched elements
// byte-identical across get_page calls.

const INDENT = "  ";
const OL_MARKERS = new Set(["decimal", "lower-alpha", "lower-roman"]);

const escapeAttr = (s : string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (s : string) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(new RegExp("[\u0000-\u0008\u000a-\u001f\u2028\u2029]", "g"), c => `&#${c.charCodeAt(0)};`);

function attrs(list : Array<[string, string | number | boolean | undefined]>) : string {
    return list
        .filter(([, v]) => v != null && v !== false && v !== "")
        .map(([k, v]) => v === true ? ` ${k}="true"` : ` ${k}="${escapeAttr(String(v))}"`)
        .join("");
}

/** font-family value for a ParagraphFormat.fontFamily: aliases bare, everything else quoted */
export function fontFamilyCss(f : string, brand : Brand = CAVILL) : string {
    return Object.hasOwn(brand.fonts, f) ? f : `"${f}"`;
}

function decorationCss(f : InlineFormat) : string {
    const parts = [f.decoration === "underline" ? "underline" : "", f.strikethrough === "strikethrough" ? "line-through" : ""].filter(x => x);
    return parts.length ? parts.join(" ") : "none";
}

function inlineDiff(f : InlineFormat, base : InlineFormat) : StyleMap {
    const s : StyleMap = {};
    if(f.color !== base.color) s.color = f.color;
    if(f.fontWeight !== base.fontWeight) s["font-weight"] = f.fontWeight;
    if(f.fontStyle !== base.fontStyle) s["font-style"] = f.fontStyle;
    if(decorationCss(f) !== decorationCss(base)) s["text-decoration"] = decorationCss(f);
    return s;
}

/** Paragraph-level style plus the inline base it implies for its runs. */
function paragraphStyle(p : Paragraph, brand : Brand) : { style : StyleMap, base : InlineFormat } {
    const f = p.format;
    const DEFAULT_PARAGRAPH = paragraphDefaults(brand);
    const style : StyleMap = {};
    if(f.fontFamily !== DEFAULT_PARAGRAPH.fontFamily) style["font-family"] = fontFamilyCss(f.fontFamily, brand);
    if(f.fontSize !== DEFAULT_PARAGRAPH.fontSize) style["font-size"] = `${fmt(f.fontSize)}px`;
    if(f.textAlign !== DEFAULT_PARAGRAPH.textAlign) style["text-align"] = f.textAlign === "start" ? "left" : f.textAlign === "end" ? "right" : f.textAlign;
    if(f.lineHeight !== DEFAULT_PARAGRAPH.lineHeight) style["line-height"] = fmt(f.lineHeight, 4);
    if(f.letterSpacing !== DEFAULT_PARAGRAPH.letterSpacing) style["letter-spacing"] = `${fmt(f.letterSpacing, 4)}em`;

    // Inline formatting shared by every run moves up to the paragraph
    const base = { ...DEFAULT_INLINE };
    const runs = p.runs;
    if(runs.length) {
        const r0 = runs[0].format;
        if(runs.every(r => r.format.color === r0.color)) base.color = r0.color;
        if(runs.every(r => r.format.fontWeight === r0.fontWeight)) base.fontWeight = r0.fontWeight;
        if(runs.every(r => r.format.fontStyle === r0.fontStyle)) base.fontStyle = r0.fontStyle;
        if(runs.every(r => r.format.decoration === r0.decoration && r.format.strikethrough === r0.strikethrough)) {
            base.decoration = r0.decoration;
            base.strikethrough = r0.strikethrough;
        }
    }
    Object.assign(style, inlineDiff(base, DEFAULT_INLINE));
    return { style, base };
}

function renderRuns(runs : Array<Run>, base : InlineFormat) : string {
    return runs.map(r => {
        const diff = inlineDiff(r.format, base);
        const style = Object.keys(diff).length ? ` style="${escapeAttr(serialiseInline(diff))}"` : "";
        const text = escapeText(r.text);
        if(r.format.link) return `<a href="${escapeAttr(r.format.link)}"${style}>${text}</a>`;
        return style ? `<span${style}>${text}</span>` : text;
    }).join("");
}

const INLINE_ORDER = ["font-family", "font-size", "font-weight", "font-style", "color", "text-align", "line-height", "letter-spacing", "text-decoration", "list-style-type"];
function serialiseInline(s : StyleMap) : string {
    return INLINE_ORDER.filter(k => s[k] != null).map(k => `${k}:${s[k]}`).join("; ");
}

function renderParagraph(tag : "p" | "li", p : Paragraph, brand : Brand, close = true) : string {
    const { style, base } = paragraphStyle(p, brand);
    const st = Object.keys(style).length ? ` style="${escapeAttr(serialiseInline(style))}"` : "";
    return `<${tag}${st}>${renderRuns(p.runs, base)}${close ? `</${tag}>` : ""}`;
}

function renderList(items : Array<Paragraph>, level : number, indent : string, out : Array<string>, brand : Brand) {
    let i = 0;
    while(i < items.length) {
        const marker = items[i].format.listLevel === level ? items[i].format.listMarker : "disc";
        const tag = OL_MARKERS.has(marker) ? "ol" : "ul";
        const def = tag === "ol" ? "decimal" : "disc";
        out.push(`${indent}<${tag}${marker === def ? "" : ` style="list-style-type:${marker}"`}>`);

        // One list = consecutive items at this level with the same marker (plus their deeper children)
        while(i < items.length) {
            const it = items[i];
            if(it.format.listLevel === level && it.format.listMarker !== marker) break;

            let j = i + (it.format.listLevel === level ? 1 : 0);
            while(j < items.length && items[j].format.listLevel > level) j++;
            const children = items.slice(it.format.listLevel === level ? i + 1 : i, j);

            const head = it.format.listLevel === level ? renderParagraph("li", it, brand, false) : "<li>";
            if(children.length) {
                out.push(`${indent}${INDENT}${head}`);
                renderList(children, level + 1, indent + INDENT + INDENT, out, brand);
                out.push(`${indent}${INDENT}</li>`);
            } else {
                out.push(`${indent}${INDENT}${head}</li>`);
            }
            i = j;
            if(it.format.listLevel !== level) break;
        }
        out.push(`${indent}</${tag}>`);
    }
}

function renderParagraphs(paras : Array<Paragraph>, indent : string, out : Array<string>, brand : Brand) {
    let i = 0;
    while(i < paras.length) {
        if(paras[i].format.listLevel === 0) {
            out.push(indent + renderParagraph("p", paras[i], brand));
            i++;
            continue;
        }
        let j = i;
        while(j < paras.length && paras[j].format.listLevel > 0) j++;
        renderList(paras.slice(i, j), 1, indent, out, brand);
        i = j;
    }
}

function styleAttr(style : StyleMap) : string | undefined {
    const s = serialiseStyle(style);
    return s || undefined;
}

function renderNode(n : Node, indent : string, out : Array<string>, brand : Brand) {
    if(n.kind === "box" || n.kind === "group") {
        const tag = n.kind === "box" ? "div" : "group";
        const open = `${indent}<${tag}${attrs([["data-id", n.id], ["style", styleAttr(n.style)], ["data-locked", n.locked]])}>`;
        if(n.children.length === 0) {
            out.push(`${open}</${tag}>`);
            return;
        }
        out.push(open);
        for(const c of n.children) renderNode(c, indent + INDENT, out, brand);
        out.push(`${indent}</${tag}>`);
        return;
    }

    if(n.kind === "text") {
        out.push(`${indent}<text${attrs([["data-id", n.id], ["style", styleAttr(n.style)], ["data-locked", n.locked], ["data-measured-height", n.measuredHeight != null ? fmt(n.measuredHeight) : undefined]])}>`);
        renderParagraphs(n.paragraphs, indent + INDENT, out, brand);
        out.push(`${indent}</text>`);
        return;
    }

    if(n.kind === "image") {
        out.push(`${indent}<img${attrs([["data-id", n.id], ["src", n.src], ["alt", n.alt], ["style", styleAttr(n.style)], ["data-locked", n.locked]])} />`);
        return;
    }

    if(n.kind === "shape") {
        out.push(`${indent}<svg${attrs([["data-id", n.id], ["viewBox", n.viewBox.map(x => fmt(x, 3)).join(" ")], ["style", styleAttr(n.style)], ["data-locked", n.locked]])}>`);
        for(const p of n.paths) {
            out.push(`${indent}${INDENT}<path${attrs([["d", p.d], ["fill", p.fill ?? "none"], ["fill-image", p.fillImage], ["stroke", p.stroke], ["stroke-width", p.stroke != null ? fmt(p.strokeWidth ?? 1) : undefined]])} />`);
        }
        out.push(`${indent}</svg>`);
        return;
    }

    if(n.kind === "embed") {
        out.push(`${indent}<canva-embed${attrs([["data-id", n.id], ["src", n.src], ["style", styleAttr(n.style)], ["data-locked", n.locked]])} />`);
        return;
    }

    out.push(`${indent}<canva-unsupported${attrs([["data-id", n.id], ["data-kind", n.detail], ["style", styleAttr(n.style)], ["data-locked", n.locked]])} />`);
}

/** Canonical markup for a page. parsePage(serialisePage(doc)) gives back the same doc. */
export function serialisePage(doc : PageDoc, brand : Brand = CAVILL) : string {
    const out : Array<string> = [];
    out.push(`<page${attrs([["width", doc.width], ["height", doc.height], ["data-page-id", doc.pageId], ["data-revision", doc.revision], ["data-locked", doc.locked], ["style", styleAttr(doc.style)]])}>`);
    for(const n of doc.children) renderNode(n, INDENT, out, brand);
    out.push("</page>");
    return out.join("\n");
}

/** Canonical markup of a single node, for equality checks (e.g. placeholders against base). */
export function serialiseNode(n : Node, brand : Brand = CAVILL) : string {
    const out : Array<string> = [];
    renderNode(n, "", out, brand);
    return out.join("\n");
}
