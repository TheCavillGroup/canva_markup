import type { RawElement, RawNode } from "./html.ts";
import { isProblem, KNOWN_PROPS, mergeBorder, normalise, parseStyle, REJECTED_PROPS, TEXT_PROPS, type Problem } from "../css/mod.ts";
import { allowedHint, BLOCK_TAGS, KNOWN_TAGS, TAG_ATTRS, UNSUPPORTED_TAGS } from "./tags.ts";
import type { Issue, IssueCode, StyleMap } from "../types.ts";

export const MAX_ERRORS = 50;

export interface Ctx {
    path : string,
    text : StyleMap,
    inGroup : boolean
}

/** Issue collection and the checks every element reader shares. One per parsePage call. */
export function createReader() {
    const issues : Array<Issue> = [];
    let errors = 0;
    const ids = new Set<string>();

    const add = (code : IssueCode, path : string, message : string, extra : Partial<Issue> = {}) => {
        const severity = extra.severity ?? "error";
        if(severity === "error") {
            errors++;
            if(errors === MAX_ERRORS + 1) {
                issues.push({ severity: "error", code: "too_many_issues", path, message: `Stopped after ${MAX_ERRORS} errors.`, fix: "Fix these and validate again." });
            }
            if(errors > MAX_ERRORS) return;
        }
        issues.push({ severity, code, path, message, ...extra });
    };

    const problem = (p : Problem, path : string, extra : Partial<Issue> = {}) =>
        add(p.range ? "out_of_range" : "invalid_value", path, p.problem, { fix: p.fix, ...extra });

    const childPaths = (parent : string, children : Array<RawNode>) => {
        const counts : Record<string, number> = {};
        return children.map(c => {
            if(c.type !== "element") return parent;
            const n = counts[c.tag] ?? 0;
            counts[c.tag] = n + 1;
            return `${parent} > ${c.tag}[${n}]`;
        });
    };

    const checkAttrs = (el : RawElement, path : string) => {
        const allowed = TAG_ATTRS[el.tag] ?? [];
        for(const name in el.attrs) {
            if(allowed.includes(name)) continue;
            const dataId = el.attrs["data-id"];
            if(name === "class" || name === "id") add("unsupported_attribute", path, `${name} isn't used.`, { dataId, fix: name === "id" ? "Use data-id only for ids returned by get_page." : "Put styles inline in style=\"…\"." });
            else if(name.startsWith("on")) add("unsupported_attribute", path, `Event handlers (${name}) aren't allowed.`, { dataId, fix: `Remove ${name}.` });
            else if(el.tag === "svg" && (name === "width" || name === "height")) add("unsupported_attribute", path, `<svg ${name}> isn't used.`, { dataId, fix: `Size the shape with style="${name}:…px".` });
            else add("unknown_attribute", path, `Attribute ${name} isn't allowed on <${el.tag}>.`, { dataId, fix: `Allowed: ${allowed.join(", ") || "none"}.` });
        }
    };

    const readId = (el : RawElement, path : string) : string | undefined => {
        const id = el.attrs["data-id"];
        if(id == null) return;
        if(!/^[a-z][a-z0-9-]{0,31}$/.test(id)) {
            add("invalid_id", path, `data-id "${id}" isn't valid.`, { dataId: id, fix: "Only use data-id values returned by get_page; omit data-id on new elements." });
            return;
        }
        if(ids.has(id)) {
            add("duplicate_id", path, `data-id "${id}" is used more than once.`, { dataId: id, fix: "Each data-id may appear once. Remove the duplicate's data-id to create a new element." });
            return;
        }
        ids.add(id);
        return id;
    };

    const readLocked = (el : RawElement, path : string) : boolean | undefined => {
        const v = el.attrs["data-locked"];
        if(v == null) return;
        if(v !== "true") add("invalid_value", path, `data-locked="${v}" isn't valid.`, { dataId: el.attrs["data-id"], fix: "Leave data-locked exactly as get_page returned it." });
        return true;
    };

    /** Splits a style attribute into element style and text (inheritable) props. */
    const readStyle = (el : RawElement, path : string, allowed : Set<string>) : { style : StyleMap, text : StyleMap } => {
        const style : StyleMap = {}, text : StyleMap = {};
        const dataId = el.attrs["data-id"];
        const src = el.attrs.style;
        if(src == null) return { style, text };

        const parsed = parseStyle(src);
        if(parsed.error) add("invalid_value", path, parsed.error, { dataId, property: "style" });

        for(const { prop, value } of parsed.decls) {
            const rejected = REJECTED_PROPS[prop];
            if(rejected) {
                add("unsupported_css", path, rejected.problem, { dataId, property: prop, fix: rejected.fix });
                continue;
            }
            if(!KNOWN_PROPS.has(prop)) {
                add("unknown_css", path, `CSS property ${prop} isn't supported.`, { dataId, property: prop, fix: "Remove it. See the markup spec for the allowed properties." });
                continue;
            }
            if(!allowed.has(prop) || (prop === "list-style-type" && !["ul", "ol", "li"].includes(el.tag))) {
                add("unsupported_css", path, `${prop} isn't allowed on <${el.tag}>.`, { dataId, property: prop, fix: allowedHint(el.tag, prop) });
                continue;
            }
            if(el.tag === "text" && prop === "height" || (BLOCK_TAGS.has(el.tag) && prop === "height")) {
                add("unsupported_css", path, "Text boxes can't have a height: Canva sizes text to its content.", { dataId, property: prop, fix: "Remove height. Set width, then font-size/line-height to control the size." });
                continue;
            }
            const v = normalise(prop, value);
            if(isProblem(v)) {
                problem(v, path, { dataId, property: prop });
                continue;
            }
            if(TEXT_PROPS.has(prop)) text[prop] = v;
            else style[prop] = v;
        }

        const b = mergeBorder(style);
        if(b) problem(b, path, { dataId, property: "border" });
        return { style, text };
    };

    const textOutside = (n : RawNode, path : string, where : string) => {
        if(n.type === "text" && n.raw.trim() !== "") {
            add("invalid_nesting", path, `Text "${n.raw.trim().slice(0, 30)}" can't sit directly inside <${where}>.`, { fix: "Wrap text in <p> (or <h1>–<h6>)." });
        }
    };

    const badTag = (el : RawElement, path : string, message : string, fix? : string) => {
        if(UNSUPPORTED_TAGS[el.tag]) add("unsupported_tag", path, `<${el.tag}> isn't supported.`, { dataId: el.attrs["data-id"], fix: UNSUPPORTED_TAGS[el.tag] });
        else if(!KNOWN_TAGS.has(el.tag)) add("unknown_tag", path, `<${el.tag}> isn't part of the markup subset.`, { dataId: el.attrs["data-id"], fix: "See the markup spec for allowed tags." });
        else add("invalid_nesting", path, message, { dataId: el.attrs["data-id"], fix });
    };

    /** Takes issues found elsewhere (the HTML tokeniser), counting them as errors */
    const adopt = (found : Array<Issue>) => {
        issues.push(...found);
        errors += found.length;
    };

    return { issues, add, problem, childPaths, checkAttrs, readId, readLocked, readStyle, textOutside, badTag, adopt };
}

export type Reader = ReturnType<typeof createReader>;
