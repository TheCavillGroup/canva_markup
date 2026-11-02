// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from "@std/assert";
import { CAVILL, parsePage, serialisePage, type TextNode } from "../../mod.ts";
import type { ElementResult, ApplyWarning } from "../../canva/types.ts";
import { conflictsWithLive, executeApply, type Settled } from "../../canva/apply.ts";
import { roundedPath } from "../../canva/convert.ts";
import { differences } from "../../canva/compare.ts";
import { ReconcileError } from "../../canva/errors.ts";
import { createFontRegistry } from "../../canva/fonts.ts";
import { createIdRegistry, fingerprint } from "../../canva/ids.ts";
import { plannedText, readLivePage, snapshotNode } from "../../canva/read.ts";
import { absolutePlan, fakePage, noFonts } from "./fake.ts";

const BODY = { fontRef: "YADK4LSvvyE:0", fontSize: 16, color: "#000000", lineHeightEm: 1.4 };

const rect = (left : number, top : number, color : string, extra : object = {}) => ({ type: "rect", left, top, width: 100, height: 50, fill: { colorContainer: { color } }, ...extra });
const text = (left : number, top : number, s : string) => ({ type: "text", left, top, width: 300, text: { regions: [{ text: s, formatting: BODY }] } });

/** A fake page plus a read of it, and an apply that runs the real diff against it */
async function setup(elements : Array<any>, opts : Parameters<typeof fakePage>[1] = {}) {
    const fake = fakePage(elements, opts);
    const fonts = createFontRegistry(CAVILL, noFonts);
    const ids = createIdRegistry();
    let live = await readLivePage(fake.page, fonts, ids);

    async function apply(markup : string) {
        const parsed = parsePage(markup);
        assertEquals(parsed.issues.filter(x => x.severity === "error"), []);
        const doc = parsed.doc!;
        const fontRefs = new Map<string, any>();
        for(const n of doc.children) if(n.kind === "text") for(const p of n.paragraphs) fontRefs.set(p.format.fontFamily, await fonts.resolve(p.format.fontFamily));
        const results : Array<ElementResult> = [], warnings : Array<ApplyWarning> = [];
        const settled : Settled = { expected: new Map() };
        const changed = await executeApply(fake.page, fake.helpers, live, absolutePlan(doc), doc, {
            fontRefs, img: src => `IMG-${src.replace(/^canva:/, "")}` as any, results, warnings, deps: { fonts, ids }, settled
        });
        live = await readLivePage(fake.page, fonts, ids, settled.hint);
        return { changed, results, warnings, after: live.doc, markup: serialisePage(live.doc) };
    }

    return { fake, fonts, ids, get live() { return live; }, markup: () => serialisePage(live.doc), apply };
}

const actions = (rs : Array<ElementResult>) => rs.map(r => `${r.action}:${r.id ?? r.newId}`).sort();

Deno.test("read: elements get sticky ids and the page a revision", async () => {
    const s = await setup([rect(10, 10, "#86D0CC"), text(10, 100, "Hello")]);
    const doc = s.live.doc;
    assertEquals(doc.children.map(n => n.id), ["r1", "t2"]);
    assertEquals(doc.children[0]!.style["background-color"], "#86d0cc");
    assertEquals((doc.children[1] as TextNode).paragraphs[0]!.format.fontFamily, "brand-body");
    // Reading again changes nothing
    const again = await readLivePage(s.fake.page, s.fonts, s.ids);
    assertEquals(serialisePage(again.doc), serialisePage(doc));
});

Deno.test("apply: an unchanged page is a no-op", async () => {
    const s = await setup([rect(10, 10, "#000000"), text(10, 100, "Hello")]);
    const before = s.markup();
    const r = await s.apply(before);
    assertEquals(r.changed, false);
    assertEquals(actions(r.results), ["unchanged:r1", "unchanged:t2"]);
    assertEquals(r.markup, before);
});

Deno.test("apply: colour, position and text change in place and keep their ids", async () => {
    const s = await setup([rect(10, 10, "#000000"), text(10, 100, "Hello")]);
    const live0 = s.fake.els().slice();
    const m = s.markup()
        .replace("background-color:#000000", "background-color:brand-text-blue")
        .replace("left:10px; top:100px", "left:20px; top:120px")
        .replace(">Hello<", ">Goodbye<");
    const r = await s.apply(m);
    assert(r.changed);
    assertEquals(actions(r.results), ["updated:r1", "updated:t2"]);
    // Same live objects: edited, not recreated
    assertEquals(s.fake.els(), live0);
    assertEquals(r.after.children.map(n => n.id), ["r1", "t2"]);
    assert(r.markup.includes("background-color:#86d0cc"));
    assert(r.markup.includes(">Goodbye<"));
    assertEquals(s.fake.els()[1].left, 20);
});

Deno.test("apply: a resize recreates the element under the same id, with a warning", async () => {
    const s = await setup([rect(10, 10, "#000000")]);
    const old = s.fake.els()[0];
    const r = await s.apply(s.markup().replace("width:100px", "width:140px"));
    assertEquals(r.results[0]!.action, "replaced");
    assert(r.results[0]!.warning!.includes("its size changed"));
    assert(s.fake.els()[0] !== old);
    assertEquals(s.fake.els()[0].width, 140);
    assertEquals(r.after.children[0]!.id, "r1");
});

Deno.test("apply: delete, create and reorder in one pass", async () => {
    const s = await setup([rect(0, 0, "#111111"), rect(0, 100, "#222222"), rect(0, 200, "#333333")]);
    const doc = parsePage(s.markup()).doc!;
    // drop r2, move r3 to the bottom, add a new box on top
    const [r1, , r3] = doc.children;
    const m = serialisePage({ ...doc, children: [r3!, r1!] }).replace("</page>", `  <div style="position:absolute; left:0px; top:300px; width:50px; height:50px; background-color:#444444"></div>\n</page>`);
    const r = await s.apply(m);
    assertEquals(actions(r.results), ["created:r4", "deleted:r2", "unchanged:r1", "unchanged:r3"]);
    assertEquals(s.fake.els().map(e => e.fill.colorContainer.ref.color.toLowerCase()), ["#333333", "#111111", "#444444"]);
    assertEquals(r.after.children.map(n => n.id), ["r3", "r1", "r4"]);
});

Deno.test("apply: ids survive a second round of edits", async () => {
    const s = await setup([rect(0, 0, "#111111"), text(0, 100, "One")]);
    await s.apply(s.markup().replace(">One<", ">Two<"));
    const r = await s.apply(s.markup().replace(">Two<", ">Three<").replace("#111111", "#121212"));
    assertEquals(actions(r.results), ["updated:r1", "updated:t2"]);
    assertEquals(r.after.children.map(n => n.id), ["r1", "t2"]);
});

Deno.test("apply: removing a <group> wrapper ungroups, keeping page positions", async () => {
    const s = await setup([{ type: "group", left: 100, top: 100, width: 200, height: 100, children: [rect(0, 0, "#111111"), { ...rect(100, 50, "#222222") }] }]);
    const doc = parsePage(s.markup()).doc!;
    const g = doc.children[0]!;
    if(g.kind !== "group") throw new Error("expected group");
    // Children become top-level, converted to page coordinates
    const kids = g.children.map(c => ({ ...c, style: { ...c.style, left: `${parseFloat(c.style.left!) + 100}px`, top: `${parseFloat(c.style.top!) + 100}px` } }));
    const r = await s.apply(serialisePage({ ...doc, children: kids }));
    assert(r.changed);
    assertEquals(s.fake.els().map(e => e.type), ["rect", "rect"]);
    assertEquals(s.fake.els().map(e => [e.left, e.top]), [[100, 100], [200, 150]]);
    assertEquals(r.after.children.map(n => n.id), [g.children[0]!.id, g.children[1]!.id]);
});

Deno.test("apply: a group whose members change is refused (new groups can't be created)", async () => {
    const s = await setup([{ type: "group", left: 100, top: 100, width: 200, height: 100, children: [rect(0, 0, "#111111"), rect(100, 50, "#222222")] }, rect(0, 400, "#333333")]);
    const doc = parsePage(s.markup()).doc!;
    const [g, loose] = doc.children;
    if(g?.kind !== "group") throw new Error("expected group");
    const m = serialisePage({ ...doc, children: [{ ...g, children: [...g.children, { ...loose!, style: { ...loose!.style, top: "0px" } }] }] });
    const err = await assertRejects(() => s.apply(m), ReconcileError);
    assertEquals(err.code, "not_supported");
});

Deno.test("apply: locked elements and placeholders are left alone", async () => {
    const s = await setup([rect(0, 0, "#111111", { locked: true }), { type: "unsupported", left: 0, top: 100, width: 50, height: 50 }, rect(0, 200, "#222222")]);
    const before = s.fake.els().slice();
    const r = await s.apply(s.markup().replace("#222222", "#333333"));
    assertEquals(actions(r.results), ["unchanged:r1", "unchanged:u2", "updated:r3"]);
    assertEquals(s.fake.els(), before);
    assertEquals(s.fake.els()[0].fill.colorContainer.ref.color, "#111111");
});

Deno.test("apply: the page background changes in place", async () => {
    const s = await setup([rect(0, 0, "#111111")], { background: "#ffffff" });
    const r = await s.apply(s.markup().replace("background-color:#ffffff", "background-color:#eaeaea"));
    assert(r.changed);
    assertEquals(r.after.style["background-color"], "#eaeaea");
});

Deno.test("conflictsWithLive: ids, placeholders and page size are checked against the live page", async () => {
    const s = await setup([rect(0, 0, "#111111"), { type: "unsupported", left: 0, top: 100, width: 50, height: 50 }]);
    const doc = parsePage(s.markup()).doc!;
    assertEquals(conflictsWithLive(s.live.doc, doc, CAVILL), []);
    const bad = parsePage(serialisePage({ ...doc, children: [{ ...doc.children[0]!, id: "r9" }] })).doc!;
    assertEquals(conflictsWithLive(s.live.doc, bad, CAVILL).map(x => x.code).sort(), ["deleted_placeholder", "unknown_id"]);
    const resized = { ...doc, width: 900 };
    assertEquals(conflictsWithLive(s.live.doc, resized, CAVILL).map(x => x.code), ["page_size_mismatch"]);
});

Deno.test("differences: names what Canva stored differently", () => {
    const want = parsePage(`<page width="800" height="600"><text data-id="t1" style="position:absolute; left:0px; top:0px; width:100px"><ul style="list-style-type:unchecked"><li>a</li></ul></text></page>`).doc!.children[0]!;
    const got = parsePage(`<page width="800" height="600"><text data-id="t1" style="position:absolute; left:0px; top:0.004px; width:100px"><ul><li>a</li></ul></text></page>`).doc!.children[0]!;
    assertEquals(differences(want, got), ["paragraph 1 list-style-type unchecked → disc"]);
});

// --- ported from the bridge app's jest suite ---

const validPath = (d : string) => parsePage(`<page width="100" height="100"><svg viewBox="0 0 100 100" style="width:100px"><path d="${d}" /></svg></page>`).doc != null;

Deno.test("roundedPath draws uniform px corners", () => {
    const d = roundedPath(200, 100, ["10px", "10px", "10px", "10px"]);
    assertEquals(d, "M10 0 H190 A10 10 0 0 1 200 10 V90 A10 10 0 0 1 190 100 H10 A10 10 0 0 1 0 90 V10 A10 10 0 0 1 10 0 Z");
    assert(validPath(d));
});

Deno.test("roundedPath: 50% on a square is a circle", () => {
    assertEquals(roundedPath(100, 100, ["50%", "50%", "50%", "50%"]), "M50 0 H50 A50 50 0 0 1 100 50 V50 A50 50 0 0 1 50 100 H50 A50 50 0 0 1 0 50 V50 A50 50 0 0 1 50 0 Z");
});

Deno.test("roundedPath scales oversized radii down to fit (CSS rules)", () => {
    assert(roundedPath(100, 40, ["40px", "40px", "40px", "40px"]).startsWith("M20 0 H80 A20 20"));
});

Deno.test("roundedPath: square corners become straight lines", () => {
    assert(roundedPath(100, 50, ["20px", "0px", "20px", "0px"]).includes(" L100 0"));
});

Deno.test("snapshotNode reads elements on pages with fractional sizes", () => {
    const el = {
        type: "rect", left: 48, top: 455.41, width: 64, height: 3, rotation: 0, transparency: 0, locked: false,
        fill: { colorContainer: { ref: { type: "solid", color: "#86D0CC" } }, mediaContainer: { ref: undefined } },
        stroke: { weight: 0 }
    };
    const n = snapshotNode(el as any, new Map(), 559.3700787401575, 793.7007874015748);
    assertEquals(n.kind, "box");
    assertEquals(n.style["background-color"], "#86d0cc");
});

Deno.test("plannedText fingerprints like the synced element reads back", async () => {
    const fmt = { fontSize: 14, color: "#3C3E3F", lineHeightEm: 1.55, listLevel: 1, listMarker: "disc" };
    const regions = [{ text: "sound structure\n", formatting: fmt }, { text: "working gas", formatting: fmt }];
    const el = {
        type: "text", left: 44, top: 166.73, width: 471, height: 37.1, rotation: 0, transparency: 0, locked: false,
        text: { readTextRegions: () => regions }
    };
    const doc = parsePage(`<page width="559" height="794"><text style="position:absolute; left:44px; top:166.73px; width:471px"><ul style="font-size:14px; color:#3c3e3f; line-height:1.55"><li>sound structure</li><li>working gas</li></ul></text></page>`).doc!;
    const planned = plannedText(doc.children[0] as TextNode, el as any, 559.37, 793.7);
    assertEquals(await fingerprint(planned), await fingerprint(snapshotNode(el as any, new Map(), 559.37, 793.7)));
});
