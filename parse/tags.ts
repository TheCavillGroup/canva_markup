import { BACKGROUND_PROPS, BORDER_PROPS, CONTAINER_PROPS, INLINE_PROPS, ITEM_PROPS, TEXT_PROPS } from "../css/mod.ts";

export const HEADING_SIZES : Record<string, number> = { h1: 64, h2: 48, h3: 36, h4: 28, h5: 22, h6: 18 };

export const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"]);
export const INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "s", "del", "a"]);

export const UNSUPPORTED_TAGS : Record<string, string> = {
    table: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    thead: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    tbody: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    tr: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    td: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    th: "Tables aren't supported. Build rows with display:grid <div>s and put each cell's text in a <p>.",
    br: "Line breaks aren't supported inside text. Start a new <p> instead.",
    hr: "Use <div style=\"height:1px; background-color:#…\"></div> for a rule line.",
    video: "Video isn't supported.",
    audio: "Audio isn't supported.",
    iframe: "Embedding pages isn't supported.",
    canvas: "Canvas isn't supported.",
    picture: "Use <img>.",
    source: "Use <img src>.",
    object: "Not supported.",
    script: "Scripts aren't allowed.",
    style: "Stylesheets aren't allowed. Use inline style attributes.",
    link: "External stylesheets aren't allowed. Use inline style attributes.",
    meta: "Not allowed.",
    html: "Start the markup directly with <page>.",
    head: "Start the markup directly with <page>.",
    body: "Start the markup directly with <page>.",
    form: "Forms aren't supported.",
    input: "Inputs aren't supported.",
    button: "Buttons aren't supported. Draw a <div> with a <p> inside.",
    select: "Not supported.",
    textarea: "Not supported.",
    label: "Use <p>.",
    section: "Use <div>.",
    article: "Use <div>.",
    header: "Use <div>.",
    footer: "Use <div>.",
    nav: "Use <div>.",
    main: "Use <div>.",
    aside: "Use <div>.",
    figure: "Use <div>.",
    figcaption: "Use <p>.",
    blockquote: "Use <p>.",
    pre: "Use <p>.",
    code: "Use <span>.",
    sub: "Not supported.",
    sup: "Not supported.",
    mark: "Use <span style=\"color:…\">.",
    small: "Use <span> with a separate <p> font-size.",
    strike: "Use <s>.",
    font: "Use <span style>."
};

export const KNOWN_TAGS = new Set(["page", "div", "group", "text", "img", "svg", "path", "li", "canva-embed", "canva-unsupported", ...BLOCK_TAGS, ...INLINE_TAGS]);

const GLOBAL_ATTRS = ["data-id", "style", "data-locked"];
export const TAG_ATTRS : Record<string, Array<string>> = {
    page: ["width", "height", "data-page-id", "data-revision", "data-locked", "style"],
    div: GLOBAL_ATTRS,
    group: GLOBAL_ATTRS,
    text: [...GLOBAL_ATTRS, "data-measured-height"],
    img: [...GLOBAL_ATTRS, "src", "alt"],
    svg: [...GLOBAL_ATTRS, "viewbox"],
    path: ["d", "fill", "fill-image", "stroke", "stroke-width"],
    li: ["style"],
    a: ["href", "style"],
    "canva-embed": [...GLOBAL_ATTRS, "src"],
    "canva-unsupported": [...GLOBAL_ATTRS, "data-kind"]
};
for(const t of BLOCK_TAGS) TAG_ATTRS[t] = [...GLOBAL_ATTRS, "data-measured-height"];
for(const t of INLINE_TAGS) TAG_ATTRS[t] ??= ["style"];

const union = (...sets : Array<Set<string>>) => new Set(sets.flatMap(s => [...s]));
export const PAGE_STYLE = union(CONTAINER_PROPS, BACKGROUND_PROPS, TEXT_PROPS);
export const BOX_STYLE = union(ITEM_PROPS, CONTAINER_PROPS, BACKGROUND_PROPS, BORDER_PROPS, TEXT_PROPS);
export const GROUP_STYLE = union(ITEM_PROPS, CONTAINER_PROPS, TEXT_PROPS);
export const TEXT_BOX_STYLE = union(ITEM_PROPS, TEXT_PROPS);
export const IMG_STYLE = union(ITEM_PROPS, BORDER_PROPS, new Set(["object-fit"]));

export function allowedHint(tag : string, prop : string) : string {
    if(TEXT_PROPS.has(prop) && INLINE_PROPS.has(prop) === false && INLINE_TAGS.has(tag)) return "Inside a paragraph only color, font-weight, font-style and text-decoration can change. Split into separate <p>s for other changes.";
    if(prop === "list-style-type") return "Use list-style-type on <ul>, <ol> or <li>.";
    if(BACKGROUND_PROPS.has(prop) || BORDER_PROPS.has(prop)) return "Put backgrounds and borders on a <div> (behind the element).";
    if(ITEM_PROPS.has(prop)) return tag === "page" ? "The page's size comes from its width/height attributes." : "Position the <text> box (or a standalone <p>), not paragraphs inside <text>.";
    if(CONTAINER_PROPS.has(prop)) return "Layout properties belong on <page>, <div> or <group>.";
    return "See the markup spec for which properties each tag takes.";
}
