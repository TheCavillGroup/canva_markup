import { assert, assertEquals } from "@std/assert";
import { ok } from "./helpers.ts";
import { checkAgainstBase } from "../mod.ts";
import { flattenIds } from "../base.ts";

const BASE = `<page width="800" height="600" data-page-id="PB1" data-revision="aaaa">
  <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:10px; top:10px; width:50px; height:4px" />
  <group data-id="g1" style="position:absolute; left:200px; top:200px; width:200px; height:100px">
    <text data-id="t1" style="position:absolute; left:0px; top:0px; width:200px">
      <p>Caption</p>
    </text>
    <canva-unsupported data-id="u2" style="position:absolute; left:0px; top:50px; width:200px; height:2px" />
  </group>
  <div data-id="r2" data-locked="true" style="position:absolute; left:500px; top:0px; width:100px; height:100px; background-color:#ff0000"></div>
  <canva-embed data-id="e1" src="https://www.youtube.com/watch?v=x" style="position:absolute; left:0px; top:300px; width:560px; height:315px" />
</page>`;

const base = ok(BASE);
const check = (next : string) => checkAgainstBase(base, ok(next));
const codes = (next : string) => check(next).map(x => x.code);

Deno.test("untouched page passes", () => {
    assertEquals(check(BASE), []);
});

Deno.test("allowed edits: move/restyle r1, delete r1, add new element, move embed, delete embed", () => {
    assertEquals(codes(BASE.replace("left:0px; top:0px; width:100px", "left:20px; top:20px; width:300px").replace("#000000", "#123456")), []);
    assertEquals(codes(BASE.replace(/  <div data-id="r1".*\n/, "")), []);
    assertEquals(codes(BASE.replace("</page>", `  <div style="width:10px; height:10px; background-color:#00ff00"></div>\n</page>`)), []);
    assertEquals(codes(BASE.replace("left:0px; top:300px; width:560px", "left:100px; top:280px; width:560px").replace("height:315px\" />", "height:315px; transform:rotate(10deg); opacity:0.5\" />")), []);
    assertEquals(codes(BASE.replace(/  <canva-embed.*\n/, "")), []);
});

Deno.test("unknown id", () => {
    const issues = check(BASE.replace(`data-id="r1"`, `data-id="r9"`));
    assertEquals(issues[0].code, "unknown_id");
    assertEquals(issues[0].dataId, "r9");
    assert(issues[0].fix);
});

Deno.test("kind changed", () => {
    const next = BASE.replace(/<div data-id="r1"[^>]*><\/div>/, `<img data-id="r1" src="brand:logo" style="width:10px; height:10px" />`);
    assertEquals(codes(next), ["kind_changed"]);
});

Deno.test("page size mismatch", () => {
    assertEquals(codes(BASE.replace(`width="800"`, `width="801"`)), ["page_size_mismatch"]);
});

Deno.test("page locked", () => {
    const lockedBase = ok(BASE.replace(`data-revision="aaaa"`, `data-revision="aaaa" data-locked="true"`));
    const issues = checkAgainstBase(lockedBase, ok(BASE.replace(`data-revision="aaaa"`, `data-revision="aaaa" data-locked="true"`).replace("#000000", "#111111")));
    assertEquals(issues.map(x => x.code), ["page_locked"]);
    assertEquals(checkAgainstBase(lockedBase, lockedBase), []);
});

Deno.test("placeholder deleted / modified / moved out of its group / reordered", () => {
    assertEquals(codes(BASE.replace(/  <canva-unsupported data-id="u1".*\n/, "")), ["deleted_placeholder"]);
    assertEquals(codes(BASE.replace("left:10px; top:10px; width:50px", "left:11px; top:10px; width:50px")), ["modified_placeholder"]);

    // Keep the group valid (2+ elements) so only the placeholder move is under test
    const out = BASE.replace(/    <canva-unsupported data-id="u2".*\n/, `    <p>Second</p>\n`).replace("</page>", `  <canva-unsupported data-id="u2" style="position:absolute; left:0px; top:50px; width:200px; height:2px" />\n</page>`);
    assert(codes(out).includes("modified_placeholder"));

    // u1 above u2, then swapped (u2 stays in its group: move u1 to the end of the page instead)
    const swapped = BASE.replace(/  <canva-unsupported data-id="u1".*\n/, "").replace("</page>", `  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:10px; top:10px; width:50px; height:4px" />\n</page>`);
    assertEquals(codes(swapped), ["reordered_placeholder"]);

    // Other elements moving around placeholders is fine
    const r1Last = BASE.replace(/  <div data-id="r1".*\n/, "").replace("</page>", `  <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>\n</page>`);
    assertEquals(codes(r1Last), []);
});

Deno.test("locked element deleted / modified", () => {
    assertEquals(codes(BASE.replace(/  <div data-id="r2".*\n/, "")), ["deleted_locked"]);
    assertEquals(codes(BASE.replace("#ff0000", "#00ff00")), ["modified_locked"]);
});

Deno.test("embed resized or re-pointed", () => {
    assertEquals(codes(BASE.replace("width:560px", "width:600px")), ["modified_embed"]);
    assertEquals(codes(BASE.replace("watch?v=x", "watch?v=y")), ["modified_embed"]);
});

Deno.test("flattenIds gives z-order and group membership", () => {
    const f = flattenIds(base);
    assertEquals([...f.keys()], ["r1", "u1", "g1", "t1", "u2", "r2", "e1"]);
    assertEquals(f.get("t1")!.group, "g1");
    assertEquals(f.get("u1")!.group, undefined);
});

const GROUPED = `<page width="800" height="600">
  <group data-id="g1" style="position:absolute; left:10px; top:10px; width:200px; height:100px">
    <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>
    <text data-id="t1" style="position:absolute; left:100px; top:0px; width:100px">
      <p>Caption</p>
    </text>
  </group>
  <div data-id="r2" style="position:absolute; left:400px; top:0px; width:10px; height:10px; background-color:#ff0000"></div>
</page>`;

Deno.test("groups: new groups and membership changes are unavailable; moves, in-place edits and ungrouping are fine", () => {
    const g = ok(GROUPED);
    const codesFor = (next : string) => checkAgainstBase(g, ok(next)).map(x => x.code);

    // Move the group and edit a child in place
    assertEquals(codesFor(GROUPED.replace("left:10px; top:10px", "left:50px; top:60px").replace(">Caption<", ">New caption<")), []);

    // Ungroup: remove the wrapper, keep the members
    const ungrouped = GROUPED.replace(/  <group[^>]*>\n/, "").replace("  </group>\n", "");
    assertEquals(codesFor(ungrouped), []);

    // New group
    const fresh = GROUPED.replace("</page>", `  <group><p>a</p><p>b</p></group>\n</page>`);
    const issues = checkAgainstBase(g, ok(fresh));
    assertEquals(issues.map(x => x.code), ["group_unavailable"]);
    assert(issues[0].fix);

    // Membership changes: add a member, move one out
    assertEquals(codesFor(GROUPED.replace("  </group>", `    <p>Extra</p>\n  </group>`)), ["group_unavailable"]);
    const r2In = GROUPED.replace(/  <div data-id="r2".*\n/, "").replace("  </group>", `    <div data-id="r2" style="position:absolute; left:0px; top:0px; width:10px; height:10px; background-color:#ff0000"></div>\n  </group>`);
    assertEquals(codesFor(r2In), ["group_unavailable"]);
});
