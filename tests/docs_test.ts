import { assert, assertEquals } from "@std/assert";
import { parsePage } from "../mod.ts";

// Every complete <page> example in docs/MARKUP.md must validate, so the spec can't drift from the code.
// Line endings are normalised: checkouts with core.autocrlf get CRLF.
const spec = (await Deno.readTextFile(new URL("../../../docs/MARKUP.md", import.meta.url))).replace(/\r\n/g, "\n");
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
