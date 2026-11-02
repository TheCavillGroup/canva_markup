import { escapeAttr, serialiseNode, serialisePage } from "./serialise.ts";
import type { Node, PageDoc } from "./types.ts";

// The html`` tag: builds markup from listing data without hand-escaping it. Values are escaped, nested
// templates aren't, and parsed nodes come back as canonical markup with their data-ids.

const TEMPLATE = Symbol("canva-markup.template");

// Numbers on these get no px
const UNITLESS = ["opacity", "line-height", "font-weight", "aspect-ratio", "flex", "flex-grow", "flex-shrink", "grid-row", "grid-column"] as const;

/** Markup built by {@link html}. `${x}` or `String(x)` gives the markup; parsePage and applyPage take it as is. */
export interface TemplateResult {
    readonly [TEMPLATE] : true;
    readonly markup : string;
    toString() : string;
}

/** Anything a `${…}` in {@link html} can take */
export type TemplateValue = string | number | boolean | null | undefined | TemplateResult | Node | PageDoc | StyleObject | ReadonlyArray<TemplateValue>;

/** A style attribute as an object: camelCase or kebab-case keys, numbers in px (except unitless props) */
export type StyleObject = { readonly [prop : string] : string | number | null | undefined | false };

export type HtmlTag = (strings : TemplateStringsArray, ...values : Array<TemplateValue>) => TemplateResult;

const template = (markup : string) : TemplateResult => Object.freeze({ [TEMPLATE]: true as const, markup, toString: () => markup });

export const isTemplate = (x : unknown) : x is TemplateResult => typeof x === "object" && x != null && (x as any)[TEMPLATE] === true;

/**
 * Markup that goes into {@link html} without escaping. Only for markup you trust.
 *
 * @example
 * ```ts
 * html`<text>${raw("<p>Already <b>escaped</b> &amp; checked</p>")}</text>`;
 * ```
 */
export const raw = (markup : string) : TemplateResult => template(markup);

const escape = (s : string) => escapeAttr(s).replace(/>/g, "&gt;");

const isPageDoc = (x : object) : x is PageDoc => "children" in x && "width" in x && "height" in x && !("kind" in x);
const isNode = (x : object) : x is Node => "kind" in x && "path" in x && "style" in x;

/** A style object as a css string, e.g. `{ left: 64, fontSize: 28 }` → `left:64px; font-size:28px` */
export function styleString(style : StyleObject) : string {
    const out : Array<string> = [];
    for(const key in style) {
        const v = style[key];
        if(v == null || v === false) continue;
        const prop = key.startsWith("--") ? key : key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
        const value = typeof v === "number" && !(UNITLESS as ReadonlyArray<string>).includes(prop) && v !== 0 ? `${v}px` : String(v);
        out.push(`${prop}:${value}`);
    }
    return out.join("; ");
}

function render(v : TemplateValue) : string {
    if(v == null || typeof v === "boolean") return "";
    if(typeof v === "string") return escape(v);
    if(typeof v === "number") return String(v);
    if(isTemplate(v)) return v.markup;
    if(Array.isArray(v)) return v.map(render).join("");
    if(isPageDoc(v as object)) return serialisePage(v as PageDoc);
    if(isNode(v as object)) return serialiseNode(v as Node);
    return escape(styleString(v as StyleObject));
}

/**
 * Builds markup for the default brand ({@link CAVILL}). Strings and numbers are escaped, nested html``
 * and {@link raw} aren't, arrays are joined, and `false`/`null`/`undefined` render nothing (so `&&` and
 * `?:` work). An object is a style: camelCase or kebab-case keys, numbers in px. A parsed node or page
 * (from parsePage or readPage) renders as its canonical markup, data-ids and all.
 *
 * @example
 * ```ts
 * import { parsePage } from "@thecavillgroup/canva-markup";
 *
 * const listing ={ address: "12 Example St", suburb: "Wahroonga", beds: 4, sold: false };
 * const stat = (label : string, n : number) => html`<p style=${{ fontSize: 28, textAlign: "center" }}>${n} ${label}</p>`;
 *
 * const page = html`<page width="1080" height="1350" style=${{ display: "flex", flexDirection: "column", padding: 64, gap: 32 }}>
 *   <h1>${listing.sold ? "Sold" : "Just Listed"}</h1>
 *   <p>${listing.address}, <b>${listing.suburb}</b></p>
 *   ${stat("bed", listing.beds)}
 *   ${listing.sold && html`<p>Sold by The Cavill Group</p>`}
 * </page>`;
 * parsePage(page);
 * ```
 */
export const html : HtmlTag = (strings, ...values) => {
    let out = strings[0];
    for(let i = 0; i < values.length; i++) {
        const v = render(values[i]);
        // attr=${x} without quotes gets them, so styles with spaces stay one attribute
        out += (/=\s*$/.test(strings[i]) ? `"${v}"` : v) + strings[i + 1];
    }
    return template(out);
};
