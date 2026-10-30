import type { BoxNode, InlineFormat, Node, ParagraphFormat } from "../types.ts";

/** Smallest page width/height, px */
export const PAGE_MIN = 40;
/** Largest page width/height, px */
export const PAGE_MAX = 8000;
/** Largest page area, px² */
export const PAGE_MAX_AREA = 25_000_000;

/** Paragraph format a <p> gets when the markup doesn't set it */
export const DEFAULT_PARAGRAPH : ParagraphFormat = {
    fontFamily: "brand-body",
    fontSize: 16,
    textAlign: "start",
    lineHeight: 1.4,
    letterSpacing: 0,
    listLevel: 0,
    listMarker: "none"
};

/** Inline format a run gets when the markup doesn't set it */
export const DEFAULT_INLINE : InlineFormat = {
    color: "#000000",
    fontWeight: "normal",
    fontStyle: "normal",
    decoration: "none",
    strikethrough: "none",
    link: ""
};

/** True if two runs can be merged */
export function sameInline(a : InlineFormat, b : InlineFormat) : boolean {
    return a.color === b.color && a.fontWeight === b.fontWeight && a.fontStyle === b.fontStyle && a.decoration === b.decoration && a.strikethrough === b.strikethrough && a.link === b.link;
}

/** True if the box draws something (background or border) and so becomes a Canva shape, not just layout */
export function isVisualBox(n : BoxNode) : boolean {
    return n.style["background-color"] != null || n.style["background-image"] != null || n.style.border != null;
}

/** Number of Canva elements a node list produces (layout-only boxes contribute their children). */
export function countElements(nodes : Array<Node>) : number {
    let n = 0;
    for(const x of nodes) {
        if(x.kind === "box") n += (isVisualBox(x) ? 1 : 0) + countElements(x.children);
        else n++;
    }
    return n;
}
