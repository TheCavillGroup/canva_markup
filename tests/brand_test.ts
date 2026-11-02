import { assert, assertEquals, assertThrows } from "@std/assert";
import { assertBrand, brandProblems, CAVILL, parsePage, serialisePage, type Brand, type TextNode } from "../mod.ts";
import { brandSpec } from "../spec.ts";

const ACME : Brand = {
    fonts: {
        "brand-title": { ref: "AAAAAAAAAAA:0", family: "Montserrat", weights: ["normal", "bold"] },
        "brand-copy": { ref: "BBBBBBBBBBB:0", family: "Lato" }
    },
    colors: { "brand-sand": "#e8dcc8" },
    defaultFont: "brand-copy",
    headingFont: "brand-title"
};

const page = (inner : string) => `<page width="800" height="600">${inner}</page>`;

Deno.test("a custom brand parses its own aliases and colours", () => {
    const r = parsePage(page(`<div style="width:10px; height:10px; background-color:brand-sand"></div><h1>Hi</h1><p>Body</p>`), ACME);
    assertEquals(r.issues, []);
    const [box, h1, p] = r.doc!.children as [{ style : Record<string, string> }, TextNode, TextNode];
    assertEquals(box.style["background-color"], "#e8dcc8");
    assertEquals(h1.paragraphs[0]!.format.fontFamily, "brand-title");
    assertEquals(p.paragraphs[0]!.format.fontFamily, "brand-copy");
});

Deno.test("another brand's names are rejected", () => {
    const r = parsePage(page(`<p style="font-family:brand-headline; color:brand-domino">x</p>`), ACME);
    assertEquals(r.doc, undefined);
    assertEquals(r.issues.map(x => x.property).sort(), ["color", "font-family"]);
    assert(r.issues.find(x => x.property === "color")!.fix!.includes("brand-sand"));
});

Deno.test("the default font round-trips without a font-family", () => {
    const doc = parsePage(page(`<p>Body</p><p style="font-family:brand-title">Title</p>`), ACME).doc!;
    const out = serialisePage(doc, ACME);
    assert(!out.includes("font-family:brand-copy"));
    assert(out.includes("font-family:brand-title"));
    assertEquals(serialisePage(parsePage(out, ACME).doc!, ACME), out);
});

Deno.test("library fonts as brand defaults are quoted where needed", () => {
    const lib : Brand = { fonts: {}, colors: {}, defaultFont: "Lato", headingFont: "Playfair Display" };
    const doc = parsePage(page(`<h2>Head</h2><p>Body</p>`), lib).doc!;
    const [h, p] = doc.children as [TextNode, TextNode];
    assertEquals(h.paragraphs[0]!.format.fontFamily, "Playfair Display");
    assertEquals(p.paragraphs[0]!.format.fontFamily, "Lato");
    const out = serialisePage(doc, lib);
    assert(out.includes("font-family:&quot;Playfair Display&quot;"));
    assertEquals(serialisePage(parsePage(out, lib).doc!, lib), out);
});

Deno.test("plain exports are the Cavill brand", () => {
    const src = page(`<p style="font-family:brand-headline">x</p>`);
    assertEquals(serialisePage(parsePage(src).doc!), serialisePage(parsePage(src, CAVILL).doc!, CAVILL));
});

Deno.test("brand names must look like brand-…", () => {
    assertEquals(brandProblems(CAVILL), []);
    const bad : Brand = { fonts: { "Title": { ref: "AAAAAAAAAAA:0", family: "Montserrat" } }, colors: { "sand": "#E8DCC8" }, defaultFont: "brand-missing", headingFont: "Title" };
    const problems = brandProblems(bad);
    assertEquals(problems.length, 4);
    assertThrows(() => assertBrand(bad), Error, "Invalid brand");
});

Deno.test("brandSpec lists fonts with their weights and colours", () => {
    const spec = brandSpec(ACME);
    assertEquals(spec.fonts, "| `brand-title` | Montserrat. Weights: normal, bold |\n| `brand-copy` | Lato |");
    assertEquals(spec.colors, "| `brand-sand` | `#e8dcc8` |");
    assertEquals(spec["default-font"], "brand-copy");
});
