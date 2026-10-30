import { fmt } from "./css.ts";

// SVG path validation for Canva shapes. Canva rejects quadratic curves (Q/T), so paths that use
// them are rewritten to absolute cubic form: exact, not an approximation.

/** Most <path>s Canva takes in one shape */
export const MAX_PATHS = 30;
/** Longest `d` Canva takes, in bytes */
export const MAX_PATH_BYTES = 2048;
/** Most distinct fill colours in one shape */
export const MAX_FILL_COLORS = 6;

const ARGS : Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export interface PathSegment {
    cmd : string,
    args : Array<number>
}

/** Splits an SVG path into segments, or returns an error message */
export function tokenisePath(d : string) : Array<PathSegment> | string {
    const segs : Array<PathSegment> = [];
    let i = 0;
    const skip = () => {
        while(i < d.length && /[\s,]/.test(d[i])) i++;
    };
    const num = () : number | undefined => {
        skip();
        const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
        if(!m) return;
        i += m[0].length;
        return Number(m[0]);
    };
    const flag = () : number | undefined => {
        skip();
        if(d[i] === "0" || d[i] === "1") return Number(d[i++]);
        return undefined;
    };

    skip();
    while(i < d.length) {
        const cmd = d[i];
        const n = ARGS[cmd.toLowerCase()];
        if(n == null) return `Unexpected "${cmd}" at position ${i}.`;
        if(segs.length === 0 && cmd.toLowerCase() !== "m") return "Path must start with M.";
        i++;

        if(n === 0) {
            segs.push({ cmd, args: [] });
            skip();
            continue;
        }

        let groups = 0;
        while(true) {
            skip();
            if(i >= d.length || /[a-zA-Z]/.test(d[i])) break;
            const args : Array<number> = [];
            for(let k = 0; k < n; k++) {
                const v = cmd.toLowerCase() === "a" && (k === 3 || k === 4) ? flag() : num();
                if(v == null) return `"${cmd}" expects ${n} numbers per segment (position ${i}).`;
                args.push(v);
            }
            // Extra coordinate pairs after M are implicit L
            segs.push({ cmd: groups > 0 && cmd.toLowerCase() === "m" ? (cmd === "m" ? "l" : "L") : cmd, args });
            groups++;
        }
        if(groups === 0) return `"${cmd}" has no arguments.`;
    }
    if(segs.length === 0) return "Path is empty.";
    return segs;
}

export const usesQuadratic = (segs : Array<PathSegment>) => segs.some(s => /[qt]/i.test(s.cmd));

/** Absolute M/L/H/V/C/A/Z only; S, Q and T are expanded to explicit C. */
export function toAbsoluteCubic(segs : Array<PathSegment>) : string {
    const out : Array<string> = [];
    let x = 0, y = 0, sx = 0, sy = 0;
    let lastC : [number, number] | undefined;
    let lastQ : [number, number] | undefined;
    const p = (...ns : Array<number>) => ns.map(n => fmt(n, 3)).join(" ");

    for(const { cmd, args } of segs) {
        const rel = cmd === cmd.toLowerCase();
        const c = cmd.toUpperCase();
        const ox = rel ? x : 0, oy = rel ? y : 0;
        let nextC : [number, number] | undefined;
        let nextQ : [number, number] | undefined;

        if(c === "M") {
            x = ox + args[0]; y = oy + args[1]; sx = x; sy = y;
            out.push(`M${p(x, y)}`);
        } else if(c === "L") {
            x = ox + args[0]; y = oy + args[1];
            out.push(`L${p(x, y)}`);
        } else if(c === "H") {
            x = (rel ? x : 0) + args[0];
            out.push(`H${p(x)}`);
        } else if(c === "V") {
            y = (rel ? y : 0) + args[0];
            out.push(`V${p(y)}`);
        } else if(c === "C") {
            const [x1, y1, x2, y2, ex, ey] = [ox + args[0], oy + args[1], ox + args[2], oy + args[3], ox + args[4], oy + args[5]];
            out.push(`C${p(x1, y1, x2, y2, ex, ey)}`);
            nextC = [x2, y2];
            x = ex; y = ey;
        } else if(c === "S") {
            const [x1, y1] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
            const [x2, y2, ex, ey] = [ox + args[0], oy + args[1], ox + args[2], oy + args[3]];
            out.push(`C${p(x1, y1, x2, y2, ex, ey)}`);
            nextC = [x2, y2];
            x = ex; y = ey;
        } else if(c === "Q" || c === "T") {
            const [qx, qy] = c === "Q" ? [ox + args[0], oy + args[1]] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
            const [ex, ey] = c === "Q" ? [ox + args[2], oy + args[3]] : [ox + args[0], oy + args[1]];
            const c1 = [x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y)];
            const c2 = [ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey)];
            out.push(`C${p(c1[0], c1[1], c2[0], c2[1], ex, ey)}`);
            nextQ = [qx, qy];
            x = ex; y = ey;
        } else if(c === "A") {
            x = ox + args[5]; y = oy + args[6];
            out.push(`A${p(args[0], args[1], args[2])} ${args[3]} ${args[4]} ${p(x, y)}`);
        } else if(c === "Z") {
            x = sx; y = sy;
            out.push("Z");
        }
        lastC = nextC;
        lastQ = nextQ;
    }
    return out.join("");
}

export const byteLength = (s : string) => new TextEncoder().encode(s).length;
