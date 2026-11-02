import type { Node, Paragraph } from "../types.ts";

export const EPS = 0.011;
export const near = (a : number, b : number) => Math.abs(a - b) < EPS;
// Browser layout rounds to 1/64px, so a laid-out stack can come out a few hundredths off: recreating a box for that would lose its Canva-only effects. Text widths stay exact (they decide line breaks)
const SIZE_EPS = 0.1;
export const sameSize = (a : number, b : number) => Math.abs(a - b) < SIZE_EPS;

const FORMAT_CSS : Record<keyof Paragraph["format"], string> = { fontFamily: "font-family", fontSize: "font-size", textAlign: "text-align", lineHeight: "line-height", letterSpacing: "letter-spacing", listLevel: "list level", listMarker: "list-style-type" };

/** What Canva changed between the state the applier staged and the re-read. Groups are skipped: Canva re-fits them to their members. */
export function differences(want : Node, got : Node) : Array<string> {
    if(want.kind === "group") return [];
    if(want.kind !== got.kind) return [`became a ${got.kind}`];
    const out : Array<string> = [];
    for(const k of new Set([...Object.keys(want.style), ...Object.keys(got.style)])) {
        const a = want.style[k], b = got.style[k];
        if(a === b) continue;
        if(a?.endsWith("px") && b?.endsWith("px") && near(parseFloat(a), parseFloat(b))) continue;
        out.push(`${k} ${a ?? "(none)"} → ${b ?? "(none)"}`);
    }
    if(want.kind === "text" && got.kind === "text") {
        if(want.paragraphs.length !== got.paragraphs.length) {
            out.push(`${want.paragraphs.length} paragraphs → ${got.paragraphs.length}`);
        } else {
            want.paragraphs.forEach((p, i) => {
                const q = got.paragraphs[i]!;
                for(const k in FORMAT_CSS) {
                    const key = k as keyof Paragraph["format"];
                    if(p.format[key] !== q.format[key]) out.push(`paragraph ${i + 1} ${FORMAT_CSS[key]} ${p.format[key]} → ${q.format[key]}`);
                }
                if(p.runs.map(r => r.text).join("") !== q.runs.map(r => r.text).join("")) out.push(`paragraph ${i + 1} text`);
            });
        }
    }
    return out;
}
