import type { FontWeight } from "./types.ts";

// A brand gives markup its font aliases and colour names, and decides the default and heading fonts.
// Plain data: the parser, serialiser and the Canva reconciler all take one.

export interface BrandFont {
    /** Canva fontRef the alias applies, e.g. "YADK4LSvvyE:0" */
    ref : string;
    /** Real family name, used to measure text the browser has to lay out (fonts textmetrics doesn't know) */
    family : string;
    /** Weights the font has its own face for; documentation only (Canva shows the nearest it has) */
    weights? : ReadonlyArray<FontWeight>;
    /** One line for the spec's font table */
    description? : string;
}

export interface Brand {
    /** alias → font. Aliases look like `brand-…` */
    fonts : Readonly<Record<string, BrandFont>>;
    /** colour name → #rrggbb. Names look like `brand-…` */
    colors : Readonly<Record<string, string>>;
    /** Font a paragraph gets when the markup doesn't set one: an alias or a Canva library font name */
    defaultFont : string;
    /** Font `<h1>`–`<h6>` default to: an alias or a Canva library font name */
    headingFont : string;
}

/** The Cavill Group: the default brand everywhere a brand is optional */
export const CAVILL : Brand = {
    fonts: {
        "brand-headline": { ref: "YAF209YF8M8:0", family: "Safira March", weights: ["thin", "medium"], description: "Safira March (Cavill Group headings)" },
        "brand-body": { ref: "YADK4LSvvyE:0", family: "Questrial", weights: ["normal"], description: "Questrial (Cavill Group body)" },
        "brand-body-alt": { ref: "YAF209MN-Ic:1", family: "Questrial", weights: ["normal", "bold"], description: "Questrial (alternate cut)" },
        "brand-script": { ref: "YAGyMbl-Ebo:0", family: "Mr Sheffield", weights: ["normal"], description: "Mr Sheffield (script accent)" }
    },
    colors: {
        "brand-domino": "#231f20",
        "brand-text-blue": "#86d0cc",
        "brand-other-black": "#090f10",
        "brand-black": "#000000",
        "brand-lexicon": "#eaeaea"
    },
    defaultFont: "brand-body",
    headingFont: "brand-headline"
};

const NAME_RE = /^brand-[a-z0-9-]+$/;
const LIBRARY_RE = /^[A-Za-z0-9][A-Za-z0-9 \-'&.]*$/;

/** Every problem with a brand, as messages. Empty means it's usable. */
export function brandProblems(brand : Brand) : Array<string> {
    const out : Array<string> = [];
    for(const [alias, f] of Object.entries(brand.fonts)) {
        if(!NAME_RE.test(alias)) out.push(`Font alias "${alias}" must look like brand-<name> (lowercase letters, digits, -).`);
        if(!/^[A-Za-z0-9_\-]+:\d+$/.test(f.ref)) out.push(`Font alias "${alias}" has an invalid fontRef "${f.ref}".`);
        if(!f.family.trim()) out.push(`Font alias "${alias}" needs a family name.`);
    }
    for(const [name, hex] of Object.entries(brand.colors)) {
        if(!NAME_RE.test(name)) out.push(`Colour name "${name}" must look like brand-<name> (lowercase letters, digits, -).`);
        if(!/^#[0-9a-f]{6}$/.test(hex)) out.push(`Colour "${name}" must be lowercase #rrggbb, not "${hex}".`);
    }
    for(const [k, v] of [["defaultFont", brand.defaultFont], ["headingFont", brand.headingFont]] as const) {
        if(v.startsWith("brand-") ? !brand.fonts[v] : !LIBRARY_RE.test(v)) out.push(`${k} "${v}" must be one of the brand's font aliases or a Canva library font name.`);
    }
    return out;
}

/** Throws if the brand can't be used */
export function assertBrand(brand : Brand) : Brand {
    const problems = brandProblems(brand);
    if(problems.length) throw new Error(`Invalid brand:\n${problems.join("\n")}`);
    return brand;
}

/** fontRef → alias lookup */
export function fontRefs(brand : Brand) : { byRef : Map<string, string> } {
    const byRef = new Map<string, string>();
    for(const [alias, f] of Object.entries(brand.fonts)) {
        if(!byRef.has(f.ref)) byRef.set(f.ref, alias);
    }
    return { byRef };
}
