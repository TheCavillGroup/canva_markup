import { serialiseNode, serialisePage } from "../serialise.ts";
import { CAVILL, type Brand } from "../brand.ts";
import type { Node, PageDoc } from "../types.ts";

// There are no element ids in the Design Editing API (removed 2026-10-21), so data-ids come from
// content fingerprints. Untouched elements keep their fingerprint, so they keep their id.

const PREFIX : Record<Node["kind"], string> = { box: "r", image: "i", shape: "s", text: "t", group: "g", embed: "e", unsupported: "u" };
const HISTORY = 5000;

export async function sha(s : string, chars = 16) : Promise<string> {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("").slice(0, chars);
}

function stripNode(n : Node, deep : boolean) : Node {
    const { id: _id, path: _path, ...rest } = n as Node & { measuredHeight? : number };
    const out = { ...rest, path: "" } as Node & { measuredHeight? : number };
    delete out.measuredHeight;
    if((out.kind === "box" || out.kind === "group") && "children" in out) {
        (out as { children : Array<Node> }).children = deep ? out.children.map(c => stripNode(c, true)) : [];
    }
    return out;
}

/** Groups fingerprint on their own box only, so editing a child doesn't churn the group's id. */
export const fingerprint = (n : Node, brand : Brand = CAVILL) : Promise<string> => sha(serialiseNode(stripNode(n, n.kind !== "group"), brand));

/** Covers the ids too: after an app reload the registry starts over, and markup with the old ids must read as stale. */
export function revisionOf(doc : PageDoc, brand : Brand = CAVILL) : Promise<string> {
    const ids : Array<string> = [];
    walk(doc.children, n => { ids.push(n.id ?? ""); });
    return sha(serialisePage({ ...doc, revision: undefined, children: doc.children.map(c => stripNode(c, true)) }, brand) + ids.join(","));
}

/** Pre-order walk over every element node (group children included). */
export function walk(nodes : Array<Node>, fn : (n : Node, parent? : Node) => void, parent? : Node) {
    for(const n of nodes) {
        fn(n, parent);
        if(n.kind === "group" || n.kind === "box") walk(n.children, fn, n);
    }
}

/** Sticky data-ids per page */
export interface IdRegistry {
    /**
     * Assigns ids to every element node in place, reusing ids for known fingerprints.
     * `hint` is the pre-order id list the applier left the page in: when Canva stores something other than
     * what was sent (e.g. a list marker it drops), the fingerprint misses but the element keeps its id.
     */
    assign(pageId : string, doc : PageDoc, hint? : Array<string | undefined>) : Promise<void>;
    /** Records that an element now reads back as `node` under `id` */
    remember(pageId : string, node : Node, id : string) : Promise<void>;
    /** A new id for a created element */
    mint(pageId : string, kind : Node["kind"]) : string;
}

/** Sticky data-ids per page: an element keeps its id as long as its fingerprint (or the applier's hint) matches. In memory only. */
export function createIdRegistry(brand : Brand = CAVILL) : IdRegistry {
    const pages = new Map<string, { byFp : Map<string, Array<string>>, counter : number }>();

    const page = (pageId : string) => {
        let p = pages.get(pageId);
        if(!p) {
            p = { byFp: new Map(), counter: 0 };
            pages.set(pageId, p);
        }
        return p;
    };

    return {
        /**
         * Assigns ids to every element node in place, reusing ids for known fingerprints.
         * `hint` is the pre-order id list the applier left the page in: when Canva stores something other than
         * what was sent (e.g. a list marker it drops), the fingerprint misses but the element keeps its id.
         */
        async assign(pageId : string, doc : PageDoc, hint? : Array<string | undefined>) {
            const p = page(pageId);
            const nodes : Array<Node> = [];
            walk(doc.children, n => nodes.push(n));
            const fps = await Promise.all(nodes.map(n => fingerprint(n, brand)));
            const used = new Set<string>();
            const seen = new Map<string, Array<string>>();
            // Only trust the hint if nothing was added or removed since the applier's session
            if(hint && hint.length !== nodes.length) hint = undefined;
            const hinted = new Set(hint?.filter(x => x != null));

            nodes.forEach((n, i) => {
                const fp = fps[i]!;
                const known = (p.byFp.get(fp) ?? []).find(x => !used.has(x) && (!hinted.has(x) || hint![i] === x));
                const h = hint?.[i];
                const id = known ?? (h && !used.has(h) ? h : undefined) ?? `${PREFIX[n.kind]}${++p.counter}`;
                used.add(id);
                n.id = id;
                seen.set(fp, [...(seen.get(fp) ?? []), id]);
            });

            // Old fingerprints are kept (most recent first), so an undo in Canva brings the old ids back
            for(const [fp, ids] of seen) p.byFp.set(fp, [...ids, ...(p.byFp.get(fp) ?? []).filter(x => !ids.includes(x))]);
            while(p.byFp.size > HISTORY) p.byFp.delete(p.byFp.keys().next().value!);
        },

        async remember(pageId : string, node : Node, id : string) {
            const p = page(pageId);
            const fp = await fingerprint(node, brand);
            p.byFp.set(fp, [id, ...(p.byFp.get(fp) ?? []).filter(x => x !== id)]);
            const n = Number(id.replace(/^[a-z]+/, ""));
            if(Number.isFinite(n) && n > p.counter) p.counter = n;
        },

        mint(pageId : string, kind : Node["kind"]) : string {
            return `${PREFIX[kind]}${++page(pageId).counter}`;
        }
    };
}

