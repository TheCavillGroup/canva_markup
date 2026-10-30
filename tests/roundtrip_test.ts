import { assertEquals } from "@std/assert";
import { ok, strip } from "./helpers.ts";
import { DEFAULT_INLINE, DEFAULT_PARAGRAPH, parsePage, serialisePage } from "../mod.ts";
import type { InlineFormat, PageDoc, Paragraph } from "../mod.ts";

const FIXTURES : Record<string, string> = {
    layout: `<page width="1080" height="1350" style="background-color:#F4EFE9; display:grid; grid-template-columns:repeat(2, 1fr); gap:24px 12px; padding:64px; color:#1d1d1b">
        <h2 style="grid-column:1 / 3">Open home this Saturday</h2>
        <img src="https://example.com/front.jpg" alt="Front" style="width:100%; aspect-ratio:4 / 3; border-radius:16px">
        <div style="background-color:#ffffff; border:1px solid #DDD; padding:24px; display:flex; flex-direction:column; gap:8px">
            <p style="font-size:14px; letter-spacing:0.05em; text-transform:none">  leading spaces kept</p>
            <ul style="font-size:18px"><li>4 bed</li><li>2 bath<ul style="list-style-type:circle"><li>ensuite</li></ul></li><li>2 car</li></ul>
            <ol><li>first</li></ol>
        </div>
    </page>`.replace("; text-transform:none", ""),

    absolute: `<page width="800" height="600" data-page-id="PBllB4wHzD1KYHl9" data-revision="7a627bd74c174fcb" style="background-color:#ffffff">
  <div data-id="r1" style="position:absolute; left:139.66px; top:77.63px; width:200px; height:120px; background-color:#c8a165"></div>
  <svg data-id="s1" viewBox="0 0 64 64" style="position:absolute; left:310px; top:210px; width:180px; height:180px">
    <path d="M0 0H64V64H0z" fill="#c8a165" />
  </svg>
  <group data-id="g1" style="position:absolute; left:10px; top:400px; width:300px; height:120px">
    <img data-id="i1" src="canva:MAHZKTyoC_Q:1" style="position:absolute; left:0px; top:0px; width:300px; height:100px; transform:rotate(-12.5deg); opacity:0.75" />
    <text data-id="t2" style="position:absolute; left:0px; top:100px; width:300px" data-measured-height="20">
      <p style="font-family:&quot;Montserrat&quot;; text-align:center">Mixed <span style="font-weight:bold">bold</span> <a href="https://thecavillgroup.com.au">link</a> &amp; &lt;tags&gt;</p>
    </text>
  </group>
  <text data-id="t1" style="position:absolute; left:40px; top:200px; width:600px" data-measured-height="57.4">
    <p style="font-family:&quot;ref:YAF209YF8M8:0&quot;; font-size:48px; line-height:1.2; color:#1d1d1b">Spike region</p>
    <p></p>
    <ul>
      <li>one</li>
      <li>
        <ol style="list-style-type:lower-alpha">
          <li>jumped</li>
        </ol>
      </li>
    </ul>
  </text>
  <canva-embed data-id="e1" src="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=1" style="position:absolute; left:0px; top:0px; width:560px; height:315px" />
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:264px; top:298px; width:272px; height:4px" />
</page>`
};

for(const [name, src] of Object.entries(FIXTURES)) {
    Deno.test(`round trip is stable: ${name}`, () => {
        const doc = ok(src);
        const s1 = serialisePage(doc);
        const doc2 = ok(s1);
        // Same model before and after serialising
        assertEquals(strip(doc2), strip(doc));
        // Canonical markup is a fixed point
        assertEquals(serialisePage(doc2), s1);
    });
}

// A page as the app would build it from Canva: raw floats, odd text, every node kind
const inline = (o : Partial<InlineFormat> = {}) : InlineFormat => ({ ...DEFAULT_INLINE, ...o });
const para = (runs : Paragraph["runs"], o : Partial<Paragraph["format"]> = {}) : Paragraph => ({ format: { ...DEFAULT_PARAGRAPH, ...o }, runs });

function canvaLike() : PageDoc {
    return {
        width: 1080,
        height: 1350,
        pageId: "PBFtXDCKkZs0LtgS",
        revision: "5d8c1e74b700e59a",
        style: { "background-color": "#f4efe9" },
        children: [
            { kind: "box", id: "r1", path: "", style: { position: "absolute", left: "139.66px", top: "77.63px", width: "200px", height: "120px", "background-color": "#c8a165", border: "6px solid #1d1d1b" }, children: [] },
            { kind: "image", id: "r2", path: "", src: "canva:MAHZKZ3NFvg:1", style: { position: "absolute", left: "40px", top: "420px", width: "400px", height: "300px" } },
            { kind: "shape", id: "s1", path: "", viewBox: [0, 0, 400, 300], paths: [{ d: "M 40 0 H 360 A 40 40 0 0 1 400 40 V 260 Z", fillImage: "canva:MAHZKZ3NFvg:1" }], style: { position: "absolute", left: "480px", top: "420px", width: "400px", height: "300px" } },
            {
                kind: "text", id: "t1", path: "", measuredHeight: 124.4, style: { position: "absolute", left: "40px", top: "300px", width: "600px", transform: "rotate(5deg)" },
                paragraphs: [
                    para([{ text: "Tabs\tand  double  spaces ", format: inline({ color: "#1d1d1b" }) }], { fontFamily: "ref:YAF209YF8M8:0", fontSize: 48 }),
                    para([
                        { text: "Line ", format: inline() },
                        { text: "bold", format: inline({ fontWeight: "bold" }) },
                        { text: " <&> ", format: inline({ decoration: "underline", strikethrough: "strikethrough" }) },
                        { text: "link", format: inline({ link: "mailto:hello@thecavillgroup.com.au", fontStyle: "italic" }) }
                    ], { textAlign: "justify", lineHeight: 1.4167, letterSpacing: -0.05 }),
                    para([], {}),
                    para([{ text: "deep", format: inline() }], { listLevel: 3, listMarker: "square" }),
                    para([{ text: "back", format: inline() }], { listLevel: 1, listMarker: "decimal" }),
                    para([{ text: " nbsp sep", format: inline() }], {})
                ]
            },
            { kind: "embed", id: "e1", path: "", src: "https://www.youtube.com/watch?v=x", style: { position: "absolute", left: "0px", top: "0px", width: "560px", height: "315px", opacity: "0.9" } },
            { kind: "unsupported", id: "u1", path: "", detail: "unsupported", style: { position: "absolute", left: "264px", top: "298px", width: "272px", height: "4px" } }
        ]
    };
}

Deno.test("canva-built page survives serialise → parse unchanged", () => {
    const doc = canvaLike();
    const s1 = serialisePage(doc);
    const r = parsePage(s1);
    assertEquals(r.issues, []);
    assertEquals(strip(r.doc!), strip(doc));
    assertEquals(serialisePage(r.doc!), s1);
});

Deno.test("editing one element leaves every other line byte-identical", () => {
    const s1 = serialisePage(canvaLike());
    const edited = s1.replace("left:139.66px", "left:200px");
    const s2 = serialisePage(ok(edited));
    const a = s1.split("\n"), b = s2.split("\n");
    assertEquals(a.length, b.length);
    const changed = a.map((line, i) => line === b[i] ? -1 : i).filter(i => i >= 0);
    assertEquals(changed.length, 1);
    assertEquals(b[changed[0]].includes(`data-id="r1"`), true);
});
