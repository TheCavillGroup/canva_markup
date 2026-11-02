import { assert } from "@std/assert";

// Every ```ts block in docs/EXAMPLES.md runs, so the pages it builds have to validate (each block throws if not).
// The Canva runtime doesn't load outside Canva: /canva points at errors.ts, the only part the blocks call
// outside their Canva functions. Types are checked by `deno task check` (--doc-only).

const src = (await Deno.readTextFile(new URL("../docs/EXAMPLES.md", import.meta.url))).replace(/\r\n/g, "\n");
const blocks = [...src.matchAll(/```ts\n([\s\S]*?)```/g)].map(m => m[1]);

const MOD = new URL("../mod.ts", import.meta.url).href;
const ERRORS = new URL("../canva/errors.ts", import.meta.url).href;

Deno.test("EXAMPLES.md has examples", () => {
    assert(blocks.length >= 3, `found ${blocks.length}`);
});

blocks.forEach((block, i) => {
    Deno.test(`EXAMPLES.md example ${i + 1} runs`, async () => {
        const code = block
            .replaceAll("\"@thecavillgroup/canva-markup/canva\"", JSON.stringify(ERRORS))
            .replaceAll("\"@thecavillgroup/canva-markup\"", JSON.stringify(MOD));
        const ogLog = console.log;
        console.log = () => {};
        try {
            await import(`data:application/typescript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`);
        } finally {
            console.log = ogLog;
        }
    });
});
