import { assert, assertEquals, assertThrows } from "@std/assert";
import { brandProblems, CAVILL, createMarkup, parsePage, serialisePage, type Brand, type TextNode } from "../mod.ts";

const ACME : Brand = {
    name: "Acme",
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
    const m = createMarkup(ACME);
    const r = m.parsePage(page(`<div style="width:10px; height:10px; background-color:brand-sand"></div><h1>Hi</h1><p>Body</p>`));
    assertEquals(r.issues, []);
    const [box, h1, p] = r.doc!.children as [{ style : Record<string, string> }, TextNode, TextNode];
    assertEquals(box.style["background-color"], "#e8dcc8");
    assertEquals(h1.paragraphs[0]!.format.fontFamily, "brand-title");
    assertEquals(p.paragraphs[0]!.format.fontFamily, "brand-copy");
});

Deno.test("another brand's names are rejected", () => {
    const m = createMarkup(ACME);
    const r = m.parsePage(page(`<p style="font-family:brand-headline; color:brand-domino">x</p>`));
    assertEquals(r.doc, undefined);
    assertEquals(r.issues.map(x => x.property).sort(), ["color", "font-family"]);
    assert(r.issues.find(x => x.property === "color")!.fix!.includes("brand-sand"));
});

Deno.test("the default font round-trips without a font-family", () => {
    const m = createMarkup(ACME);
    const doc = m.parsePage(page(`<p>Body</p><p style="font-family:brand-title">Title</p>`)).doc!;
    const out = m.serialisePage(doc);
    assert(!out.includes("font-family:brand-copy"));
    assert(out.includes("font-family:brand-title"));
    assertEquals(m.serialisePage(m.parsePage(out).doc!), out);
});

Deno.test("library fonts as brand defaults are quoted where needed", () => {
    const m = createMarkup({ fonts: {}, colors: {}, defaultFont: "Lato", headingFont: "Playfair Display" });
    const doc = m.parsePage(page(`<h2>Head</h2><p>Body</p>`)).doc!;
    const [h, p] = doc.children as [TextNode, TextNode];
    assertEquals(h.paragraphs[0]!.format.fontFamily, "Playfair Display");
    assertEquals(p.paragraphs[0]!.format.fontFamily, "Lato");
    const out = m.serialisePage(doc);
    assert(out.includes("font-family:&quot;Playfair Display&quot;"));
    assertEquals(m.serialisePage(m.parsePage(out).doc!), out);
});

Deno.test("plain exports are the Cavill brand", () => {
    const src = page(`<p style="font-family:brand-headline">x</p>`);
    assertEquals(serialisePage(parsePage(src).doc!), createMarkup(CAVILL).serialisePage(createMarkup(CAVILL).parsePage(src).doc!));
});

Deno.test("brand names must look like brand-…", () => {
    assertEquals(brandProblems(CAVILL), []);
    const bad : Brand = { fonts: { "Title": { ref: "AAAAAAAAAAA:0", family: "Montserrat" } }, colors: { "sand": "#E8DCC8" }, defaultFont: "brand-missing", headingFont: "Title" };
    const problems = brandProblems(bad);
    assertEquals(problems.length, 4);
    assertThrows(() => createMarkup(bad), Error, "Invalid brand");
});

Deno.test("brandSpec lists fonts with their weights and colours", () => {
    const spec = createMarkup(ACME).brandSpec();
    assertEquals(spec.fonts, "| `brand-title` | Montserrat. Weights: normal, bold |\n| `brand-copy` | Lato |");
    assertEquals(spec.colors, "| `brand-sand` | `#e8dcc8` |");
    assertEquals(spec["default-font"], "brand-copy");
});
