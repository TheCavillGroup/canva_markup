import { assert } from "@std/assert";
import { parsePage } from "../mod.ts";
import type { Issue, Node, PageDoc, ParseResult } from "../mod.ts";

export const wrap = (inner : string, attrs = "") => `<page width="800" height="600"${attrs}>${inner}</page>`;

export function ok(src : string) : PageDoc {
    const r = parsePage(src);
    const errors = r.issues.filter(x => x.severity === "error");
    assert(r.doc && errors.length === 0, `expected valid markup, got:\n${JSON.stringify(errors, null, 2)}`);
    return r.doc!;
}

export function fails(src : string) : Array<Issue> {
    const r : ParseResult = parsePage(src);
    assert(!r.doc, "expected markup to be rejected");
    return r.issues.filter(x => x.severity === "error");
}

/** Doc without source paths, for structural equality across serialise/parse. */
export function strip(doc : PageDoc) : unknown {
    const node = (n : Node) : unknown => {
        const { path: _, ...rest } = n as Node & Record<string, unknown>;
        if("children" in rest) return { ...rest, children: (rest.children as Array<Node>).map(node) };
        return rest;
    };
    return { ...doc, children: doc.children.map(node) };
}
