import type { Problem } from "./types.ts";

// --- property groups ---

export const ITEM_PROPS = new Set([
    "position", "left", "top", "right", "bottom",
    "width", "height", "min-width", "max-width", "min-height", "max-height", "aspect-ratio", "box-sizing",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "flex", "flex-grow", "flex-shrink", "flex-basis", "align-self", "justify-self", "grid-column", "grid-row",
    "opacity", "transform"
]);

export const CONTAINER_PROPS = new Set([
    "display", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content", "justify-items",
    "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "grid-auto-flow", "grid-auto-rows", "grid-auto-columns",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left"
]);

export const BACKGROUND_PROPS = new Set(["background-color", "background-image", "background-size", "background-position", "background-repeat"]);
export const BORDER_PROPS = new Set(["border", "border-width", "border-style", "border-color", "border-radius"]);

export const TEXT_PROPS = new Set([
    "font-family", "font-size", "font-weight", "font-style", "color",
    "text-align", "line-height", "letter-spacing", "text-decoration", "list-style-type"
]);

export const INLINE_PROPS = new Set(["color", "font-weight", "font-style", "text-decoration"]);

export const PLACED_PROPS = new Set(["position", "left", "top", "right", "bottom", "width", "height", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "opacity", "transform"]);

export const KNOWN_PROPS = new Set([...ITEM_PROPS, ...CONTAINER_PROPS, ...BACKGROUND_PROPS, ...BORDER_PROPS, ...TEXT_PROPS, "object-fit"]);

const NO_SHADOW = "Remove it. If depth matters, place a slightly offset, darker <div> behind the element.";

export const REJECTED_PROPS : Record<string, Problem> = {
    "box-shadow": { problem: "Shadows can't be created through the Canva API.", fix: NO_SHADOW },
    "text-shadow": { problem: "Text shadows can't be created through the Canva API.", fix: "Remove it. Use a contrasting colour or a background <div> for legibility." },
    "filter": { problem: "Filters/effects can't be applied through the Canva API.", fix: "Remove it. Edit the image before using it." },
    "backdrop-filter": { problem: "Backdrop filters can't be applied through the Canva API.", fix: "Remove it. Use a solid background-color with opacity." },
    "mix-blend-mode": { problem: "Blend modes aren't supported.", fix: "Remove it." },
    "clip-path": { problem: "Clipping isn't supported.", fix: "Use border-radius, or draw the outline as <svg><path>." },
    "mask": { problem: "Masks aren't supported.", fix: "Use border-radius, or an <svg><path> with fill-image." },
    "mask-image": { problem: "Masks aren't supported.", fix: "Use border-radius, or an <svg><path> with fill-image." },
    "z-index": { problem: "z-index isn't used: stacking follows document order (later = on top).", fix: "Remove z-index and reorder the elements instead." },
    "overflow": { problem: "Canva elements don't clip their contents.", fix: "Remove overflow and size children to fit inside their container." },
    "overflow-x": { problem: "Canva elements don't clip their contents.", fix: "Remove it." },
    "overflow-y": { problem: "Canva elements don't clip their contents.", fix: "Remove it." },
    "background": { problem: "The background shorthand isn't supported.", fix: "Use background-color: #rrggbb or background-image: url(...)." },
    "border-top": { problem: "Only uniform borders are supported.", fix: "Use a thin <div> with background-color as a rule line." },
    "border-right": { problem: "Only uniform borders are supported.", fix: "Use a thin <div> with background-color as a rule line." },
    "border-bottom": { problem: "Only uniform borders are supported.", fix: "Use a thin <div> with background-color as a rule line." },
    "border-left": { problem: "Only uniform borders are supported.", fix: "Use a thin <div> with background-color as a rule line." },
    "outline": { problem: "Outlines aren't supported.", fix: "Use border." },
    "text-transform": { problem: "text-transform isn't supported.", fix: "Write the text in the case you want." },
    "text-indent": { problem: "text-indent isn't supported.", fix: "Remove it." },
    "word-spacing": { problem: "word-spacing isn't supported.", fix: "Remove it; letter-spacing is available." },
    "white-space": { problem: "white-space isn't supported: wrapping follows the text box width.", fix: "Remove it; use a wider box or separate <p> elements." },
    "vertical-align": { problem: "vertical-align isn't supported.", fix: "Use flex alignment on the container." },
    "font": { problem: "The font shorthand isn't supported.", fix: "Use font-family, font-size, font-weight, font-style and line-height." },
    "font-variant": { problem: "font-variant isn't supported.", fix: "Remove it." },
    "transition": { problem: "Animation isn't supported.", fix: "Remove it." },
    "animation": { problem: "Animation isn't supported.", fix: "Remove it." },
    "float": { problem: "float isn't supported.", fix: "Use display:flex or display:grid." },
    "order": { problem: "order isn't supported: document order is both layout order and stacking order.", fix: "Move the element in the markup instead." }
};
