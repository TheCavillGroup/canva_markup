import { parseHtml } from "./html.ts";
import { PAGE_MAX, PAGE_MAX_AREA, PAGE_MIN } from "./format.ts";
import { createReader } from "./reader.ts";
import { createNodeReader } from "./nodes.ts";
import { PAGE_STYLE } from "./tags.ts";
import type { PageDoc, ParseResult } from "../types.ts";
import { CAVILL, type Brand } from "../brand.ts";

/**
 * Parses and validates a page against a brand (default {@link CAVILL}). `doc` is only set when there are no errors; warnings can come either way.
 *
 * @example
 * ```ts
 * const { doc, issues } = parsePage(`<page width="800" height="600"><p>Hello</p></page>`);
 * ```
 */
export function parsePage(src : string, brand : Brand = CAVILL) : ParseResult {
    const cx = createReader(brand);
    const { issues, add, checkAttrs, readLocked, readStyle } = cx;
    const { readChildren } = createNodeReader(cx);

    // --- page ---

    const html = parseHtml(src);
    cx.adopt(html.issues);

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

export * from "./format.ts";
