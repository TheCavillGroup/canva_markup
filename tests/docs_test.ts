import { assert, assertEquals } from "@std/assert";
import { CAVILL, createMarkup, ISSUE_CODES, parsePage, renderSpec } from "../mod.ts";

// Every complete <page> example in docs/MARKUP.md must validate, so the spec can't drift from the code.
// Line endings are normalised: checkouts with core.autocrlf get CRLF.
const raw = (await Deno.readTextFile(new URL("../docs/MARKUP.md", import.meta.url))).replace(/\r\n/g, "\n");
const spec = renderSpec(raw, CAVILL);
const examples = [...spec.matchAll(/```html\n([\s\S]*?)```/g)].map(m => m[1].trim()).filter(x => x.startsWith("<page") && x.endsWith("</page>"));

Deno.test("MARKUP.md has page examples", () => {
    assert(examples.length >= 3, `found ${examples.length}`);
});

examples.forEach((src, i) => {
    Deno.test(`MARKUP.md example ${i + 1} validates`, () => {
        const r = parsePage(src);
        assertEquals(r.issues.filter(x => x.severity === "error"), []);
    });
});

Deno.test("MARKUP.md error example matches a real validator issue", () => {
    const r = parsePage(`<page width="800" height="600"><div style="background-color:#000"></div><div data-id="r2" style="background-color:#000; box-shadow:0 0 4px #000"></div></page>`);
    const issue = r.issues.find(x => x.code === "unsupported_css")!;
    const documented = JSON.parse(/```json\n([\s\S]*?)```/.exec(spec)![1]);
    assertEquals(issue, documented);
});

Deno.test("MARKUP.md documents every issue code", () => {
    const missing = ISSUE_CODES.filter(x => !spec.includes(`\`${x}\``));
    assertEquals(missing, []);
});

Deno.test("MARKUP.md placeholders are all filled", () => {
    assertEquals(spec.match(/<!-- brand:[a-z-]+ -->/g), null);
    assert(spec.includes("| `brand-headline` | Safira March (Cavill Group headings). Weights: thin, medium |"));
    assert(spec.includes("| `brand-text-blue` | `#86d0cc` |"));
    assert(spec.includes("`font-family: brand-body`"));
});

Deno.test("MARKUP.md renders for another brand", () => {
    const m = createMarkup({ fonts: {}, colors: {}, defaultFont: "Lato", headingFont: "Montserrat" });
    const out = m.renderSpec(raw);
    assert(!out.includes("brand-headline` |"));
    assert(out.includes("`font-family: Lato`"));
    assert(out.includes("| (none) | |"));
});
