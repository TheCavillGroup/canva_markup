import { decodeEntities, parseHtml, type RawElement, type RawNode } from "./html.ts";
import { BACKGROUND_PROPS, BORDER_PROPS, checkSrc, CONTAINER_PROPS, fmt, INLINE_PROPS, isProblem, ITEM_PROPS, KNOWN_PROPS, mergeBorder, normColor, normalise, parseStyle, PLACED_PROPS, REJECTED_PROPS, TEXT_PROPS, type Problem } from "./css.ts";
import { byteLength, MAX_FILL_COLORS, MAX_PATH_BYTES, MAX_PATHS, toAbsoluteCubic, tokenisePath, usesQuadratic } from "./path.ts";
import type { BoxNode, EmbedNode, FontWeight, GroupNode, ImageNode, InlineFormat, Issue, IssueCode, ListMarker, Node, PageDoc, Paragraph, ParagraphFormat, ParseResult, PlaceholderNode, Run, ShapeNode, ShapePath, StyleMap, TextAlign, TextNode } from "./types.ts";

export const MAX_ERRORS = 50;
/** Smallest page width/height, px */
export const PAGE_MIN = 40;
/** Largest page width/height, px */
export const PAGE_MAX = 8000;
/** Largest page area, px² */
export const PAGE_MAX_AREA = 25_000_000;

/** Paragraph format a <p> gets when the markup doesn't set it */
export const DEFAULT_PARAGRAPH : ParagraphFormat = {
    fontFamily: "brand-body",
    fontSize: 16,
    textAlign: "start",
    lineHeight: 1.4,
    letterSpacing: 0,
    listLevel: 0,
    listMarker: "none"
};

/** Inline format a run gets when the markup doesn't set it */
export const DEFAULT_INLINE : InlineFormat = {
    color: "#000000",
    fontWeight: "normal",
    fontStyle: "normal",
    decoration: "none",
    strikethrough: "none",
    link: ""
};

const HEADING_SIZES : Record<string, number> = { h1: 64, h2: 48, h3: 36, h4: 28, h5: 22, h6: 18 };

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"]);
const INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "s", "del", "a"]);

const UNSUPPORTED_TAGS : Record<string, string> = {
    table: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    thead: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    tbody: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    tr: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    td: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    th: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    br: "Line breaks aren't supported inside text. Start a new <p> instead.",
    hr: "Use <div style=\"height:1px; background-color:#…\"></div> for a rule line.",
    video: "Video isn't supported.",
    audio: "Audio isn't supported.",
    iframe: "Embedding pages isn't supported.",
    canvas: "Canvas isn't supported.",
    picture: "Use <img>.",
    source: "Use <img src>.",
    object: "Not supported.",
    script: "Scripts aren't allowed.",
    style: "Stylesheets aren't allowed. Use inline style attributes.",
    link: "External stylesheets aren't allowed. Use inline style attributes.",
    meta: "Not allowed.",
    html: "Start the markup directly with <page>.",
    head: "Start the markup directly with <page>.",
    body: "Start the markup directly with <page>.",
    form: "Forms aren't supported.",
    input: "Inputs aren't supported.",
    button: "Buttons aren't supported. Draw a <div> with a <p> inside.",
    select: "Not supported.",
    textarea: "Not supported.",
    label: "Use <p>.",
    section: "Use <div>.",
    article: "Use <div>.",
    header: "Use <div>.",
    footer: "Use <div>.",
    nav: "Use <div>.",
    main: "Use <div>.",
    aside: "Use <div>.",
    figure: "Use <div>.",
    figcaption: "Use <p>.",
    blockquote: "Use <p>.",
    pre: "Use <p>.",
    code: "Use <span>.",
    sub: "Not supported.",
    sup: "Not supported.",
    mark: "Use <span style=\"color:…\">.",
    small: "Use <span> with a separate <p> font-size.",
    strike: "Use <s>.",
    font: "Use <span style>."
};

const KNOWN_TAGS = new Set(["page", "div", "group", "text", "img", "svg", "path", "li", "canva-embed", "canva-unsupported", ...BLOCK_TAGS, ...INLINE_TAGS]);

const GLOBAL_ATTRS = ["data-id", "style", "data-locked"];
const TAG_ATTRS : Record<string, Array<string>> = {
    page: ["width", "height", "data-page-id", "data-revision", "data-locked", "style"],
    div: GLOBAL_ATTRS,
    group: GLOBAL_ATTRS,
    text: [...GLOBAL_ATTRS, "data-measured-height"],
    img: [...GLOBAL_ATTRS, "src", "alt"],
    svg: [...GLOBAL_ATTRS, "viewbox"],
    path: ["d", "fill", "fill-image", "stroke", "stroke-width"],
    li: ["style"],
    a: ["href", "style"],
    "canva-embed": [...GLOBAL_ATTRS, "src"],
    "canva-unsupported": [...GLOBAL_ATTRS, "data-kind"]
};
for(const t of BLOCK_TAGS) TAG_ATTRS[t] = [...GLOBAL_ATTRS, "data-measured-height"];
for(const t of INLINE_TAGS) TAG_ATTRS[t] ??= ["style"];

const union = (...sets : Array<Set<string>>) => new Set(sets.flatMap(s => [...s]));
const PAGE_STYLE = union(CONTAINER_PROPS, BACKGROUND_PROPS, TEXT_PROPS);
const BOX_STYLE = union(ITEM_PROPS, CONTAINER_PROPS, BACKGROUND_PROPS, BORDER_PROPS, TEXT_PROPS);
const GROUP_STYLE = union(ITEM_PROPS, CONTAINER_PROPS, TEXT_PROPS);
const TEXT_BOX_STYLE = union(ITEM_PROPS, TEXT_PROPS);
const IMG_STYLE = union(ITEM_PROPS, BORDER_PROPS, new Set(["object-fit"]));

type RawRun = { raw : string, format : InlineFormat };

interface Ctx {
    path : string,
    text : StyleMap,
    inGroup : boolean
}

/**
 * Parses and validates a page. `doc` is only set when there are no errors; warnings can come either way.
 *
 * @example
 * ```ts
 * const { doc, issues } = parsePage(`<page width="800" height="600"><p>Hello</p></page>`);
 * ```
 */
export function parsePage(src : string) : ParseResult {
    const issues : Array<Issue> = [];
    let errors = 0;
    const ids = new Set<string>();

    const add = (code : IssueCode, path : string, message : string, extra : Partial<Issue> = {}) => {
        const severity = extra.severity ?? "error";
        if(severity === "error") {
            errors++;
            if(errors === MAX_ERRORS + 1) {
                issues.push({ severity: "error", code: "too_many_issues", path, message: `Stopped after ${MAX_ERRORS} errors.`, fix: "Fix these and validate again." });
            }
            if(errors > MAX_ERRORS) return;
        }
        issues.push({ severity, code, path, message, ...extra });
    };

    const problem = (p : Problem, path : string, extra : Partial<Issue> = {}) =>
        add(p.range ? "out_of_range" : "invalid_value", path, p.problem, { fix: p.fix, ...extra });

    // --- shared helpers ---

    const childPaths = (parent : string, children : Array<RawNode>) => {
        const counts : Record<string, number> = {};
        return children.map(c => {
            if(c.type !== "element") return parent;
            const n = counts[c.tag] ?? 0;
            counts[c.tag] = n + 1;
            return `${parent} > ${c.tag}[${n}]`;
        });
    };

    const checkAttrs = (el : RawElement, path : string) => {
        const allowed = TAG_ATTRS[el.tag] ?? [];
        for(const name in el.attrs) {
            if(allowed.includes(name)) continue;
            const dataId = el.attrs["data-id"];
            if(name === "class" || name === "id") add("unsupported_attribute", path, `${name} isn't used.`, { dataId, fix: name === "id" ? "Use data-id only for ids returned by get_page." : "Put styles inline in style=\"…\"." });
            else if(name.startsWith("on")) add("unsupported_attribute", path, `Event handlers (${name}) aren't allowed.`, { dataId, fix: `Remove ${name}.` });
            else if(el.tag === "svg" && (name === "width" || name === "height")) add("unsupported_attribute", path, `<svg ${name}> isn't used.`, { dataId, fix: `Size the shape with style="${name}:…px".` });
            else add("unknown_attribute", path, `Attribute ${name} isn't allowed on <${el.tag}>.`, { dataId, fix: `Allowed: ${allowed.join(", ") || "none"}.` });
        }
    };

    const readId = (el : RawElement, path : string) : string | undefined => {
        const id = el.attrs["data-id"];
        if(id == null) return;
        if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)) {
            add("invalid_id", path, `data-id "${id}" isn't valid.`, { dataId: id, fix: "Only use data-id values returned by get_page; omit data-id on new elements." });
            return;
        }
        if(ids.has(id)) {
            add("duplicate_id", path, `data-id "${id}" is used more than once.`, { dataId: id, fix: "Each data-id may appear once. Remove the duplicate's data-id to create a new element." });
            return;
        }
        ids.add(id);
        return id;
    };

    const readLocked = (el : RawElement, path : string) : boolean | undefined => {
        const v = el.attrs["data-locked"];
        if(v == null) return;
        if(v !== "true") add("invalid_value", path, `data-locked="${v}" isn't valid.`, { dataId: el.attrs["data-id"], fix: "Leave data-locked exactly as get_page returned it." });
        return true;
    };

    /** Splits a style attribute into element style and text (inheritable) props. */
    const readStyle = (el : RawElement, path : string, allowed : Set<string>) : { style : StyleMap, text : StyleMap } => {
        const style : StyleMap = {}, text : StyleMap = {};
        const dataId = el.attrs["data-id"];
        const src = el.attrs.style;
        if(src == null) return { style, text };

        const parsed = parseStyle(src);
        if(parsed.error) add("invalid_value", path, parsed.error, { dataId, property: "style" });

        for(const { prop, value } of parsed.decls) {
            const rejected = REJECTED_PROPS[prop];
            if(rejected) {
                add("unsupported_css", path, rejected.problem, { dataId, property: prop, fix: rejected.fix });
                continue;
            }
            if(!KNOWN_PROPS.has(prop)) {
                add("unknown_css", path, `CSS property ${prop} isn't supported.`, { dataId, property: prop, fix: "Remove it. See the markup spec for the allowed properties." });
                continue;
            }
            if(!allowed.has(prop) || (prop === "list-style-type" && !["ul", "ol", "li"].includes(el.tag))) {
                add("unsupported_css", path, `${prop} isn't allowed on <${el.tag}>.`, { dataId, property: prop, fix: allowedHint(el.tag, prop) });
                continue;
            }
            if(el.tag === "text" && prop === "height" || (BLOCK_TAGS.has(el.tag) && prop === "height")) {
                add("unsupported_css", path, "Text boxes can't have a height: Canva sizes text to its content.", { dataId, property: prop, fix: "Remove height. Set width, then font-size/line-height to control the size." });
                continue;
            }
            const v = normalise(prop, value);
            if(isProblem(v)) {
                problem(v, path, { dataId, property: prop });
                continue;
            }
            if(TEXT_PROPS.has(prop)) text[prop] = v;
            else style[prop] = v;
        }

        const b = mergeBorder(style);
        if(b) problem(b, path, { dataId, property: "border" });
        return { style, text };
    };

    const textOutside = (n : RawNode, path : string, where : string) => {
        if(n.type === "text" && n.raw.trim() !== "") {
            add("invalid_nesting", path, `Text "${n.raw.trim().slice(0, 30)}" can't sit directly inside <${where}>.`, { fix: "Wrap text in <p> (or <h1>–<h6>)." });
        }
    };

    // --- text ---

    const resolveParagraph = (ctx : StyleMap, path : string, dataId? : string) : ParagraphFormat => {
        const fontSize = ctx["font-size"] ? parseFloat(ctx["font-size"]) : DEFAULT_PARAGRAPH.fontSize;
        const em = (v : string | undefined, def : number, prop : string, min : number, max : number) => {
            if(v == null) return def;
            const n = parseFloat(v);
            const r = v.endsWith("px") ? n / fontSize : n;
            if(r < min || r > max) {
                add("out_of_range", path, `${prop} ${v} is ${fmt(r, 3)}em, outside ${min}–${max}em.`, { dataId, property: prop });
            }
            return Number(r.toFixed(4));
        };
        return {
            fontFamily: ctx["font-family"]?.replace(/^"|"$/g, "") ?? DEFAULT_PARAGRAPH.fontFamily,
            fontSize,
            textAlign: (ctx["text-align"] ?? DEFAULT_PARAGRAPH.textAlign) as TextAlign,
            lineHeight: em(ctx["line-height"], DEFAULT_PARAGRAPH.lineHeight, "line-height", 0.5, 2.5),
            letterSpacing: em(ctx["letter-spacing"], DEFAULT_PARAGRAPH.letterSpacing, "letter-spacing", -0.2, 0.8),
            listLevel: 0,
            listMarker: "none"
        };
    };

    const applyInline = (f : InlineFormat, s : StyleMap) : InlineFormat => {
        const out = { ...f };
        if(s.color) out.color = s.color;
        if(s["font-weight"]) out.fontWeight = s["font-weight"] as FontWeight;
        if(s["font-style"]) out.fontStyle = s["font-style"] as "normal" | "italic";
        if(s["text-decoration"]) {
            const d = s["text-decoration"];
            out.decoration = d.includes("underline") ? "underline" : "none";
            out.strikethrough = d.includes("line-through") ? "strikethrough" : "none";
        }
        return out;
    };

    const walkInline = (nodes : Array<RawNode>, f : InlineFormat, path : string, out : Array<RawRun>, inLink : boolean) => {
        const paths = childPaths(path, nodes);
        nodes.forEach((n, i) => {
            if(n.type === "text") {
                out.push({ raw: n.raw, format: f });
                return;
            }
            const p = paths[i];
            if(!INLINE_TAGS.has(n.tag)) {
                badTag(n, p, `<${n.tag}> can't be used inside a paragraph.`, BLOCK_TAGS.has(n.tag) || n.tag === "li" ? "Close the paragraph first; blocks don't nest." : "Only <span>, <b>, <i>, <u>, <s>, <a> are allowed in text.");
                return;
            }
            checkAttrs(n, p);
            const { text } = readStyle(n, p, INLINE_PROPS);
            let g = applyInline(f, text);
            if(n.tag === "b" || n.tag === "strong") g = { ...g, fontWeight: text["font-weight"] as FontWeight ?? "bold" };
            if(n.tag === "i" || n.tag === "em") g = { ...g, fontStyle: "italic" };
            if(n.tag === "u") g = { ...g, decoration: "underline" };
            if(n.tag === "s" || n.tag === "del") g = { ...g, strikethrough: "strikethrough" };
            if(n.tag === "a") {
                if(inLink) add("invalid_nesting", p, "Links can't be nested.", { fix: "Remove the inner <a>." });
                const href = n.attrs.href;
                if(!href) add("missing_attribute", p, "<a> needs href.", { fix: "Add href=\"https://…\"." });
                else if(!/^(https?:\/\/\S+|mailto:\S+@\S+|tel:[+\d\s()-]+)$/i.test(href)) add("invalid_value", p, `href "${href}" isn't supported.`, { property: "href", fix: "Use https://, mailto: or tel: links." });
                g = { ...g, link: href ?? "" };
            }
            walkInline(n.children, g, p, out, inLink || n.tag === "a");
        });
    };

    const finishRuns = (raw : Array<RawRun>) : Array<Run> => {
        // Whitespace containing a newline collapses to one space (HTML-like); same-line spaces are kept
        const parts = raw.map(r => ({ text: r.raw.replace(/[ \t]*[\r\n]+[ \t\r\n]*/g, "\u0000"), format: r.format }));
        let last : "start" | "soft" | "space" | "other" = "start";
        const out = parts.map(r => {
            let s = "";
            for(const ch of r.text) {
                if(ch === "\u0000") {
                    if(last === "start" || last === "soft" || last === "space") continue;
                    s += "\u0000";
                    last = "soft";
                } else if(ch === " " && last === "soft") {
                    continue;
                } else {
                    s += ch;
                    last = ch === " " ? "space" : "other";
                }
            }
            return { text: s, format: r.format };
        });

        // Drop a trailing collapsed space
        for(let i = out.length - 1; i >= 0; i--) {
            if(out[i].text === "") continue;
            if(out[i].text.endsWith("\u0000")) out[i].text = out[i].text.slice(0, -1);
            break;
        }

        const runs : Array<Run> = [];
        for(const r of out) {
            const text = decodeEntities(r.text.replace(/\u0000/g, " "));
            if(text === "") continue;
            const prev = runs[runs.length - 1];
            if(prev && sameInline(prev.format, r.format)) prev.text += text;
            else runs.push({ text, format: r.format });
        }
        return runs;
    };

    const readParagraph = (el : RawElement, ctx : StyleMap, path : string, standalone : boolean) : { para : Paragraph, item : StyleMap } => {
        const { style, text } = readStyle(el, path, standalone ? TEXT_BOX_STYLE : TEXT_PROPS);
        const heading = HEADING_SIZES[el.tag];
        const merged = { ...ctx, ...(heading ? { "font-family": "brand-headline", "font-size": `${heading}px` } : {}), ...text };
        const format = resolveParagraph(merged, path, el.attrs["data-id"]);
        const raw : Array<RawRun> = [];
        walkInline(el.children, applyInline(DEFAULT_INLINE, merged), path, raw, false);
        return { para: { format, runs: finishRuns(raw) }, item: style };
    };

    const readList = (el : RawElement, ctx : StyleMap, path : string, level : number, out : Array<Paragraph>, standalone : boolean) : StyleMap => {
        const { style, text } = readStyle(el, path, standalone && level === 1 ? TEXT_BOX_STYLE : TEXT_PROPS);
        const { "list-style-type": ownMarker, ...inherit } = text;
        const listCtx = { ...ctx, ...inherit };
        const marker = (ownMarker ?? (el.tag === "ol" ? "decimal" : "disc")) as ListMarker;
        const paths = childPaths(path, el.children);

        el.children.forEach((li, i) => {
            const p = paths[i];
            if(li.type === "text") return textOutside(li, p, el.tag);
            if(li.tag !== "li") return badTag(li, p, `<${li.tag}> can't be a direct child of <${el.tag}>.`, "Lists contain only <li>.");
            checkAttrs(li, p);
            const { text: liText } = readStyle(li, p, TEXT_PROPS);
            const { "list-style-type": liMarker, ...liInherit } = liText;
            const liCtx = { ...listCtx, ...liInherit };

            const inline : Array<RawNode> = [];
            const nested : Array<[RawElement, string]> = [];
            const liPaths = childPaths(p, li.children);
            li.children.forEach((c, k) => {
                if(c.type === "element" && (c.tag === "ul" || c.tag === "ol")) nested.push([c, liPaths[k]]);
                else if(nested.length) {
                    if(c.type === "element" || c.raw.trim() !== "") add("invalid_nesting", liPaths[k], "Text after a nested list in the same <li>.", { fix: "Move it into its own <li>." });
                } else inline.push(c);
            });

            // An <li> holding only a nested list adds no paragraph of its own (used for level jumps)
            const bare = nested.length > 0 && inline.every(x => x.type === "text" && x.raw.trim() === "");
            if(!bare) {
                const format = { ...resolveParagraph(liCtx, p), listLevel: level, listMarker: (liMarker ?? marker) as ListMarker };
                const raw : Array<RawRun> = [];
                walkInline(inline, applyInline(DEFAULT_INLINE, liCtx), p, raw, false);
                out.push({ format, runs: finishRuns(raw) });
            }

            for(const [n, np] of nested) {
                checkAttrs(n, np);
                readList(n, liCtx, np, level + 1, out, false);
            }
        });
        return style;
    };

    const readBlocks = (el : RawElement, ctx : StyleMap, path : string) : Array<Paragraph> => {
        const paras : Array<Paragraph> = [];
        const paths = childPaths(path, el.children);
        el.children.forEach((c, i) => {
            const p = paths[i];
            if(c.type === "text") return textOutside(c, p, el.tag);
            if(!BLOCK_TAGS.has(c.tag)) {
                return badTag(c, p, `<${c.tag}> can't be inside <text>.`, INLINE_TAGS.has(c.tag) ? "Wrap inline text in <p>." : "<text> contains only <p>, <h1>–<h6>, <ul>, <ol>.");
            }
            checkAttrs(c, p);
            if(c.attrs["data-id"]) add("invalid_id", p, "Paragraphs inside <text> don't take data-id.", { dataId: c.attrs["data-id"], fix: "Put data-id on the <text> element." });
            if(c.tag === "ul" || c.tag === "ol") readList(c, ctx, p, 1, paras, false);
            else paras.push(readParagraph(c, ctx, p, false).para);
        });
        return paras;
    };

    // --- elements ---

    const badTag = (el : RawElement, path : string, message : string, fix? : string) => {
        if(UNSUPPORTED_TAGS[el.tag]) add("unsupported_tag", path, `<${el.tag}> isn't supported.`, { dataId: el.attrs["data-id"], fix: UNSUPPORTED_TAGS[el.tag] });
        else if(!KNOWN_TAGS.has(el.tag)) add("unknown_tag", path, `<${el.tag}> isn't part of the markup subset.`, { dataId: el.attrs["data-id"], fix: "See the markup spec for allowed tags." });
        else add("invalid_nesting", path, message, { dataId: el.attrs["data-id"], fix });
    };

    const readChildren = (el : RawElement, ctx : Ctx) : Array<Node> => {
        const out : Array<Node> = [];
        const paths = childPaths(ctx.path, el.children);
        el.children.forEach((c, i) => {
            if(c.type === "text") return textOutside(c, paths[i], el.tag);
            const n = readNode(c, { ...ctx, path: paths[i] });
            if(n) out.push(n);
        });
        return out;
    };

    const readNode = (el : RawElement, ctx : Ctx) : Node | undefined => {
        const path = ctx.path;
        if(UNSUPPORTED_TAGS[el.tag] || !KNOWN_TAGS.has(el.tag)) {
            badTag(el, path, "");
            return;
        }
        checkAttrs(el, path);

        if(el.tag === "div") {
            const { style, text } = readStyle(el, path, BOX_STYLE);
            const id = readId(el, path);
            const node : BoxNode = { kind: "box", path, style, children: readChildren(el, { ...ctx, text: { ...ctx.text, ...text } }) };
            if(id) node.id = id;
            if(readLocked(el, path)) node.locked = true;
            if(id && !isVisualBox(node)) {
                add("invalid_id", path, `<div data-id="${id}"> has no background or border, so it isn't a Canva element.`, { dataId: id, fix: "Keep a background-color/background-image/border, or delete the element by removing it from the markup." });
            }
            return node;
        }

        if(el.tag === "group") {
            if(ctx.inGroup) {
                add("invalid_nesting", path, "Groups can't contain groups.", { dataId: el.attrs["data-id"], fix: "Flatten the inner <group> into the outer one." });
            }
            const { style, text } = readStyle(el, path, GROUP_STYLE);
            const id = readId(el, path);
            const node : GroupNode = { kind: "group", path, style, children: readChildren(el, { ...ctx, text: { ...ctx.text, ...text }, inGroup: true }) };
            if(id) node.id = id;
            if(readLocked(el, path)) node.locked = true;
            if(countElements(node.children) < 2) add("invalid_nesting", path, "A group needs at least 2 elements.", { dataId: id, fix: "Add elements, or remove the <group> wrapper." });
            return node;
        }

        if(el.tag === "text") {
            const { style, text } = readStyle(el, path, TEXT_BOX_STYLE);
            const id = readId(el, path);
            const node : TextNode = { kind: "text", path, style, paragraphs: readBlocks(el, { ...ctx.text, ...text }, path) };
            if(id) node.id = id;
            if(readLocked(el, path)) node.locked = true;
            const mh = el.attrs["data-measured-height"];
            if(mh != null && Number.isFinite(Number(mh))) node.measuredHeight = Number(mh);
            if(node.paragraphs.length === 0) add("invalid_nesting", path, "<text> is empty.", { dataId: id, fix: "Add a <p>, or remove the element." });
            return node;
        }

        if(BLOCK_TAGS.has(el.tag)) {
            const id = readId(el, path);
            let style : StyleMap;
            let paragraphs : Array<Paragraph> = [];
            if(el.tag === "ul" || el.tag === "ol") {
                style = readList(el, ctx.text, path, 1, paragraphs, true);
            } else {
                const r = readParagraph(el, ctx.text, path, true);
                style = r.item;
                paragraphs = [r.para];
            }
            const node : TextNode = { kind: "text", path, style, paragraphs };
            if(id) node.id = id;
            if(readLocked(el, path)) node.locked = true;
            const mh = el.attrs["data-measured-height"];
            if(mh != null && Number.isFinite(Number(mh))) node.measuredHeight = Number(mh);
            return node;
        }

        if(el.tag === "img") {
            const { style } = readStyle(el, path, IMG_STYLE);
            const id = readId(el, path);
            const src = el.attrs.src;
            if(!src) add("missing_attribute", path, "<img> needs src.", { dataId: id, fix: "Use src=\"https://…\", src=\"brand:<key>\" or the canva: src from get_page." });
            else {
                const bad = checkSrc(src);
                if(bad) problem(bad, path, { dataId: id, property: "src" });
            }
            const sized = ["width", "height", "aspect-ratio"].filter(k => style[k] != null && style[k] !== "auto").length;
            if(sized < 2) add("missing_attribute", path, "<img> needs a definite size.", { dataId: id, property: "width", fix: "Give width and height, or one of them plus aspect-ratio." });
            const node : ImageNode = { kind: "image", path, style, src: src ?? "" };
            if(id) node.id = id;
            if(el.attrs.alt != null) node.alt = el.attrs.alt;
            if(readLocked(el, path)) node.locked = true;
            if(el.children.length) add("invalid_nesting", path, "<img> can't have children.");
            return node;
        }

        if(el.tag === "svg") return readSvg(el, ctx);

        if(el.tag === "canva-embed" || el.tag === "canva-unsupported") {
            const { style } = readStyle(el, path, PLACED_PROPS);
            const id = readId(el, path);
            const what = el.tag === "canva-embed" ? "Embeds" : "Unsupported elements";
            if(!el.attrs["data-id"]) {
                add("missing_attribute", path, `${what} can't be created, only kept from get_page.`, { fix: `Remove this <${el.tag}>, or restore the data-id from get_page.` });
            }
            if(el.tag === "canva-embed") {
                const src = el.attrs.src ?? "";
                if(!/^https:\/\/\S+$/.test(src)) add("invalid_value", path, "Embed src must be the https URL from get_page.", { dataId: id, property: "src" });
                const node : EmbedNode = { kind: "embed", path, style, src };
                if(id) node.id = id;
                if(readLocked(el, path)) node.locked = true;
                return node;
            }
            const node : PlaceholderNode = { kind: "unsupported", path, style };
            if(id) node.id = id;
            if(el.attrs["data-kind"]) node.detail = el.attrs["data-kind"];
            if(readLocked(el, path)) node.locked = true;
            return node;
        }

        add("invalid_nesting", path, el.tag === "li" ? "<li> must be inside <ul> or <ol>." : el.tag === "path" ? "<path> must be inside <svg>." : INLINE_TAGS.has(el.tag) ? `<${el.tag}> must be inside a paragraph.` : el.tag === "page" ? "<page> must be the root." : `<${el.tag}> isn't allowed here.`, {
            dataId: el.attrs["data-id"],
            fix: INLINE_TAGS.has(el.tag) ? "Wrap it in <p>." : undefined
        });
        return undefined;
    };

    const readSvg = (el : RawElement, ctx : Ctx) : ShapeNode | undefined => {
        const path = ctx.path;
        const { style } = readStyle(el, path, ITEM_PROPS);
        const id = readId(el, path);

        const vb = (el.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
        let viewBox : [number, number, number, number] = [0, 0, 0, 0];
        if(vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
            add("missing_attribute", path, "<svg> needs viewBox=\"minX minY width height\" with positive size.", { dataId: id, property: "viewBox" });
        } else {
            viewBox = vb as [number, number, number, number];
        }
        if(style.width == null && style.height == null) add("missing_attribute", path, "<svg> needs a width or height.", { dataId: id, fix: "Add style=\"width:…px\" (height follows the viewBox ratio)." });

        const paths : Array<ShapePath> = [];
        const cps = childPaths(path, el.children);
        el.children.forEach((c, i) => {
            const p = cps[i];
            if(c.type === "text") return textOutside(c, p, "svg");
            if(c.tag !== "path") return badTag(c, p, `<${c.tag}> isn't allowed inside <svg>.`, "Only <path d fill stroke stroke-width fill-image> is supported. Convert other shapes to paths.");
            checkAttrs(c, p);
            const d = (c.attrs.d ?? "").trim();
            const segs = tokenisePath(d);
            if(typeof segs === "string") {
                add("invalid_value", p, `Invalid path d: ${segs}`, { dataId: id, property: "d" });
                return;
            }
            const sp : ShapePath = { d };
            if(usesQuadratic(segs)) {
                sp.d = toAbsoluteCubic(segs);
                add("converted_path", p, "Quadratic curves (Q/T) were converted to cubic (C). The shape is identical.", { severity: "warning", dataId: id, property: "d" });
            }

            const fill = c.attrs.fill;
            if(fill != null && fill.trim().toLowerCase() !== "none") {
                const v = normColor(fill);
                if(isProblem(v)) problem(v, p, { dataId: id, property: "fill" });
                else sp.fill = v;
            } else if(fill == null && c.attrs["fill-image"] == null) {
                sp.fill = "#000000";
            }
            if(c.attrs["fill-image"] != null) {
                const bad = checkSrc(c.attrs["fill-image"]);
                if(bad) problem(bad, p, { dataId: id, property: "fill-image" });
                sp.fillImage = c.attrs["fill-image"];
            }
            const stroke = c.attrs.stroke;
            if(stroke != null && stroke.trim().toLowerCase() !== "none") {
                const v = normColor(stroke);
                if(isProblem(v)) problem(v, p, { dataId: id, property: "stroke" });
                else sp.stroke = v;
                const w = Number((c.attrs["stroke-width"] ?? "1").replace(/px$/, ""));
                if(!Number.isFinite(w) || w < 0 || w > 100) add("out_of_range", p, `stroke-width ${c.attrs["stroke-width"]} is outside 0–100.`, { dataId: id, property: "stroke-width" });
                else sp.strokeWidth = Number(fmt(w));
            }
            paths.push(sp);
        });

        if(paths.length === 0 || paths.length > MAX_PATHS) {
            add("shape_limit", path, `A shape needs 1–${MAX_PATHS} <path> elements (has ${paths.length}).`, { dataId: id, fix: paths.length ? "Split it into several <svg> shapes, or use an image." : "Add a <path>." });
        }
        const bytes = paths.reduce((a, p) => a + byteLength(p.d), 0);
        if(bytes > MAX_PATH_BYTES) {
            add("shape_limit", path, `Path data is ${bytes} bytes; Canva allows ${MAX_PATH_BYTES}.`, { dataId: id, fix: "Simplify the paths, split into several <svg>s, or use an <img> for complex artwork such as logos." });
        }
        const colors = new Set(paths.map(p => p.fill).filter(x => x != null));
        if(colors.size > MAX_FILL_COLORS) {
            add("shape_limit", path, `${colors.size} fill colours; Canva allows ${MAX_FILL_COLORS} per shape.`, { dataId: id, fix: "Split into several <svg> shapes." });
        }

        const node : ShapeNode = { kind: "shape", path, style, viewBox, paths };
        if(id) node.id = id;
        if(readLocked(el, path)) node.locked = true;
        return node;
    };

    // --- page ---

    const html = parseHtml(src);
    issues.push(...html.issues);
    errors += html.issues.length;

    const roots = html.roots.filter(r => r.type === "element" || r.raw.trim() !== "");
    const root = roots[0];
    if(roots.length !== 1 || root.type !== "element" || root.tag !== "page") {
        add("missing_page", "root", "Markup must be exactly one <page width=\"…\" height=\"…\"> element.", { fix: "Wrap everything in a single <page>; no <html>/<body>." });
        return { issues };
    }

    checkAttrs(root, "page");
    const width = Number(root.attrs.width), height = Number(root.attrs.height);
    for(const [k, v] of [["width", width], ["height", height]] as const) {
        if(root.attrs[k] == null) add("missing_attribute", "page", `<page> needs ${k}.`, { property: k, fix: "Copy width/height from get_page." });
        else if(!Number.isInteger(v) || v < PAGE_MIN || v > PAGE_MAX) add("out_of_range", "page", `Page ${k} ${root.attrs[k]} must be a whole number of px, ${PAGE_MIN}–${PAGE_MAX}.`, { property: k });
    }
    if(width * height > PAGE_MAX_AREA) add("out_of_range", "page", `Page area ${width}×${height} exceeds ${PAGE_MAX_AREA} px².`);

    const { style, text } = readStyle(root, "page", PAGE_STYLE);
    const doc : PageDoc = { width, height, style, children: readChildren(root, { path: "page", text, inGroup: false }) };
    if(root.attrs["data-page-id"]) doc.pageId = root.attrs["data-page-id"];
    if(root.attrs["data-revision"]) doc.revision = root.attrs["data-revision"];
    if(readLocked(root, "page")) doc.locked = true;

    const hasErrors = issues.some(x => x.severity === "error");
    return hasErrors ? { issues } : { doc, issues };
}

/** True if two runs can be merged */
export function sameInline(a : InlineFormat, b : InlineFormat) : boolean {
    return a.color === b.color && a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle && a.decoration === b.decoration && a.strikethrough === b.strikethrough && a.link === b.link;
}

/** True if the box draws something (background or border) and so becomes a Canva shape, not just layout */
export function isVisualBox(n : BoxNode) : boolean {
    return n.style["background-color"] != null || n.style["background-image"] != null || n.style.border != null;
}

/** Number of Canva elements a node list produces (layout-only boxes contribute their children). */
export function countElements(nodes : Array<Node>) : number {
    let n = 0;
    for(const x of nodes) {
        if(x.kind === "box") n += (isVisualBox(x) ? 1 : 0) + countElements(x.children);
        else n++;
    }
    return n;
}

function allowedHint(tag : string, prop : string) : string {
    if(TEXT_PROPS.has(prop) && INLINE_PROPS.has(prop) === false && INLINE_TAGS.has(tag)) return "Inside a paragraph only color, font-weight, font-style and text-decoration can change. Split into separate <p>s for other changes.";
    if(prop === "list-style-type") return "Use list-style-type on <ul>, <ol> or <li>.";
    if(BACKGROUND_PROPS.has(prop) || BORDER_PROPS.has(prop)) return "Put backgrounds and borders on a <div> (behind the element).";
    if(ITEM_PROPS.has(prop)) return tag === "page" ? "The page's size comes from its width/height attributes." : "Position the <text> box (or a standalone <p>), not paragraphs inside <text>.";
    if(CONTAINER_PROPS.has(prop)) return "Layout properties belong on <page>, <div> or <group>.";
    return "See the markup spec for which properties each tag takes.";
}
