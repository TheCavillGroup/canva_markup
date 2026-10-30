import type { RawElement } from "./html.ts";
import { checkSrc, PLACED_PROPS } from "../css/mod.ts";
import { BLOCK_TAGS, BOX_STYLE, GROUP_STYLE, IMG_STYLE, KNOWN_TAGS, INLINE_TAGS, TEXT_BOX_STYLE, UNSUPPORTED_TAGS } from "./tags.ts";
import { countElements, isVisualBox } from "./format.ts";
import { createTextReader } from "./text.ts";
import { readSvg } from "./shape.ts";
import type { Ctx, Reader } from "./reader.ts";
import type { BoxNode, EmbedNode, GroupNode, ImageNode, Node, Paragraph, PlaceholderNode, StyleMap, TextNode } from "../types.ts";

export function createNodeReader(cx : Reader) {
    const { add, problem, childPaths, checkAttrs, readId, readLocked, readStyle, textOutside, badTag } = cx;
    const { readParagraph, readList, readBlocks } = createTextReader(cx);

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

        if(el.tag === "svg") return readSvg(cx, el, ctx);

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

    return { readChildren };
}
