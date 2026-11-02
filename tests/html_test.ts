import { assert, assertEquals } from "@std/assert";
import { ok, strip, wrap } from "./helpers.ts";
import { CAVILL, createMarkup, html, isTemplate, parsePage, raw, serialisePage, styleString, type TextNode } from "../mod.ts";

const ABSOLUTE = `<page width="800" height="600" data-page-id="P1" data-revision="abc" style="background-color:#ffffff">
  <div data-id="r1" style="position:absolute; left:40px; top:40px; width:200px; height:120px; background-color:#c8a165"></div>
  <text data-id="t1" style="position:absolute; left:40px; top:200px; width:600px" data-measured-height="57.4">
    <p style="font-family:brand-headline; font-size:48px">Open Saturday &amp; Sunday</p>
  </text>
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:264px; top:298px; width:272px; height:4px" />
</page>`;

Deno.test("html escapes strings in text and attributes", () => {
    const name = `Smith & Co <"Sold">`;
    const t = html`<p title=${name}>${name}</p>`;
    assertEquals(t.markup, `<p title="Smith &amp; Co &lt;&quot;Sold&quot;&gt;">Smith &amp; Co &lt;&quot;Sold&quot;&gt;</p>`);

    const doc = ok(String(html`<page width="800" height="600"><img src=${"https://example.com/a.jpg?w=1&h=2"} alt="${name}" style="width:100px; height:100px"><p>${name}</p></page>`));
    assertEquals((doc.children[1] as TextNode).paragraphs[0].runs[0].text, name);
    assertEquals(doc.children[0].kind === "image" && doc.children[0].alt, name);
    assertEquals(doc.children[0].kind === "image" && doc.children[0].src, "https://example.com/a.jpg?w=1&h=2");
});

Deno.test("html nests templates and raw without escaping them again", () => {
    const inner = html`<b>${"a & b"}</b>`;
    assertEquals(html`<p>${inner} ${raw("&amp;")}</p>`.markup, "<p><b>a &amp; b</b> &amp;</p>");
    assert(isTemplate(inner));
    assert(!isTemplate("<b></b>"));
    assertEquals(`${inner}`, "<b>a &amp; b</b>");
});

Deno.test("html joins arrays and drops false, null, undefined and true", () => {
    const items = ["4 bed", "2 bath"];
    const sold = false;
    assertEquals(html`<ul>${items.map(x => html`<li>${x}</li>`)}</ul>`.markup, "<ul><li>4 bed</li><li>2 bath</li></ul>");
    assertEquals(html`<p>${sold && "Sold"}${null}${undefined}${true}${0}</p>`.markup, "<p>0</p>");
    assertEquals(html`<p>${sold ? "Sold" : "For sale"}</p>`.markup, "<p>For sale</p>");
});

Deno.test("style objects: camelCase or kebab-case keys, px for numbers except unitless", () => {
    assertEquals(
        styleString({ position: "absolute", left: 64, top: 0, "font-size": 28, fontWeight: 600, lineHeight: 1.2, opacity: 0.5, aspectRatio: "4 / 3", color: false, width: null, gridColumn: 2 }),
        "position:absolute; left:64px; top:0; font-size:28px; font-weight:600; line-height:1.2; opacity:0.5; aspect-ratio:4 / 3; grid-column:2"
    );
    assertEquals(html`<p style=${{ fontFamily: "\"Montserrat\"" }}>x</p>`.markup, `<p style="font-family:&quot;Montserrat&quot;">x</p>`);

    const doc = ok(String(html`<page width="800" height="600"><div style="${{ position: "absolute", left: 10, top: 20, width: 100, height: 50, backgroundColor: "brand-text-blue" }}"></div></page>`));
    assertEquals(doc.children[0].style, ok(wrap(`<div style="position:absolute; left:10px; top:20px; width:100px; height:50px; background-color:#86d0cc"></div>`)).children[0].style);
});

Deno.test("nodes and pages render as canonical markup and keep their data-ids", () => {
    const base = ok(ABSOLUTE);
    assertEquals(strip(ok(String(html`${base}`))), strip(base));

    const [box, text, placeholder] = base.children;
    const next = ok(String(html`<page width=${base.width} height=${base.height} data-page-id=${base.pageId} data-revision=${base.revision} style=${{ backgroundColor: "#ffffff" }}>
        ${[box, placeholder]}
        <text data-id=${text.id} style=${{ position: "absolute", left: 40, top: 200, width: 600 }}>
            <p style=${{ fontFamily: "brand-headline", fontSize: 48 }}>${"Open Sunday & Monday"}</p>
        </text>
    </page>`));
    assertEquals(next.children.map(x => x.id), ["r1", "u1", "t1"]);
    assertEquals((next.children[2] as TextNode).paragraphs[0].runs[0].text, "Open Sunday & Monday");
    assertEquals(serialisePage({ ...next, children: next.children.slice(0, 2) }), serialisePage({ ...base, children: [box, placeholder] }));
});

Deno.test("m.html serialises nodes with its own brand", () => {
    const m = createMarkup({ ...CAVILL, fonts: { ...CAVILL.fonts, "brand-title": { ref: "YAF209YF8M8:0", family: "Safira March" } } });
    const doc = m.parsePage(m.html`<page width="800" height="600"><p style=${{ fontFamily: "brand-title" }}>Hi</p></page>`).doc!;
    assert(m.html`${doc.children[0]}`.markup.includes("font-family:brand-title"));
    // CAVILL has no brand-title alias, so it quotes it like a library font
    assert(html`${doc.children[0]}`.markup.includes("font-family:&quot;brand-title&quot;"));
});

Deno.test("parsePage takes a template", () => {
    const r = parsePage(html`<page width="800" height="600"><p>${"<b>not a tag</b>"}</p></page>`);
    assertEquals(r.issues, []);
    assertEquals((r.doc!.children[0] as TextNode).paragraphs[0].runs[0].text, "<b>not a tag</b>");
});
