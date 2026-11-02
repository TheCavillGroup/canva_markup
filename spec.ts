import { CAVILL, type Brand, type BrandFont } from "./brand.ts";

function weightNote(f : BrandFont) : string {
    const w = f.weights;
    if(!w?.length) return "";
    if(w.length === 1 && w[0] === "normal") return "Normal only: bold looks the same";
    return `Weights: ${w.join(", ")}`;
}

/** Markdown for the brand-specific parts of the spec, keyed by the placeholder they replace */
export function brandSpec(brand : Brand) : Record<"fonts" | "colors" | "default-font" | "heading-font", string> {
    const fonts = Object.entries(brand.fonts).map(([alias, f]) => `| \`${alias}\` | ${[f.description ?? f.family, weightNote(f)].filter(x => x).join(". ")} |`);
    const colors = Object.entries(brand.colors).map(([name, hex]) => `| \`${name}\` | \`${hex}\` |`);
    return {
        fonts: fonts.join("\n"),
        colors: colors.length ? colors.join("\n") : "| (none) | |",
        "default-font": brand.defaultFont,
        "heading-font": brand.headingFont
    };
}

/** Fills the `<!-- brand:… -->` placeholders in a spec (docs/MARKUP.md) for this brand */
export function renderSpec(spec : string, brand : Brand = CAVILL) : string {
    const parts = brandSpec(brand) as Record<string, string>;
    // A placeholder alone on a line takes the whole line, so an empty table section leaves no blank row
    return spec
        .replace(/^<!-- brand:([a-z-]+) -->\r?\n/gm, (m, k : string) => k in parts ? (parts[k] ? `${parts[k]}\n` : "") : m)
        .replace(/<!-- brand:([a-z-]+) -->/g, (m, k : string) => parts[k] ?? m);
}
