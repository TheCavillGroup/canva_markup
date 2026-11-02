import { serialiseNode, serialisePage } from "./serialise.ts";
import type { Issue, Node, PageDoc } from "./types.ts";
import { CAVILL, type Brand } from "./brand.ts";

export interface FlatNode {
    node : Node,
    /** id of the enclosing <group>, if any */
    group? : string,
    /** pre-order index = back-to-front stacking order */
    order : number
}

/** Every node with a data-id, in document (= z) order. Layout-only boxes are walked through. */
export function flattenIds(doc : PageDoc) : Map<string, FlatNode> {
    const out = new Map<string, FlatNode>();
    let order = 0;
    const walk = (nodes : Array<Node>, group? : string) => {
        for(const n of nodes) {
            if(n.id) out.set(n.id, { node: n, group, order: order++ });
            if(n.kind === "box") walk(n.children, group);
            if(n.kind === "group") walk(n.children, n.id ?? group);
        }
    };
    walk(doc.children);
    return out;
}

/** Sorted member ids of a group (layout-only boxes are walked through; new members show as "(new)"). */
function memberIds(nodes : Array<Node>) : string {
    const out : Array<string> = [];
    const walk = (ns : Array<Node>) => {
        for(const c of ns) {
            if(c.kind === "box" && !c.id) walk(c.children);
            else out.push(c.id ?? "(new)");
        }
    };
    walk(nodes);
    return out.sort().join(",");
}

const KIND_NAMES : Record<Node["kind"], string> = { box: "<div>", text: "<text>", image: "<img>", shape: "<svg>", group: "<group>", embed: "<canva-embed>", unsupported: "<canva-unsupported>" };

/**
 * Rules that need the page Claude read (the base): ids must come from it, and placeholders,
 * locked elements and embed sizes must survive untouched.
 */
export function checkAgainstBase(base : PageDoc, next : PageDoc, brand : Brand = CAVILL) : Array<Issue> {
    const issues : Array<Issue> = [];
    const err = (code : Issue["code"], path : string, message : string, extra : Partial<Issue> = {}) => issues.push({ severity: "error", code, path, message, ...extra });

    if(base.width !== next.width || base.height !== next.height) {
        err("page_size_mismatch", "page", `Page is ${base.width}×${base.height} but the markup says ${next.width}×${next.height}.`, { fix: "Apps can't resize existing pages. Keep the width/height from get_page, or use add_page for a new size." });
    }

    if(base.locked && serialisePage({ ...base, revision: undefined }, brand) !== serialisePage({ ...next, revision: undefined }, brand)) {
        err("page_locked", "page", "This page is locked in Canva.", { fix: "Ask the user to unlock the page, then re-read it." });
    }

    const b = flattenIds(base), n = flattenIds(next);

    for(const [id, x] of n) {
        const was = b.get(id);
        if(!was) {
            err("unknown_id", x.node.path, `data-id "${id}" isn't on this page.`, { dataId: id, fix: "Remove the data-id to create a new element, or call get_page again if the page changed." });
            continue;
        }
        if(was.node.kind !== x.node.kind) {
            err("kind_changed", x.node.path, `data-id "${id}" was a ${KIND_NAMES[was.node.kind]} and is now a ${KIND_NAMES[x.node.kind]}.`, { dataId: id, fix: "An element can't change type. Delete it (omit it) and add a new element without a data-id." });
        }
    }

    for(const [id, was] of b) {
        const now = n.get(id);
        const k = was.node.kind;
        if(k === "unsupported" || was.node.locked) {
            const what = k === "unsupported" ? "placeholder" : "locked";
            if(!now) {
                err(k === "unsupported" ? "deleted_placeholder" : "deleted_locked", "page", `${k === "unsupported" ? "Unsupported element" : "Locked element"} "${id}" was removed.`, { dataId: id, fix: `Put the <${k === "unsupported" ? "canva-unsupported" : KIND_NAMES[k].slice(1, -1)} data-id="${id}" …> line back exactly as get_page returned it.` });
                continue;
            }
            if(serialiseNode(was.node, brand) !== serialiseNode(now.node, brand) || was.group !== now.group) {
                err(k === "unsupported" ? "modified_placeholder" : "modified_locked", now.node.path, `${what === "placeholder" ? "Unsupported element" : "Locked element"} "${id}" was changed.`, { dataId: id, fix: "Restore it exactly as get_page returned it (same attributes, same position, same group)." });
            }
        } else if(k === "embed" && now && now.node.kind === "embed") {
            if(was.node.src !== now.node.src || was.node.style.width !== now.node.style.width || was.node.style.height !== now.node.style.height) {
                err("modified_embed", now.node.path, `Embed "${id}" can only be moved, rotated, faded or reordered.`, { dataId: id, fix: "Keep its src, width and height as get_page returned them." });
            }
        }
    }

    // Creating groups is broken in Canva's API (group() succeeds but the session then fails to
    // close and blocks all further edits until the app reloads), so only existing groups with
    // unchanged membership can be kept. Removing a <group> wrapper (ungrouping) is fine.
    const GROUP_FIX = "Keep the group's members exactly as get_page returned them (you can still move the group and edit its children), or remove the <group> wrapper to ungroup.";
    const walkGroups = (nodes : Array<Node>) => {
        for(const x of nodes) {
            if(x.kind === "box") walkGroups(x.children);
            if(x.kind !== "group") continue;
            if(!x.id) {
                err("group_unavailable", x.path, "New groups can't be created right now (a Canva API bug).", { fix: "Remove the <group> wrapper and place its elements directly." });
                continue;
            }
            const was = b.get(x.id)?.node;
            if(was?.kind !== "group") continue;
            if(memberIds(x.children) !== memberIds(was.children)) err("group_unavailable", x.path, `Group "${x.id}" can't change which elements it contains right now (a Canva API bug).`, { dataId: x.id, fix: GROUP_FIX });
        }
    };
    walkGroups(next.children);

    // Placeholders keep their relative stacking order (others may move around them)
    const ph = (m : Map<string, FlatNode>) => [...m.values()].filter(x => x.node.kind === "unsupported").sort((a, b) => a.order - b.order).map(x => x.node.id!);
    const before = ph(b).filter(id => n.has(id)), after = ph(n).filter(id => b.has(id));
    if(before.join(",") !== after.join(",")) {
        err("reordered_placeholder", "page", "Unsupported elements changed their stacking order relative to each other.", { fix: `Keep them in this order: ${before.join(", ")}.` });
    }

    return issues;
}
