import type { Issue } from "../types.ts";

// Minimal, strict HTML tokenizer for the markup subset. No DOM, no recovery heuristics beyond
// closing to the nearest matching open tag.

export interface RawElement {
    type : "element",
    tag : string,
    attrs : Record<string, string>,
    children : Array<RawNode>,
    line : number,
    col : number
}

export interface RawText {
    type : "text",
    /** undecoded source text: entities and whitespace are handled by the caller */
    raw : string,
    line : number,
    col : number
}

export type RawNode = RawElement | RawText;

export const VOID_TAGS = new Set(["img", "path", "br", "hr", "canva-embed", "canva-unsupported", "meta", "link", "input", "source", "col", "wbr"]);

const NAMED_ENTITIES : Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " "
};

export function decodeEntities(s : string, onUnknown? : (entity : string) => void) : string {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body : string) => {
        if(body[0] === "#") {
            const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if(!Number.isFinite(code) || code > 0x10ffff) {
                onUnknown?.(m);
                return m;
            }
            return String.fromCodePoint(code);
        }
        const v = NAMED_ENTITIES[body.toLowerCase()];
        if(v == null) {
            onUnknown?.(m);
            return m;
        }
        return v;
    });
}

export function parseHtml(src : string) : { roots : Array<RawNode>, issues : Array<Issue> } {
    const issues : Array<Issue> = [];
    const lineStarts = [0];
    for(let i = 0; i < src.length; i++) if(src[i] === "\n") lineStarts.push(i + 1);

    const pos = (i : number) => {
        let lo = 0, hi = lineStarts.length - 1;
        while(lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if(lineStarts[mid] <= i) lo = mid;
            else hi = mid - 1;
        }
        return { line: lo + 1, col: i - lineStarts[lo] + 1 };
    };

    const err = (i : number, message : string, fix? : string) => {
        const { line, col } = pos(i);
        issues.push({ severity: "error", code: "parse_error", path: `line ${line}:${col}`, message, fix });
    };

    const roots : Array<RawNode> = [];
    const stack : Array<RawElement> = [];
    const append = (n : RawNode) => (stack.length ? stack[stack.length - 1].children : roots).push(n);

    let i = 0;
    while(i < src.length) {
        if(src.startsWith("<!--", i)) {
            const end = src.indexOf("-->", i + 4);
            if(end < 0) {
                err(i, "Unterminated comment.", "Close it with -->.");
                break;
            }
            i = end + 3;
            continue;
        }

        if(src.startsWith("<!", i) || src.startsWith("<?", i)) {
            const end = src.indexOf(">", i);
            err(i, "Doctype/processing instructions are not allowed.", "Start the markup directly with <page>.");
            i = end < 0 ? src.length : end + 1;
            continue;
        }

        if(src.startsWith("</", i)) {
            const m = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(src.slice(i));
            if(!m) {
                err(i, "Malformed closing tag.");
                i += 2;
                continue;
            }
            const tag = m[1].toLowerCase();
            const idx = stack.map(x => x.tag).lastIndexOf(tag);
            if(idx < 0) {
                err(i, `Closing </${tag}> has no matching open tag.`, `Remove </${tag}> or add the missing <${tag}>.`);
            } else {
                for(let k = stack.length - 1; k > idx; k--) {
                    err(i, `<${stack[k].tag}> (line ${stack[k].line}) is not closed before </${tag}>.`, `Add </${stack[k].tag}>.`);
                }
                stack.length = idx;
            }
            i += m[0].length;
            continue;
        }

        if(src[i] === "<") {
            const nm = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(i));
            if(!nm) {
                err(i, "Stray '<' in text.", "Escape it as &lt;.");
                append({ type: "text", raw: "&lt;", ...pos(i) });
                i++;
                continue;
            }

            const start = i;
            const tag = nm[1].toLowerCase();
            const attrs : Record<string, string> = {};
            i += nm[0].length;
            let selfClosing = false;
            let closed = false;

            while(i < src.length) {
                while(i < src.length && /\s/.test(src[i])) i++;
                if(src.startsWith("/>", i)) {
                    selfClosing = true;
                    closed = true;
                    i += 2;
                    break;
                }
                if(src[i] === ">") {
                    closed = true;
                    i++;
                    break;
                }

                const an = /^[^\s=/>"'<]+/.exec(src.slice(i));
                if(!an) {
                    err(i, `Unexpected character '${src[i]}' in <${tag}>.`);
                    i++;
                    continue;
                }
                const name = an[0].toLowerCase();
                i += an[0].length;
                while(i < src.length && /\s/.test(src[i])) i++;

                let value = "";
                if(src[i] === "=") {
                    i++;
                    while(i < src.length && /\s/.test(src[i])) i++;
                    const q = src[i];
                    if(q === "\"" || q === "'") {
                        const end = src.indexOf(q, i + 1);
                        if(end < 0) {
                            err(i, `Unterminated attribute value for ${name} in <${tag}>.`, `Close the value with ${q}.`);
                            i = src.length;
                            break;
                        }
                        value = src.slice(i + 1, end);
                        i = end + 1;
                    } else {
                        const uv = /^[^\s>]+/.exec(src.slice(i));
                        value = uv ? uv[0] : "";
                        i += value.length;
                    }
                }

                if(name in attrs) err(start, `Duplicate attribute ${name} on <${tag}>.`, "Keep one.");
                attrs[name] = decodeEntities(value);
            }

            if(!closed) {
                err(start, `<${tag}> is never closed with '>'.`);
                break;
            }

            const el : RawElement = { type: "element", tag, attrs, children: [], ...pos(start) };
            append(el);
            if(!selfClosing && !VOID_TAGS.has(tag)) stack.push(el);
            continue;
        }

        const next = src.indexOf("<", i);
        const end = next < 0 ? src.length : next;
        append({ type: "text", raw: src.slice(i, end), ...pos(i) });
        i = end;
    }

    for(const el of stack) err(src.length, `<${el.tag}> (line ${el.line}) is never closed.`, `Add </${el.tag}>.`);

    return { roots, issues };
}
