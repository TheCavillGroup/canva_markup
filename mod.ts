/**
 * Canva Bridge page markup: a strict HTML subset that describes one Canva page. Parses it into a
 * normalised {@link PageDoc}, rejects anything Canva can't represent (each {@link Issue} names the node
 * and usually a fix), serialises back to canonical markup, and checks an edit against the page it was
 * based on.
 *
 * Font aliases and colour names come from a {@link Brand}: every function takes one as its last
 * argument and defaults to {@link CAVILL}. Plain TS with no Deno or DOM globals, so it runs in a
 * browser bundle too.
 *
 * Build markup with the {@link html} tag: it escapes listing data, takes style objects, and renders parsed
 * nodes back with their data-ids.
 *
 * The `./canva` export reconciles markup with a live page inside a Canva app (read, diff, apply).
 *
 * @example
 * ```ts
 * import { checkAgainstBase, parsePage, serialisePage } from "@thecavillgroup/canva-markup";
 *
 * const base = parsePage(`<page width="800" height="600">
 *   <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>
 * </page>`);
 * if(!base.doc) throw new Error(base.issues.map(x => x.message).join("\n"));
 *
 * const next = parsePage(serialisePage(base.doc).replace("#000000", "brand-text-blue"));
 * console.log(next.issues, checkAgainstBase(base.doc, next.doc!));
 * ```
 *
 * @module
 */
export * from "./types.ts";
export { CAVILL, assertBrand, brandProblems, type Brand, type BrandFont } from "./brand.ts";
export { renderSpec } from "./spec.ts";
export { html, raw, isTemplate, type TemplateResult, type TemplateValue, type StyleObject, type HtmlTag } from "./template.ts";
export { parsePage } from "./parse/mod.ts";
export { serialisePage } from "./serialise.ts";
export { checkAgainstBase } from "./base.ts";
