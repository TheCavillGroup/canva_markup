import type { Decl } from "./types.ts";

export function parseStyle(src : string) : { decls : Array<Decl>, error? : string } {
    const decls : Array<Decl> = [];
    let depth = 0, quote = "", cur = "";
    const parts : Array<string> = [];

    for(const ch of src) {
        if(quote) {
            if(ch === quote) quote = "";
        } else if(ch === "\"" || ch === "'") {
            quote = ch;
        } else if(ch === "(") {
            depth++;
        } else if(ch === ")") {
            depth--;
        } else if(ch === ";" && depth === 0) {
            parts.push(cur);
            cur = "";
            continue;
        }
        cur += ch;
    }
    parts.push(cur);
    if(quote || depth !== 0) return { decls, error: "Unbalanced quotes or parentheses in style." };

    for(const part of parts) {
        if(part.trim() === "") continue;
        const idx = part.indexOf(":");
        if(idx < 0) return { decls, error: `"${part.trim()}" is not a "property: value" pair.` };
        decls.push({ prop: part.slice(0, idx).trim().toLowerCase(), value: part.slice(idx + 1).trim() });
    }
    return { decls };
}

export function serialiseStyle(style : Record<string, string>) : string {
    const keys = Object.keys(style).sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
    return keys.map(k => `${k}:${style[k]}`).join("; ");
}

const STYLE_ORDER = [
    "position", "left", "top", "right", "bottom", "width", "height", "min-width", "max-width", "min-height", "max-height", "aspect-ratio", "box-sizing",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "flex", "flex-grow", "flex-shrink", "flex-basis", "align-self", "justify-self", "grid-column", "grid-row",
    "display", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "justify-items",
    "gap", "row-gap", "column-gap", "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-rows", "grid-auto-columns",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "background-color", "background-image", "background-size", "background-position", "background-repeat",
    "border", "border-radius", "object-fit", "opacity", "transform"
];

function order(prop : string) {
    const i = STYLE_ORDER.indexOf(prop);
    return i < 0 ? STYLE_ORDER.length : i;
}
