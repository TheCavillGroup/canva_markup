import type { RawElement } from "./html.ts";
import { checkSrc, fmt, isProblem, normColor, ITEM_PROPS } from "../css/mod.ts";
import { byteLength, MAX_FILL_COLORS, MAX_PATH_BYTES, MAX_PATHS, toAbsoluteCubic, tokenisePath, usesQuadratic } from "../path.ts";
import type { Ctx, Reader } from "./reader.ts";
import type { ShapeNode, ShapePath } from "../types.ts";

export function readSvg(cx : Reader, el : RawElement, ctx : Ctx) : ShapeNode | undefined {
    const { add, problem, childPaths, checkAttrs, readId, readLocked, readStyle, textOutside, badTag } = cx;
    const path = ctx.path;
    const { style } = readStyle(el, path, ITEM_PROPS);
    const id = readId(el, path);

    const vb = (el.attrs.viewbox ?? "").trim().split(/[\s,]+/).map(Number);
    let viewBox : [number, number, number, number] = [0, 0, 0, 0];
    if(vb.length !== 4 || vb.some(n => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
        add("missing_attribute", path, "<svg> needs viewBox=\"minX minY width height\" with positive size.", { dataId: id, property: "viewBox" });
    } else {
        viewBox = vb as [number, number, number, number];
    }
    if(style.width == null && style.height == null) add("missing_attribute", path, "<svg> needs a width or height.", { dataId: id, fix: "Add style=\"width:…px\" (height follows the viewBox ratio)." });

    const paths : Array<ShapePath> = [];
    const cps = childPaths(path, el.children);
    el.children.forEach((c, i) => {
        const p = cps[i];
        if(c.type === "text") return textOutside(c, p, "svg");
        if(c.tag !== "path") return badTag(c, p, `<${c.tag}> isn't allowed inside <svg>.`, "Only <path d fill stroke stroke-width fill-image> is supported. Convert other shapes to paths.");
        checkAttrs(c, p);
        const d = (c.attrs.d ?? "").trim();
        const segs = tokenisePath(d);
        if(typeof segs === "string") {
            add("invalid_value", p, `Invalid path d: ${segs}`, { dataId: id, property: "d" });
            return;
        }
        const sp : ShapePath = { d };
        if(usesQuadratic(segs)) {
            sp.d = toAbsoluteCubic(segs);
            add("converted_path", p, "Quadratic curves (Q/T) were converted to cubic (C). The shape is identical.", { severity: "warning", dataId: id, property: "d" });
        }

        const fill = c.attrs.fill;
        if(fill != null && fill.trim().toLowerCase() !== "none") {
            const v = normColor(fill, cx.brand);
            if(isProblem(v)) problem(v, p, { dataId: id, property: "fill" });
            else sp.fill = v;
        } else if(fill == null && c.attrs["fill-image"] == null) {
            sp.fill = "#000000";
        }
        if(c.attrs["fill-image"] != null) {
            const bad = checkSrc(c.attrs["fill-image"]);
            if(bad) problem(bad, p, { dataId: id, property: "fill-image" });
            sp.fillImage = c.attrs["fill-image"];
        }
        const stroke = c.attrs.stroke;
        if(stroke != null && stroke.trim().toLowerCase() !== "none") {
            const v = normColor(stroke, cx.brand);
            if(isProblem(v)) problem(v, p, { dataId: id, property: "stroke" });
            else sp.stroke = v;
            const w = Number((c.attrs["stroke-width"] ?? "1").replace(/px$/, ""));
            if(!Number.isFinite(w) || w < 0 || w > 100) add("out_of_range", p, `stroke-width ${c.attrs["stroke-width"]} is outside 0–100.`, { dataId: id, property: "stroke-width" });
            else sp.strokeWidth = Number(fmt(w));
        }
        paths.push(sp);
    });

    if(paths.length === 0 || paths.length > MAX_PATHS) {
        add("shape_limit", path, `A shape needs 1–${MAX_PATHS} <path> elements (has ${paths.length}).`, { dataId: id, fix: paths.length ? "Split it into several <svg> shapes, or use an image." : "Add a <path>." });
    }
    const bytes = paths.reduce((a, p) => a + byteLength(p.d), 0);
    if(bytes > MAX_PATH_BYTES) {
        add("shape_limit", path, `Path data is ${bytes} bytes; Canva allows ${MAX_PATH_BYTES}.`, { dataId: id, fix: "Simplify the paths, split into several <svg>s, or use an <img> for complex artwork such as logos." });
    }
    const colors = new Set(paths.map(p => p.fill).filter(x => x != null));
    if(colors.size > MAX_FILL_COLORS) {
        add("shape_limit", path, `${colors.size} fill colours; Canva allows ${MAX_FILL_COLORS} per shape.`, { dataId: id, fix: "Split into several <svg> shapes." });
    }

    const node : ShapeNode = { kind: "shape", path, style, viewBox, paths };
    if(id) node.id = id;
    if(readLocked(el, path)) node.locked = true;
    return node;
}
