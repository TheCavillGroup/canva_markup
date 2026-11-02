// Normalised page model produced by the parser and consumed by the serialiser and base checks.
// Plain TS only: no Deno or DOM globals, so a browser bundle can import it directly.

import { CAVILL } from "./brand.ts";

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

/** @deprecated Use `Object.keys(CAVILL.fonts)`, or the aliases of your own brand */
export const FONT_ALIASES : ReadonlyArray<string> = Object.keys(CAVILL.fonts);

/** @deprecated Use `CAVILL.colors`, or the colours of your own brand */
export const BRAND_COLORS : Record<string, string> = { ...CAVILL.colors };
/** @deprecated Aliases come from a brand */
export type FontAlias = string;

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

/** What applying a page did to one element */
export type ApplyAction = "created" | "updated" | "replaced" | "moved" | "deleted" | "unchanged";
export const APPLY_ACTIONS : ReadonlyArray<ApplyAction> = ["created", "updated", "replaced", "moved", "deleted", "unchanged"];

export interface ElementResult {
    action : ApplyAction,
    /** node path in the applied markup ("" for deletions) */
    path : string,
    /** data-id of an existing element */
    id? : string,
    /** data-id minted for a created element */
    newId? : string,
    warning? : string
}

/** Something the apply did that the markup author should know (e.g. "font_weight", "canva_changed") */
export interface ApplyWarning {
    code : string,
    message : string,
    path? : string,
    dataId? : string
}

/** One page of a design, as a Canva app sees it */
export interface PageSummary {
    index : number,
    /** missing for pages apps can't use (e.g. Canva Docs pages) */
    id? : string,
    title? : string,
    width? : number,
    height? : number,
    /** the page the user is on */
    current : boolean
}
