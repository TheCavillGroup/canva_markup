import type { findFonts as FindFonts, FontRef } from "@canva/asset";
import { fontRefs, type Brand } from "../brand.ts";
import { reconcileError } from "./errors.ts";

// Brand aliases are fixed fontRefs (long-lived in practice; neither Cavill brand font is in findFonts()).
// Everything else goes through findFonts: library font name → ref, and ref → name when reading.

/** Font lookups for one brand */
export interface FontRegistry {
    readonly brand : Brand;
    /** family (alias | name | "ref:…") → fontRef, or a font_unavailable error */
    resolve(family : string) : Promise<FontRef>;
    /** fontRef → family for markup: alias first, then a name that resolves back to the same ref, else "ref:…" */
    familiesFor(refs : Array<string>) : Promise<Map<string, string>>;
    /** CSS family used when measuring layout in the hidden DOM */
    measureFamily(family : string) : string;
}

/**
 * Font lookups for one brand. `findFonts` is @canva/asset's (passed in so this module never touches
 * the Canva runtime, which only exists inside the editor).
 */
export function createFontRegistry(brand : Brand, findFonts : typeof FindFonts) : FontRegistry {
    let library : Map<string, { name : string, ref : string }> | undefined;
    const names = new Map<string, string>();
    const { byRef } = fontRefs(brand);
    const fallbackFamily = brand.fonts[brand.defaultFont]?.family ?? brand.defaultFont;

    async function loadLibrary() {
        if(library) return library;
        const { fonts } = await findFonts();
        library = new Map(fonts.map(f => [f.name.toLowerCase(), { name: f.name, ref: f.ref }]));
        for(const f of fonts) names.set(f.ref, f.name);
        return library;
    }

    return {
        brand,

        /** family (alias | name | "ref:…") → fontRef, or a font_unavailable error */
        async resolve(family : string) : Promise<FontRef> {
            const alias = brand.fonts[family];
            if(alias) return alias.ref as FontRef;
            if(family.startsWith("ref:")) return family.slice(4) as FontRef;
            const lib = (await loadLibrary()).get(family.toLowerCase());
            if(lib) return lib.ref as FontRef;
            const aliases = Object.keys(brand.fonts);
            throw reconcileError("font_unavailable", `Font "${family}" isn't available to apps. Use ${aliases.length ? `${aliases.join(", ")}, or ` : ""}a Canva library font such as Montserrat, Lato, Poppins.`);
        },

        /** fontRef → family for markup: alias first, then a name that resolves back to the same ref, else "ref:…" */
        async familiesFor(refs : Array<string>) : Promise<Map<string, string>> {
            const out = new Map<string, string>();
            const lib = await loadLibrary().catch(() => new Map<string, { name : string, ref : string }>());

            for(const ref of refs) {
                const alias = byRef.get(ref);
                if(alias) out.set(ref, alias);
                else if(names.has(ref) && lib.get(names.get(ref)!.toLowerCase())?.ref === ref) out.set(ref, names.get(ref)!);
                else out.set(ref, `ref:${ref}`);
            }

            const unknown = refs.filter(r => out.get(r) === `ref:${r}` && !names.has(r));
            if(unknown.length) {
                const { fonts } = await findFonts({ fontRefs: unknown as Array<FontRef> }).catch(() => ({ fonts: [] }));
                for(const f of fonts) {
                    names.set(f.ref, f.name);
                    if(lib.get(f.name.toLowerCase())?.ref === f.ref) out.set(f.ref, f.name);
                }
            }
            return out;
        },

        /** CSS family used when measuring layout in the hidden DOM */
        measureFamily(family : string) : string {
            const alias = brand.fonts[family];
            if(alias) return alias.family;
            if(family.startsWith("ref:")) return names.get(family.slice(4)) ?? fallbackFamily;
            return family;
        }
    };
}


// --- webfonts for measurement ---

const loaded = new Map<string, Promise<boolean>>();

/** Loads a font into document.fonts so the hidden DOM measures with real metrics: `<fontUrl>/<family>.woff2` first, then Google Fonts. */
export function ensureMeasureFont(family : string, fontUrl? : string) : Promise<boolean> {
    if(loaded.has(family)) return loaded.get(family)!;
    const p = (async () => {
        // Self-hosted brand fonts first (e.g. Safira March isn't on Google Fonts)
        if(fontUrl) {
            const self = await fetch(`${fontUrl.replace(/\/$/, "")}/${encodeURIComponent(family)}.woff2`).catch(() => undefined);
            if(self?.ok) {
                const face = new FontFace(family, await self.arrayBuffer());
                document.fonts.add(await face.load());
                return true;
            }
        }
        const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=block`)
            .then(r => r.ok ? r.text() : "")
            .catch(() => "");
        const css400 = css || await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}&display=block`).then(r => r.ok ? r.text() : "").catch(() => "");
        const faces = [...css400.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => m[1]!);
        if(!faces.length) return false;
        await Promise.all(faces.map(async body => {
            const src = /url\(([^)]+)\)/.exec(body)?.[1];
            if(!src) return;
            const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1] ?? "400";
            const style = /font-style:\s*([^;]+);/.exec(body)?.[1] ?? "normal";
            const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
            const face = new FontFace(family, `url(${src})`, { weight, style, ...(unicodeRange ? { unicodeRange } : {}) });
            document.fonts.add(await face.load().catch(() => face));
        }));
        return true;
    })().catch(() => false);
    loaded.set(family, p);
    return p;
}
