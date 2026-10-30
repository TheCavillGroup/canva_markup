// Normalised page model shared by the server (validation) and the Canva app (compiler/serialiser).
// Plain TS only: no Deno or DOM globals, so the app bundler can import it directly.

/** Every code an {@link Issue} can carry */
export const ISSUE_CODES = [
    "parse_error",
    "missing_page",
    "unknown_tag",
    "unsupported_tag",
    "unknown_attribute",
    "unsupported_attribute",
    "missing_attribute",
    "unknown_css",
    "unsupported_css",
    "invalid_value",
    "out_of_range",
    "invalid_nesting",
    "invalid_id",
    "duplicate_id",
    "unknown_id",
    "kind_changed",
    "page_size_mismatch",
    "page_locked",
    "modified_placeholder",
    "deleted_placeholder",
    "reordered_placeholder",
    "modified_locked",
    "deleted_locked",
    "modified_embed",
    "group_unavailable",
    "shape_limit",
    "converted_path",
    "too_many_issues"
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export type Severity = "error" | "warning";

/** A validation error or warning. Errors stop the page from parsing; warnings don't. */
export interface Issue {
    severity : Severity,
    code : IssueCode,
    /** node path in the source markup, e.g. "page > div[0] > p[0]" */
    path : string,
    dataId? : string,
    property? : string,
    message : string,
    fix? : string
}

export type StyleMap = Record<string, string>;

export const FONT_WEIGHTS = ["normal", "thin", "extralight", "light", "medium", "semibold", "bold", "ultrabold", "heavy"] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const TEXT_ALIGNS = ["start", "center", "end", "justify"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const LIST_MARKERS = ["none", "disc", "circle", "square", "decimal", "lower-alpha", "lower-roman", "checked", "unchecked"] as const;
export type ListMarker = (typeof LIST_MARKERS)[number];

/** Brand font names usable as a font-family */
export const FONT_ALIASES = ["brand-headline", "brand-body", "brand-body-alt", "brand-script"] as const;

/** Cavill Group palette (same values as Judy's Pallete.ts). Usable anywhere a colour is; stored as hex. */
export const BRAND_COLORS : Record<string, string> = {
    "brand-domino": "#231f20",
    "brand-text-blue": "#86d0cc",
    "brand-other-black": "#090f10",
    "brand-black": "#000000",
    "brand-lexicon": "#eaeaea"
};
export type FontAlias = (typeof FONT_ALIASES)[number];

export interface InlineFormat {
    color : string;
    fontWeight : FontWeight;
    fontStyle : "normal" | "italic";
    decoration : "none" | "underline";
    strikethrough : "none" | "strikethrough";
    link : string;
}

export interface ParagraphFormat {
    /** alias, library font name, or "ref:<fontRef>" */
    fontFamily : string;
    fontSize : number;
    textAlign : TextAlign;
    /** em */
    lineHeight : number;
    /** em */
    letterSpacing : number;
    listLevel : number;
    listMarker : ListMarker;
}

export interface Run {
    text : string,
    format : InlineFormat
}

export interface Paragraph {
    format : ParagraphFormat,
    runs : Array<Run>
}

export interface NodeBase<K extends string> {
    kind : K;
    id? : string;
    locked? : boolean;
    /** node path in the source markup, for error messages */
    path : string;
    style : StyleMap;
}

export interface BoxNode extends NodeBase<"box"> {
    children : Array<Node>;
}

export interface TextNode extends NodeBase<"text"> {
    paragraphs : Array<Paragraph>;
    /** informational, emitted by the serialiser; never applied */
    measuredHeight? : number;
}

export interface ImageNode extends NodeBase<"image"> {
    src : string;
    alt? : string;
}

export interface ShapePath {
    d : string,
    fill? : string,
    fillImage? : string,
    stroke? : string,
    strokeWidth? : number
}

export interface ShapeNode extends NodeBase<"shape"> {
    viewBox : [number, number, number, number];
    paths : Array<ShapePath>;
}

export interface GroupNode extends NodeBase<"group"> {
    children : Array<Node>;
}

export interface EmbedNode extends NodeBase<"embed"> {
    src : string;
}

export interface PlaceholderNode extends NodeBase<"unsupported"> {
    /** what Canva reported, e.g. "unsupported" */
    detail? : string;
}

/** Any element on a page */
export type Node = BoxNode | TextNode | ImageNode | ShapeNode | GroupNode | EmbedNode | PlaceholderNode;
export type NodeKind = Node["kind"];

/** A parsed page: size, page-level style and elements back to front */
export interface PageDoc {
    width : number;
    height : number;
    pageId? : string;
    revision? : string;
    locked? : boolean;
    style : StyleMap;
    children : Array<Node>;
}

/** Result of parsePage. `doc` is missing when any issue is an error. */
export interface ParseResult {
    doc? : PageDoc;
    issues : Array<Issue>;
}
