import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { toAbsoluteCubic, tokenisePath } from "../parse/path.ts";

type Pt = [number, number];

const quad = (p0 : Pt, q : Pt, p1 : Pt, t : number) : Pt => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * q[0] + t * t * p1[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * q[1] + t * t * p1[1]
];
const cubic = (p0 : Pt, c1 : Pt, c2 : Pt, p1 : Pt, t : number) : Pt => [
    (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * c1[0] + 3 * (1 - t) * t * t * c2[0] + t ** 3 * p1[0],
    (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * c1[1] + 3 * (1 - t) * t * t * c2[1] + t ** 3 * p1[1]
];

function cubics(d : string) : Array<[Pt, Pt, Pt, Pt]> {
    const segs = tokenisePath(d);
    if(typeof segs === "string") throw new Error(segs);
    const out : Array<[Pt, Pt, Pt, Pt]> = [];
    let cur : Pt = [0, 0];
    for(const s of segs) {
        if(s.cmd === "M") cur = [s.args[0], s.args[1]];
        if(s.cmd === "C") {
            out.push([cur, [s.args[0], s.args[1]], [s.args[2], s.args[3]], [s.args[4], s.args[5]]]);
            cur = [s.args[4], s.args[5]];
        }
    }
    return out;
}

Deno.test("Q converts to an identical cubic", () => {
    const segs = tokenisePath("M0 100 Q 50 0 100 100");
    if(typeof segs === "string") throw new Error(segs);
    const [c] = cubics(toAbsoluteCubic(segs));
    for(const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const a = quad([0, 100], [50, 0], [100, 100], t), b = cubic(...c, t);
        assertAlmostEquals(a[0], b[0], 1e-2);
        assertAlmostEquals(a[1], b[1], 1e-2);
    }
});

Deno.test("T reflects the previous Q control point; relative forms are resolved", () => {
    const segs = tokenisePath("m0 50 q25 -50 50 0 t50 0");
    if(typeof segs === "string") throw new Error(segs);
    const [, second] = cubics(toAbsoluteCubic(segs));
    // Reflected control of (25,0) about (50,50) is (75,100)
    for(const t of [0.2, 0.5, 0.8]) {
        const a = quad([50, 50], [75, 100], [100, 50], t), b = cubic(...second, t);
        assertAlmostEquals(a[0], b[0], 1e-2);
        assertAlmostEquals(a[1], b[1], 1e-2);
    }
});

Deno.test("S after a converted path keeps its explicit control", () => {
    const segs = tokenisePath("M0 0 C 0 10 10 10 10 0 S 20 -10 20 0 Q 25 5 30 0");
    if(typeof segs === "string") throw new Error(segs);
    const out = toAbsoluteCubic(segs);
    assert(!/[SQT]/.test(out));
    const cs = cubics(out);
    assertEquals(cs[1][1], [10, -10]);
});

Deno.test("compact arc flags and implicit lineto after M", () => {
    const segs = tokenisePath("M10 10 20 20a5 5 0 0110 10z");
    if(typeof segs === "string") throw new Error(segs);
    assertEquals(segs.map(s => s.cmd), ["M", "L", "a", "z"]);
    assertEquals(segs[2].args, [5, 5, 0, 0, 1, 10, 10]);
});

Deno.test("invalid paths are reported", () => {
    assertEquals(typeof tokenisePath("L 0 0"), "string");
    assertEquals(typeof tokenisePath("M 0"), "string");
    assertEquals(typeof tokenisePath("M 0 0 K 1"), "string");
    assertEquals(typeof tokenisePath(""), "string");
});
