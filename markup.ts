import { assertBrand, brandSpec, renderSpec, type Brand } from "./brand.ts";
import { parsePage } from "./parse/mod.ts";
import { paragraphDefaults } from "./parse/format.ts";
import { fontFamilyCss, serialiseNode, serialisePage } from "./serialise.ts";
import { checkAgainstBase } from "./base.ts";
import { createHtml, type HtmlTag, type TemplateResult } from "./template.ts";
import type { Issue, Node, PageDoc, ParagraphFormat, ParseResult } from "./types.ts";

/** The markup functions bound to one brand */
export interface Markup {
    readonly brand : Brand;
    parsePage(src : string | TemplateResult) : ParseResult;
    serialisePage(doc : PageDoc) : string;
    serialiseNode(n : Node) : string;
    checkAgainstBase(base : PageDoc, next : PageDoc) : Array<Issue>;
    fontFamilyCss(fontFamily : string) : string;
    /** Paragraph format a <p> gets when the markup doesn't set it */
    readonly defaultParagraph : ParagraphFormat;
    /** docs/MARKUP.md with this brand's fonts and colours filled in */
    renderSpec(spec : string) : string;
    brandSpec() : ReturnType<typeof brandSpec>;
    /** html`` that serialises nodes with this brand */
    readonly html : HtmlTag;
}

/**
 * Parser, serialiser and base checks for one brand. Throws if the brand is invalid.
 *
 * @example
 * ```ts
 * const m = createMarkup({ ...CAVILL, colors: { ...CAVILL.colors, "brand-sand": "#e8dcc8" } });
 * m.parsePage(`<page width="800" height="600" style="background-color:brand-sand"></page>`);
 * ```
 */
export function createMarkup(brand : Brand) : Markup {
    assertBrand(brand);
    return {
        brand,
        parsePage: src => parsePage(src, brand),
        serialisePage: doc => serialisePage(doc, brand),
        serialiseNode: n => serialiseNode(n, brand),
        checkAgainstBase: (base, next) => checkAgainstBase(base, next, brand),
        fontFamilyCss: f => fontFamilyCss(f, brand),
        defaultParagraph: paragraphDefaults(brand),
        renderSpec: spec => renderSpec(spec, brand),
        brandSpec: () => brandSpec(brand),
        html: createHtml(brand)
    };
}
