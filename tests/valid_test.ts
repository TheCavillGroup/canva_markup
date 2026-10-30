import { assertEquals } from "@std/assert";
import { ok, wrap } from "./helpers.ts";
import type { ImageNode, ShapeNode, TextNode } from "../mod.ts";

Deno.test("layout-mode page with flex, image, headings, box", () => {
    const doc = ok(`<page width="1080" height="1350" style="background-color:#F4EFE9; display:flex; flex-direction:column; padding:64px; gap:24px">
        <img src="brand:logo-primary-black" style="width:240px; height:80px">
        <h1>Just Listed</h1>
        <div style="background-color:#1d1d1b; padding:32px; border-radius:24px">
            <p style="color:#fff">Inside a card</p>
        </div>
    </page>`);

    assertEquals(doc.width, 1080);
    assertEquals(doc.style["background-color"], "#f4efe9");
    assertEquals(doc.children.map(x => x.kind), ["image", "text", "box"]);

    const h1 = doc.children[1] as TextNode;
    assertEquals(h1.paragraphs[0].format.fontFamily, "brand-headline");
    assertEquals(h1.paragraphs[0].format.fontSize, 64);

    const card = doc.children[2];
    if(card.kind !== "box") throw new Error("expected box");
    assertEquals(card.style["border-radius"], "24px");
    const inner = card.children[0] as TextNode;
    assertEquals(inner.paragraphs[0].runs[0].format.color, "#ffffff");
});

Deno.test("absolute-mode page as get_page returns it", () => {
    const doc = ok(`<page width="800" height="600" data-page-id="PBllB4wHzD1KYHl9" data-revision="7a627bd74c174fcb" style="background-color:#ffffff">
  <div data-id="r1" style="position:absolute; left:139.66px; top:77.63px; width:200px; height:120px; background-color:#c8a165"></div>
  <svg data-id="s1" viewBox="0 0 64 64" style="position:absolute; left:310px; top:210px; width:180px; height:180px">
    <path d="M0 0H64V64H0z" fill="#c8a165" />
  </svg>
  <text data-id="t1" style="position:absolute; left:40px; top:200px; width:600px" data-measured-height="57.4">
    <p style="font-family:&quot;ref:YAF209YF8M8:0&quot;; font-size:48px; color:#1d1d1b">Spike region</p>
  </text>
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:264px; top:298px; width:272px; height:4px" />
</page>`);

    assertEquals(doc.pageId, "PBllB4wHzD1KYHl9");
    assertEquals(doc.revision, "7a627bd74c174fcb");
    assertEquals(doc.children.map(x => x.id), ["r1", "s1", "t1", "u1"]);
    const t = doc.children[2] as TextNode;
    assertEquals(t.measuredHeight, 57.4);
    assertEquals(t.paragraphs[0].format.fontFamily, "ref:YAF209YF8M8:0");
});

Deno.test("text: inline formatting, links, inheritance, entities, whitespace", () => {
    const doc = ok(wrap(`<text style="font-family:'Montserrat'; color:#333333">
        <p style="text-align:right; line-height:24px; font-size:16px; letter-spacing:1.6px">A  <b>bold</b>
            <i>move</i> &amp; <a href="https://thecavillgroup.com.au" style="color:#c8a165">link</a>&#32;</p>
        <p><span style="text-decoration:underline line-through">both</span><u>under</u><s>strike</s></p>
    </text>`));

    const t = doc.children[0] as TextNode;
    const [p1, p2] = t.paragraphs;
    assertEquals(p1.format.fontFamily, "Montserrat");
    assertEquals(p1.format.textAlign, "end");
    assertEquals(p1.format.lineHeight, 1.5);
    assertEquals(p1.format.letterSpacing, 0.1);
    assertEquals(p1.runs.map(r => r.text), ["A  ", "bold", " ", "move", " & ", "link", " "]);
    assertEquals(p1.runs[1].format.fontWeight, "bold");
    assertEquals(p1.runs[3].format.fontStyle, "italic");
    assertEquals(p1.runs[5].format.link, "https://thecavillgroup.com.au");
    assertEquals(p1.runs[5].format.color, "#c8a165");
    assertEquals(p1.runs[0].format.color, "#333333");

    assertEquals(p2.runs.map(r => [r.text, r.format.decoration, r.format.strikethrough]), [
        ["both", "underline", "strikethrough"],
        ["under", "underline", "none"],
        ["strike", "none", "strikethrough"]
    ]);
});

Deno.test("lists: nesting, markers, ol/ul defaults, bare li for level jumps", () => {
    const doc = ok(wrap(`<text>
        <ul>
            <li>one</li>
            <li>two
                <ol><li>a</li><li style="list-style-type:lower-roman">b</li></ol>
            </li>
            <li><ul style="list-style-type:square"><li>jumped</li></ul></li>
        </ul>
        <p>after</p>
    </text>`));

    const t = doc.children[0] as TextNode;
    assertEquals(t.paragraphs.map(p => [p.runs.map(r => r.text).join(""), p.format.listLevel, p.format.listMarker]), [
        ["one", 1, "disc"],
        ["two", 1, "disc"],
        ["a", 2, "decimal"],
        ["b", 2, "lower-roman"],
        ["jumped", 2, "square"],
        ["after", 0, "none"]
    ]);
});

Deno.test("standalone ul becomes its own text element", () => {
    const doc = ok(wrap(`<ul style="position:absolute; left:10px; top:10px; width:300px; font-size:20px"><li>x</li></ul>`));
    const t = doc.children[0] as TextNode;
    assertEquals(t.kind, "text");
    assertEquals(t.style.left, "10px");
    assertEquals(t.paragraphs[0].format.fontSize, 20);
});

Deno.test("groups, embeds, images, borders, rotation, opacity", () => {
    const doc = ok(wrap(`
        <group data-id="g1" style="position:absolute; left:10px; top:10px">
            <div style="width:100px; height:100px; border:2px solid #000; background-color:#ffffff"></div>
            <p>Caption</p>
        </group>
        <canva-embed data-id="e1" src="https://www.youtube.com/watch?v=x" style="position:absolute; left:0; top:0; width:560px; height:315px" />
        <img data-id="i1" src="canva:MAHZKTyoC_Q:1" alt="Front" style="width:300px; aspect-ratio:16/9; border-radius:50%; opacity:80%; transform:rotate(270deg)">
    `));

    const g = doc.children[0];
    if(g.kind !== "group") throw new Error("expected group");
    const box = g.children[0];
    if(box.kind !== "box") throw new Error("expected box");
    assertEquals(box.style.border, "2px solid #000000");

    const img = doc.children[2] as ImageNode;
    assertEquals(img.src, "canva:MAHZKTyoC_Q:1");
    assertEquals(img.style.opacity, "0.8");
    assertEquals(img.style.transform, "rotate(-90deg)");
    assertEquals(img.style["aspect-ratio"], "16 / 9");
});

Deno.test("svg: multiple paths, stroke, fill-image, quadratic conversion warning", () => {
    const r = ok(wrap(`<svg viewBox="0 0 100 100" style="width:100px">
        <path d="M0 0 L100 0 V100 Z" fill="#AABBCC" stroke="#000000" stroke-width="3" />
        <path d="M0 0 h50 v50 z" fill="none" fill-image="https://example.com/a.jpg" />
        <path d="M 0 50 Q 25 0 50 50 T 100 50" />
    </svg>`));
    const s = r.children[0] as ShapeNode;
    assertEquals(s.paths[0], { d: "M0 0 L100 0 V100 Z", fill: "#aabbcc", stroke: "#000000", strokeWidth: 3 });
    assertEquals(s.paths[1].fill, undefined);
    assertEquals(s.paths[1].fillImage, "https://example.com/a.jpg");
    assertEquals(s.paths[2].fill, "#000000");
    assertEquals(s.paths[2].d.includes("Q"), false);
});

Deno.test("comments are ignored and locked/page attributes are read", () => {
    const doc = ok(`<!-- note --><page width="40" height="8000" data-locked="true"><div data-id="r1" data-locked="true" style="background-color:#000"></div></page>`);
    assertEquals(doc.locked, true);
    assertEquals(doc.children[0].locked, true);
});

Deno.test("brand colours and the script font alias", () => {
    const doc = ok(wrap(`<div style="width:10px; height:10px; background-color:brand-text-blue; border:2px solid brand-domino"></div><p style="font-family:brand-script; color:brand-lexicon">x</p>`));
    const box = doc.children[0];
    if(box.kind !== "box") throw new Error("expected box");
    assertEquals(box.style["background-color"], "#86d0cc");
    assertEquals(box.style.border, "2px solid #231f20");
    const t = doc.children[1] as TextNode;
    assertEquals(t.paragraphs[0].format.fontFamily, "brand-script");
    assertEquals(t.paragraphs[0].runs[0].format.color, "#eaeaea");
});
