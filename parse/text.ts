import { decodeEntities, type RawElement, type RawNode } from "./html.ts";
import { fmt, INLINE_PROPS, TEXT_PROPS } from "../css/mod.ts";
import { BLOCK_TAGS, HEADING_SIZES, INLINE_TAGS, TEXT_BOX_STYLE } from "./tags.ts";
import { DEFAULT_INLINE, DEFAULT_PARAGRAPH, sameInline } from "./format.ts";
import type { Reader } from "./reader.ts";
import type { FontWeight, InlineFormat, ListMarker, Paragraph, ParagraphFormat, Run, StyleMap, TextAlign } from "../types.ts";

type RawRun = { raw : string, format : InlineFormat };

export function createTextReader(cx : Reader) {
    const { add, childPaths, checkAttrs, readStyle, textOutside, badTag } = cx;

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
                else if(!/^(https:\/\/\S+|mailto:\S+@\S+|tel:[+\d\s()-]+)$/i.test(href)) add("invalid_value", p, `href "${href}" isn't supported.`, { property: "href", fix: "Use https://, mailto: or tel: links." });
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

    return { readParagraph, readList, readBlocks };
}
