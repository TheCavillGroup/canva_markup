import { BRAND_COLORS, FONT_ALIASES } from "../types.ts";
import type { Problem } from "./types.ts";

export const isProblem = (x : unknown) : x is Problem => typeof x === "object" && x != null && "problem" in x;

/** Number as markup writes it: at most `dp` decimals, no trailing zeros, never -0 */
export function fmt(n : number, dp = 2) : string {
    const r = Number(n.toFixed(dp));
    return String(Object.is(r, -0) ? 0 : r);
}

// --- value normalisation ---

const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)";
const LENGTH_RE = new RegExp(`^(${NUM})(px|%)?$`);

type LengthOpts = { percent? : boolean, auto? : boolean, negative? : boolean };

export function normLength(v : string, opts : LengthOpts = {}) : string | Problem {
    const s = v.trim().toLowerCase();
    if(s === "auto" && opts.auto) return "auto";
    const m = LENGTH_RE.exec(s);
    if(!m) return { problem: `"${v}" is not a supported length.`, fix: `Use px${opts.percent ? " or %" : ""}${opts.auto ? " or auto" : ""} (e.g. 24px).` };
    const n = Number(m[1]);
    const unit = m[2] ?? (n === 0 ? "px" : "");
    if(unit === "") return { problem: `"${v}" has no unit.`, fix: `Write ${v}px.` };
    if(unit === "%" && !opts.percent) return { problem: `"${v}": % isn't allowed here.`, fix: "Use px." };
    if(n < 0 && !opts.negative) return { problem: `"${v}" can't be negative.`, fix: "Use 0 or a positive value.", range: true };
    if(Math.abs(n) > 32767) return { problem: `"${v}" is outside ±32767.`, range: true };
    return `${fmt(n)}${unit}`;
}

function normLengthList(v : string, min : number, max : number, opts : LengthOpts) : string | Problem {
    const parts = v.trim().split(/\s+/);
    if(parts.length < min || parts.length > max) return { problem: `"${v}" needs ${min === max ? min : `${min}–${max}`} value(s).` };
    const out : Array<string> = [];
    for(const p of parts) {
        const r = normLength(p, opts);
        if(isProblem(r)) return r;
        out.push(r);
    }
    return out.join(" ");
}

export function normColor(v : string) : string | Problem {
    const s = v.trim().toLowerCase();
    if(BRAND_COLORS[s]) return BRAND_COLORS[s];
    if(/^#[0-9a-f]{6}$/.test(s)) return s;
    if(/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map(c => c + c).join("");
    if(/^#[0-9a-f]{8}$/.test(s) || /^#[0-9a-f]{4}$/.test(s)) return { problem: `"${v}" has an alpha channel.`, fix: "Use #rrggbb and set opacity on the element." };
    if(/^(rgba?|hsla?)\(/.test(s)) return { problem: `"${v}" isn't supported.`, fix: "Use a hex colour like #1d1d1b (put any alpha in opacity)." };
    return { problem: `"${v}" isn't a hex colour.`, fix: `Use a hex colour like #1d1d1b, or a brand colour: ${Object.keys(BRAND_COLORS).join(", ")}.` };
}

function oneOf(v : string, allowed : ReadonlyArray<string>, fix? : string) : string | Problem {
    const s = v.trim().toLowerCase();
    if(allowed.includes(s)) return s;
    return { problem: `"${v}" isn't supported.`, fix: fix ?? `Use one of: ${allowed.join(", ")}.` };
}

function normNumber(v : string, min : number, max : number) : string | Problem {
    const s = v.trim();
    if(!new RegExp(`^${NUM}$`).test(s)) return { problem: `"${v}" isn't a number.` };
    const n = Number(s);
    if(n < min || n > max) return { problem: `${v} is outside ${min}–${max}.`, range: true };
    return fmt(n, 3);
}

export function normRotation(v : string) : string | Problem {
    const m = new RegExp(`^rotate\\(\\s*(${NUM})(deg|rad|turn)?\\s*\\)$`).exec(v.trim().toLowerCase());
    if(!m) {
        if(/^(scale|translate|skew|matrix|perspective|rotate[xyz3])/i.test(v.trim())) return { problem: `transform "${v}" isn't supported: only rotate() is.`, fix: "Bake scale/translate into width/height/left/top; use rotate(Ndeg) for rotation." };
        return { problem: `transform "${v}" isn't supported.`, fix: "Use a single rotate(Ndeg)." };
    }
    let deg = Number(m[1]);
    if(m[2] === "rad") deg = deg * 180 / Math.PI;
    if(m[2] === "turn") deg = deg * 360;
    if(m[2] == null && deg !== 0) return { problem: `"${v}" needs a unit.`, fix: `Write rotate(${m[1]}deg).` };
    deg = ((deg % 360) + 540) % 360 - 180;
    return `rotate(${fmt(deg)}deg)`;
}

export function normFontFamily(v : string) : string | Problem {
    const s = v.trim();
    if(/,/.test(s.replace(/"[^"]*"|'[^']*'/g, ""))) return { problem: "Font fallbacks aren't used.", fix: "Give exactly one font-family." };
    const unq = s.replace(/^["']|["']$/g, "").trim();
    if((FONT_ALIASES as ReadonlyArray<string>).includes(unq.toLowerCase())) return unq.toLowerCase();
    if(/^ref:[A-Za-z0-9_\-]+:\d+$/.test(unq)) return `"${unq}"`;
    if(/^[A-Za-z0-9][A-Za-z0-9 \-'&.]*$/.test(unq)) return `"${unq}"`;
    return { problem: `"${v}" isn't a valid font family.`, fix: `Use ${FONT_ALIASES.join(", ")}, a Canva library font name, or "ref:<fontRef>".` };
}

const WEIGHT_NUM : Record<string, string> = { "100": "thin", "200": "extralight", "300": "light", "400": "normal", "500": "medium", "600": "semibold", "700": "bold", "800": "ultrabold", "900": "heavy" };

export function normFontWeight(v : string) : string | Problem {
    const s = v.trim().toLowerCase();
    if(WEIGHT_NUM[s]) return WEIGHT_NUM[s];
    return oneOf(s, ["normal", "thin", "extralight", "light", "medium", "semibold", "bold", "ultrabold", "heavy"], "Use normal, bold, 100–900 or a named weight (thin … heavy).");
}

export function normTextDecoration(v : string) : string | Problem {
    const parts = v.trim().toLowerCase().split(/\s+/).sort();
    const ok = parts.every(p => p === "underline" || p === "line-through" || p === "none") && !(parts.includes("none") && parts.length > 1);
    if(!ok) return { problem: `text-decoration "${v}" isn't supported.`, fix: "Use none, underline, line-through, or underline line-through." };
    return parts.reverse().join(" ");
}

/** em value, or px/em/unitless kept for resolution against font-size */
function normEmish(v : string, allowNormal : boolean, allowUnitless : boolean) : string | Problem {
    const s = v.trim().toLowerCase();
    if(allowNormal && s === "normal") return "0em";
    const m = new RegExp(`^(${NUM})(px|em)?$`).exec(s);
    if(!m) return { problem: `"${v}" isn't supported.`, fix: "Use a unitless number, em, or px." };
    if(!m[2] && !allowUnitless && Number(m[1]) !== 0) return { problem: `"${v}" needs a unit.`, fix: "Use em or px." };
    return `${fmt(Number(m[1]), 4)}${m[2] ?? ""}`;
}

export function normalise(prop : string, value : string) : string | Problem {
    if(/!important/i.test(value)) return { problem: "!important isn't used.", fix: "Remove !important." };
    if(/\bvar\(|\bcalc\(|\benv\(/i.test(value)) return { problem: `"${value}": var()/calc() aren't supported.`, fix: "Write the computed value." };

    switch(prop) {
        case "position": return oneOf(value, ["absolute", "relative", "static"], "Use absolute, relative or static.");
        case "left": case "top": case "right": case "bottom":
            return normLength(value, { percent: true, auto: true, negative: true });
        case "width": case "height": case "min-width": case "min-height": case "max-width": case "max-height":
            return normLength(value, { percent: true, auto: prop === "width" || prop === "height" });
        case "aspect-ratio": {
            const m = new RegExp(`^(${NUM})(?:\\s*/\\s*(${NUM}))?$`).exec(value.trim());
            if(!m || Number(m[1]) <= 0 || (m[2] != null && Number(m[2]) <= 0)) return { problem: `aspect-ratio "${value}" isn't valid.`, fix: "Use e.g. 16 / 9." };
            return m[2] != null ? `${fmt(Number(m[1]), 4)} / ${fmt(Number(m[2]), 4)}` : fmt(Number(m[1]), 4);
        }
        case "box-sizing": return oneOf(value, ["border-box"], "Only border-box is used; remove box-sizing.");
        case "margin": return normLengthList(value, 1, 4, { percent: true, auto: true, negative: true });
        case "margin-top": case "margin-right": case "margin-bottom": case "margin-left":
            return normLength(value, { percent: true, auto: true, negative: true });
        case "padding": return normLengthList(value, 1, 4, { percent: true });
        case "padding-top": case "padding-right": case "padding-bottom": case "padding-left":
            return normLength(value, { percent: true });
        case "flex": {
            const s = value.trim().toLowerCase();
            if(s === "none" || s === "auto") return s;
            if(new RegExp(`^${NUM}(\\s+${NUM})?(\\s+(${NUM}(px|%)?|auto))?$`).test(s)) return s.replace(/\s+/g, " ");
            return { problem: `flex "${value}" isn't supported.`, fix: "Use e.g. flex: 1 or flex: 0 0 240px." };
        }
        case "flex-grow": case "flex-shrink": return normNumber(value, 0, 1000);
        case "flex-basis": return normLength(value, { percent: true, auto: true });
        case "align-self": return oneOf(value, ["auto", "stretch", "flex-start", "flex-end", "center", "baseline", "start", "end"]);
        case "justify-self": return oneOf(value, ["auto", "stretch", "start", "end", "center"]);
        case "grid-column": case "grid-row": {
            const s = value.trim().toLowerCase();
            if(/^(span\s+\d+|-?\d+)(\s*\/\s*(span\s+\d+|-?\d+))?$/.test(s)) return s.replace(/\s+/g, " ");
            return { problem: `${prop} "${value}" isn't supported.`, fix: "Use e.g. 1 / 3 or span 2." };
        }
        case "opacity": {
            const s = value.trim();
            if(s.endsWith("%")) return normNumber(String(Number(s.slice(0, -1)) / 100), 0, 1);
            return normNumber(s, 0, 1);
        }
        case "transform": return normRotation(value);

        case "display": {
            const s = value.trim().toLowerCase();
            if(s === "none") return { problem: "display:none isn't supported.", fix: "Delete the element instead." };
            return oneOf(s, ["block", "flex", "grid"], "Use block, flex or grid.");
        }
        case "flex-direction": return oneOf(value, ["row", "column", "row-reverse", "column-reverse"]);
        case "flex-wrap": return oneOf(value, ["nowrap", "wrap"]);
        case "justify-content": return oneOf(value, ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start", "end"]);
        case "align-items": return oneOf(value, ["stretch", "flex-start", "flex-end", "center", "baseline", "start", "end"]);
        case "align-content": return oneOf(value, ["stretch", "flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly", "start", "end"]);
        case "justify-items": return oneOf(value, ["stretch", "start", "end", "center"]);
        case "gap": return normLengthList(value, 1, 2, {});
        case "row-gap": case "column-gap": return normLength(value);
        case "grid-template-columns": case "grid-template-rows": case "grid-auto-rows": case "grid-auto-columns": {
            const s = value.trim().toLowerCase().replace(/\s+/g, " ");
            const fns = s.match(/[a-z-]+(?=\()/g) ?? [];
            if(fns.some(f => !["repeat", "minmax", "fit-content"].includes(f)) || !/^[a-z0-9 .,%()-]+$/.test(s)) {
                return { problem: `${prop} "${value}" isn't supported.`, fix: "Use px, %, fr, auto, repeat() and minmax() only." };
            }
            return s;
        }
        case "grid-auto-flow": return oneOf(value.trim().replace(/\s+/g, " "), ["row", "column", "dense", "row dense", "column dense"]);

        case "background-color": return normColor(value);
        case "background-image": {
            const s = value.trim();
            if(/gradient\(/i.test(s)) return { problem: "Gradients aren't supported by the Canva API.", fix: "Use a solid background-color, or an image with the gradient baked in." };
            const m = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)$/i.exec(s);
            if(!m) return { problem: `background-image "${value}" isn't supported.`, fix: "Use background-image: url(\"https://…\")." };
            const src = (m[1] ?? m[2] ?? m[3]).trim();
            const bad = checkSrc(src);
            if(bad) return bad;
            return `url("${src}")`;
        }
        case "background-size": return oneOf(value, ["cover"], "Images always cover their box (centred). Use background-size: cover or remove it.");
        case "background-position": {
            const s = value.trim().toLowerCase().replace(/\s+/g, " ");
            if(["center", "center center", "50% 50%"].includes(s)) return "center";
            return { problem: `background-position "${value}" isn't supported.`, fix: "Images are always centred. Remove background-position." };
        }
        case "background-repeat": return oneOf(value, ["no-repeat"], "Images never tile. Remove background-repeat.");
        case "border": return normBorder(value);
        case "border-width": return normLength(value);
        case "border-style": return oneOf(value, ["solid", "none"], "Only solid borders are supported.");
        case "border-color": return normColor(value);
        case "border-radius": {
            if(value.includes("/")) return { problem: "Elliptical radii aren't supported.", fix: "Use 1–4 px/% values." };
            return normLengthList(value, 1, 4, { percent: true });
        }
        case "object-fit": return oneOf(value, ["cover"], "Images always cover their box, centred. Crop the image beforehand, or size the box to the image's aspect ratio.");

        case "font-family": return normFontFamily(value);
        case "font-size": {
            const s = value.trim().toLowerCase();
            const m = new RegExp(`^(${NUM})px$`).exec(s);
            if(!m) return { problem: `font-size "${value}" isn't supported.`, fix: "Use px, e.g. 24px." };
            const n = Number(m[1]);
            if(n < 1 || n > 1000) return { problem: `font-size ${value} is outside 1–1000px.`, range: true };
            return `${fmt(n)}px`;
        }
        case "font-weight": return normFontWeight(value);
        case "font-style": return oneOf(value, ["normal", "italic"]);
        case "color": return normColor(value);
        case "text-align": {
            const s = value.trim().toLowerCase();
            const map : Record<string, string> = { left: "start", start: "start", center: "center", right: "end", end: "end", justify: "justify" };
            return map[s] ?? { problem: `text-align "${value}" isn't supported.`, fix: "Use left, center, right or justify." };
        }
        case "line-height": return normEmish(value, false, true);
        case "letter-spacing": return normEmish(value, true, false);
        case "text-decoration": return normTextDecoration(value);
        case "list-style-type": return oneOf(value, ["none", "disc", "circle", "square", "decimal", "lower-alpha", "lower-roman", "checked", "unchecked"]);
    }

    return { problem: `Unknown property ${prop}.` };
}

function normBorder(v : string) : string | Problem {
    const s = v.trim().toLowerCase();
    if(s === "none" || s === "0") return "none";
    let width : string | undefined, style : string | undefined, color : string | undefined;
    for(const part of s.split(/\s+/)) {
        if(part.startsWith("#") || BRAND_COLORS[part]) {
            const c = normColor(part);
            if(isProblem(c)) return c;
            color = c;
        } else if(["solid", "none", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"].includes(part)) {
            if(part !== "solid" && part !== "none") return { problem: `${part} borders aren't supported.`, fix: "Use solid." };
            style = part;
        } else {
            const w = normLength(part);
            if(isProblem(w)) return { problem: `border "${v}" isn't valid.`, fix: "Use e.g. border: 2px solid #1d1d1b." };
            width = w;
        }
    }
    if(style === "none") return "none";
    return [width ?? "", style ?? "", color ?? ""].join("|");
}

/** Merge border shorthand + longhands into one canonical "Npx solid #rrggbb", or delete it. */
export function mergeBorder(style : Record<string, string>) : Problem | undefined {
    const has = ["border", "border-width", "border-style", "border-color"].some(k => k in style);
    if(!has) return;

    let [w, s, c] = ["", "", ""];
    if(style.border === "none") s = "none";
    else if(style.border) [w, s, c] = style.border.split("|");
    if(style["border-width"]) w = style["border-width"];
    if(style["border-style"]) s = style["border-style"];
    if(style["border-color"]) c = style["border-color"];
    delete style.border;
    delete style["border-width"];
    delete style["border-style"];
    delete style["border-color"];

    if(s === "none") return;
    const width = w ? Number(w.replace("px", "")) : 0;
    if(width === 0 && !w) return { problem: "Border has no width.", fix: "Use e.g. border: 2px solid #1d1d1b." };
    if(width === 0) return;
    if(width > 100) return { problem: `Border width ${w} is over 100px.`, range: true };
    if(!c) return { problem: "Border has no colour.", fix: "Use e.g. border: 2px solid #1d1d1b." };
    style.border = `${w} solid ${c}`;
    return undefined;
}

/** Checks an image src: https URL, brand:<key> or canva:<ref>. Undefined if it's fine. */
export function checkSrc(src : string) : Problem | undefined {
    if(/^brand:[a-z0-9][a-z0-9-]*$/.test(src)) return;
    if(/^canva:[A-Za-z0-9_\-]+(:\d+)?$/.test(src)) return;
    if(/^http:\/\//i.test(src)) return { problem: `"${src}" isn't https.`, fix: "Use an https:// URL." };
    if(/^data:/i.test(src)) return { problem: "data: URLs aren't supported.", fix: "Host the image at an https:// URL, or use a brand: key." };
    if(!/^https:\/\/[^\s<>{}^`]+$/i.test(src) || src.length > 2048) return { problem: `"${src}" isn't a valid image source.`, fix: "Use an https:// URL, brand:<key>, or canva:<ref> from get_page." };
    try {
        new URL(src);
    } catch {
        return { problem: `"${src}" isn't a valid URL.` };
    }
    return undefined;
}
