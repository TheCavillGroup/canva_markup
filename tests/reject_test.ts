import { assert, assertEquals } from "@std/assert";
import { fails, wrap } from "./helpers.ts";
import { ISSUE_CODES, parsePage, type IssueCode } from "../mod.ts";

interface Case {
    name : string,
    src : string,
    code : IssueCode,
    property? : string,
    dataId? : string,
    path? : string,
    fix? : boolean
}

const R = `style="position:absolute; left:0; top:0; width:100px; height:100px; background-color:#000000`;

const CASES : Array<Case> = [
    // structure
    { name: "unclosed tag", src: wrap(`<div style="background-color:#000">`), code: "parse_error", fix: true },
    { name: "mismatched close", src: wrap(`<p>hi</div>`), code: "parse_error" },
    { name: "stray <", src: wrap(`<p>a < b</p>`), code: "parse_error", fix: true },
    { name: "doctype", src: `<!DOCTYPE html>` + wrap(""), code: "parse_error", fix: true },
    { name: "no page root", src: `<div></div>`, code: "missing_page", fix: true },
    { name: "html/body wrapper", src: `<html><body>${wrap("")}</body></html>`, code: "missing_page" },
    { name: "two roots", src: wrap("") + wrap(""), code: "missing_page" },
    { name: "missing page height", src: `<page width="800"></page>`, code: "missing_attribute", property: "height" },
    { name: "page too large", src: `<page width="8001" height="100"></page>`, code: "out_of_range", property: "width" },
    { name: "page area too large", src: `<page width="8000" height="8000"></page>`, code: "out_of_range" },

    // tags
    { name: "table", src: wrap(`<table><tr><td>x</td></tr></table>`), code: "unsupported_tag", path: "page > table[0]", fix: true },
    { name: "br", src: wrap(`<p>a<br>b</p>`), code: "unsupported_tag", fix: true },
    { name: "script", src: wrap(`<script>alert(1)</script>`), code: "unsupported_tag" },
    { name: "style tag", src: wrap(`<style>p{}</style>`), code: "unsupported_tag" },
    { name: "video", src: wrap(`<video></video>`), code: "unsupported_tag" },
    { name: "section → div", src: wrap(`<section></section>`), code: "unsupported_tag", fix: true },
    { name: "unknown tag", src: wrap(`<blink>x</blink>`), code: "unknown_tag" },

    // attributes
    { name: "class", src: wrap(`<div class="x" style="background-color:#000"></div>`), code: "unsupported_attribute", fix: true },
    { name: "onclick", src: wrap(`<div onclick="x()" style="background-color:#000"></div>`), code: "unsupported_attribute" },
    { name: "svg width attr", src: wrap(`<svg viewBox="0 0 1 1" width="10" style="width:10px"><path d="M0 0L1 1Z"/></svg>`), code: "unsupported_attribute", fix: true },
    { name: "unknown attribute", src: wrap(`<img src="brand:x" title="t" style="width:1px; height:1px">`), code: "unknown_attribute" },
    { name: "img without src", src: wrap(`<img style="width:10px; height:10px">`), code: "missing_attribute" },
    { name: "img without size", src: wrap(`<img src="brand:logo" style="width:10px">`), code: "missing_attribute", fix: true },
    { name: "svg without viewBox", src: wrap(`<svg style="width:10px"><path d="M0 0L1 1Z"/></svg>`), code: "missing_attribute" },
    { name: "a without href", src: wrap(`<p><a>x</a></p>`), code: "missing_attribute" },

    // css: rejected with targeted fixes
    { name: "box-shadow", src: wrap(`<div data-id="r1" ${R}; box-shadow:0 2px 4px #000"></div>`), code: "unsupported_css", property: "box-shadow", dataId: "r1", path: "page > div[0]", fix: true },
    { name: "text-shadow", src: wrap(`<p style="text-shadow:1px 1px #000">x</p>`), code: "unsupported_css", property: "text-shadow", fix: true },
    { name: "filter", src: wrap(`<img src="brand:x" style="width:1px; height:1px; filter:blur(2px)">`), code: "unsupported_css", property: "filter" },
    { name: "z-index", src: wrap(`<div ${R}; z-index:2"></div>`), code: "unsupported_css", property: "z-index", fix: true },
    { name: "overflow", src: wrap(`<div ${R}; overflow:hidden"></div>`), code: "unsupported_css", property: "overflow" },
    { name: "per-side border", src: wrap(`<div ${R}; border-bottom:1px solid #000"></div>`), code: "unsupported_css", property: "border-bottom", fix: true },
    { name: "background shorthand", src: wrap(`<div style="background:#000"></div>`), code: "unsupported_css", property: "background" },
    { name: "text-transform", src: wrap(`<p style="text-transform:uppercase">x</p>`), code: "unsupported_css" },
    { name: "unknown css", src: wrap(`<div ${R}; cursor:pointer"></div>`), code: "unknown_css", property: "cursor" },
    { name: "prop not allowed on tag", src: wrap(`<p><span style="font-size:20px">x</span></p>`), code: "unsupported_css", property: "font-size", fix: true },
    { name: "position on paragraph inside text", src: wrap(`<text><p style="position:absolute">x</p></text>`), code: "unsupported_css", property: "position" },
    { name: "background on text", src: wrap(`<p style="background-color:#000">x</p>`), code: "unsupported_css", property: "background-color", fix: true },
    { name: "height on text", src: wrap(`<text style="height:100px"><p>x</p></text>`), code: "unsupported_css", property: "height", fix: true },
    { name: "list-style-type on p", src: wrap(`<p style="list-style-type:disc">x</p>`), code: "unsupported_css" },

    // css: invalid values
    { name: "gradient", src: wrap(`<div data-id="r1" ${R}; background-image:linear-gradient(#000, #fff)"></div>`), code: "invalid_value", property: "background-image", dataId: "r1", fix: true },
    { name: "named colour", src: wrap(`<div style="background-color:red"></div>`), code: "invalid_value", property: "background-color", fix: true },
    { name: "rgba colour", src: wrap(`<div style="background-color:rgba(0,0,0,.5)"></div>`), code: "invalid_value", fix: true },
    { name: "8-digit hex", src: wrap(`<div style="background-color:#00000080"></div>`), code: "invalid_value", fix: true },
    { name: "unitless length", src: wrap(`<div ${R}; padding:12"></div>`), code: "invalid_value", fix: true },
    { name: "calc()", src: wrap(`<div ${R}; padding:calc(1px + 2px)"></div>`), code: "invalid_value" },
    { name: "!important", src: wrap(`<div ${R} !important"></div>`), code: "invalid_value" },
    { name: "transform scale", src: wrap(`<div ${R}; transform:scale(2)"></div>`), code: "invalid_value", property: "transform", fix: true },
    { name: "position fixed", src: wrap(`<div ${R}; position:fixed"></div>`), code: "invalid_value", property: "position" },
    { name: "display none", src: wrap(`<div ${R}; display:none"></div>`), code: "invalid_value", fix: true },
    { name: "dashed border", src: wrap(`<div ${R}; border:1px dashed #000"></div>`), code: "invalid_value", fix: true },
    { name: "border without colour", src: wrap(`<div ${R}; border:2px solid"></div>`), code: "invalid_value", property: "border" },
    { name: "object-fit contain", src: wrap(`<img src="brand:x" style="width:1px; height:1px; object-fit:contain">`), code: "invalid_value", fix: true },
    { name: "font fallback list", src: wrap(`<p style="font-family:Arial, sans-serif">x</p>`), code: "invalid_value", fix: true },
    { name: "font-size em", src: wrap(`<p style="font-size:2em">x</p>`), code: "invalid_value" },
    { name: "http src", src: wrap(`<img src="http://x.com/a.jpg" style="width:1px; height:1px">`), code: "invalid_value", property: "src", fix: true },
    { name: "data: src", src: wrap(`<img src="data:image/png;base64,AA" style="width:1px; height:1px">`), code: "invalid_value", fix: true },
    { name: "javascript href", src: wrap(`<p><a href="javascript:alert(1)">x</a></p>`), code: "invalid_value", property: "href" },
    { name: "bad path", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px"><path d="M0 0 X 1"/></svg>`), code: "invalid_value", property: "d" },

    // ranges
    { name: "font-size too big", src: wrap(`<p style="font-size:1001px">x</p>`), code: "out_of_range", property: "font-size" },
    { name: "line-height too small", src: wrap(`<p style="line-height:0.2">x</p>`), code: "out_of_range", property: "line-height" },
    { name: "letter-spacing px too wide", src: wrap(`<p style="font-size:10px; letter-spacing:10px">x</p>`), code: "out_of_range", property: "letter-spacing" },
    { name: "opacity > 1", src: wrap(`<div ${R}; opacity:1.5"></div>`), code: "out_of_range", property: "opacity" },
    { name: "border too thick", src: wrap(`<div ${R}; border:101px solid #000"></div>`), code: "out_of_range" },
    { name: "negative width", src: wrap(`<div ${R}; width:-5px"></div>`), code: "out_of_range" },
    { name: "stroke-width > 100", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px"><path d="M0 0L1 1Z" stroke="#000000" stroke-width="101"/></svg>`), code: "out_of_range" },

    // nesting
    { name: "bare text in page", src: wrap(`hello`), code: "invalid_nesting", fix: true },
    { name: "bare text in div", src: wrap(`<div style="background-color:#000">hello</div>`), code: "invalid_nesting", fix: true },
    { name: "span outside p", src: wrap(`<span>x</span>`), code: "invalid_nesting", fix: true },
    { name: "p inside p", src: wrap(`<p>a<p>b</p></p>`), code: "invalid_nesting" },
    { name: "img inside p", src: wrap(`<p><img src="brand:x" style="width:1px; height:1px"></p>`), code: "invalid_nesting" },
    { name: "li outside list", src: wrap(`<li>x</li>`), code: "invalid_nesting" },
    { name: "div inside list", src: wrap(`<ul><div></div></ul>`), code: "invalid_nesting" },
    { name: "path outside svg", src: wrap(`<path d="M0 0Z"/>`), code: "invalid_nesting" },
    { name: "group in group", src: wrap(`<group><group><p>a</p><p>b</p></group><p>c</p></group>`), code: "invalid_nesting", fix: true },
    { name: "group with 1 element", src: wrap(`<group><p>a</p></group>`), code: "invalid_nesting" },
    { name: "empty text", src: wrap(`<text></text>`), code: "invalid_nesting" },
    { name: "nested links", src: wrap(`<p><a href="https://a.com"><a href="https://b.com">x</a></a></p>`), code: "invalid_nesting" },
    { name: "text after nested list", src: wrap(`<ul><li>a<ul><li>b</li></ul>c</li></ul>`), code: "invalid_nesting" },
    { name: "page not root", src: wrap(`<page width="10" height="10"></page>`), code: "invalid_nesting" },

    // ids
    { name: "bad id format", src: wrap(`<div data-id="X Y" style="background-color:#000"></div>`), code: "invalid_id", fix: true },
    { name: "duplicate id", src: wrap(`<div data-id="r1" style="background-color:#000"></div><div data-id="r1" style="background-color:#000"></div>`), code: "duplicate_id", dataId: "r1", path: "page > div[1]" },
    { name: "id on layout-only div", src: wrap(`<div data-id="r1" style="padding:4px"></div>`), code: "invalid_id", dataId: "r1", fix: true },
    { name: "id on paragraph inside text", src: wrap(`<text><p data-id="t1">x</p></text>`), code: "invalid_id" },
    { name: "new embed", src: wrap(`<canva-embed src="https://youtube.com/x" style="width:1px"/>`), code: "missing_attribute", fix: true },
    { name: "new placeholder", src: wrap(`<canva-unsupported style="width:1px"/>`), code: "missing_attribute" },
    { name: "bad data-locked", src: wrap(`<div data-id="r1" data-locked="yes" style="background-color:#000"></div>`), code: "invalid_value" },

    // shape limits
    { name: "31 paths", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px">${`<path d="M0 0L1 1Z"/>`.repeat(31)}</svg>`), code: "shape_limit", fix: true },
    { name: "path > 2KB", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px"><path d="M0 0${" L1 1".repeat(500)}Z"/></svg>`), code: "shape_limit", fix: true },
    { name: "7 fill colours", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px">${[1, 2, 3, 4, 5, 6, 7].map(n => `<path d="M0 0L1 1Z" fill="#00000${n}"/>`).join("")}</svg>`), code: "shape_limit" },
    { name: "svg with no paths", src: wrap(`<svg viewBox="0 0 1 1" style="width:1px"></svg>`), code: "shape_limit" }
];

for(const c of CASES) {
    Deno.test(`rejects: ${c.name}`, () => {
        const errors = fails(c.src);
        const hit = errors.find(e => e.code === c.code && (c.property == null || e.property === c.property));
        assert(hit, `expected ${c.code}${c.property ? ` (${c.property})` : ""}, got:\n${JSON.stringify(errors, null, 2)}`);
        assert(hit.path.length > 0, "issue must name a node path");
        assert(hit.message.length > 0);
        if(c.dataId) assertEquals(hit.dataId, c.dataId);
        if(c.path) assertEquals(hit.path, c.path);
        if(c.fix) assert(hit.fix && hit.fix.length > 0, "issue must suggest a fix");
    });
}

Deno.test("every issue code is exercised somewhere", () => {
    const covered = new Set<IssueCode>(CASES.map(c => c.code));
    // Exercised in base_test.ts / path_test.ts / the cap test below
    for(const c of ["unknown_id", "kind_changed", "page_size_mismatch", "page_locked", "modified_placeholder", "deleted_placeholder", "reordered_placeholder", "modified_locked", "deleted_locked", "modified_embed", "group_unavailable", "converted_path", "too_many_issues"] as const) covered.add(c);
    assertEquals(ISSUE_CODES.filter(c => !covered.has(c)), []);
});

Deno.test("error count is capped with a too_many_issues marker", () => {
    const r = parsePage(wrap(`<div style="background-color:red"></div>`.repeat(60)));
    const errors = r.issues.filter(x => x.severity === "error");
    assertEquals(errors.length, 51);
    assertEquals(errors[50].code, "too_many_issues");
});

Deno.test("all issues are reported in one pass", () => {
    const errors = fails(wrap(`<div style="box-shadow:1px 1px #000; background-color:red"></div><table></table><p style="font-size:2000px">x</p>`));
    assertEquals(new Set(errors.map(e => e.code)), new Set(["unsupported_css", "invalid_value", "unsupported_tag", "out_of_range"]));
});

Deno.test("acceptance: gradient, shadow and table are each rejected naming the node and a fix", () => {
    const errors = fails(wrap(`
        <div data-id="r1" style="background-image:linear-gradient(#000,#fff)"></div>
        <div data-id="r2" style="background-color:#000; box-shadow:0 0 4px #000"></div>
        <table></table>
    `));
    const by = (code : string, id? : string) => errors.find(e => e.code === code && (id == null || e.dataId === id))!;
    assertEquals(by("invalid_value", "r1").path, "page > div[0]");
    assertEquals(by("unsupported_css", "r2").path, "page > div[1]");
    assertEquals(by("unsupported_tag").path, "page > table[0]");
    for(const e of errors) assert(e.fix, `${e.code} has no fix`);
});
