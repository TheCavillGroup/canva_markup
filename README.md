# @thecavillgroup/canva-markup

Canva pages as markup: a strict HTML subset that maps 1:1 onto Canva elements. This package parses, validates and serialises that markup. Its `./canva` export reads and writes live pages from inside a Canva app.

```
deno add jsr:@thecavillgroup/canva-markup
npm install @thecavillgroup/canva-markup@npm:@jsr/thecavillgroup__canva-markup   # with @jsr in .npmrc
```

## Markup (anywhere)

```ts
import { checkAgainstBase, parsePage, serialisePage } from "@thecavillgroup/canva-markup";

const base = parsePage(`<page width="800" height="600">
  <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>
</page>`);
if(!base.doc) throw new Error(base.issues.map(x => x.message).join("\n"));

const next = parsePage(serialisePage(base.doc).replace("#000000", "brand-text-blue"));
console.log(next.issues, checkAgainstBase(base.doc, next.doc!));
```

The root export has no Deno, DOM or Canva dependencies, so it runs on a server and in a browser.

## Brands

Font aliases (`brand-headline`) and colour names (`brand-text-blue`) come from a `Brand`. The plain exports use `CAVILL`. For another brand, use `createMarkup`:

```ts
import { CAVILL, createMarkup } from "@thecavillgroup/canva-markup";

const m = createMarkup({
    name: "Acme",
    fonts: { "brand-title": { ref: "YAF209YF8M8:0", family: "Safira March" } },
    colors: { "brand-sand": "#e8dcc8" },
    defaultFont: "Lato",
    headingFont: "brand-title",
    fontUrl: "https://example.com/fonts"
});
m.parsePage(`<page width="800" height="600" style="background-color:brand-sand"><h1>Hi</h1></page>`);
```

Aliases and colour names must look like `brand-<name>`. The spec in [docs/MARKUP.md](docs/MARKUP.md) has `<!-- brand:… -->` placeholders. Fill them with `renderSpec(spec, brand)` before showing the spec to anyone.

## Inside a Canva app (`./canva`)

```ts
import { CAVILL, serialisePage } from "@thecavillgroup/canva-markup";
import { createReconciler } from "@thecavillgroup/canva-markup/canva";

const canva = createReconciler({ ...CAVILL, fontUrl: `${BACKEND_HOST}/fonts` });

const { doc, pageIndex } = await canva.readPage();           // the page the user is on
const edited = serialisePage(doc).replace("Open Saturday", "Open Sunday");
const res = await canva.applyPage(edited, {
    pageIndex,
    pageId: doc.pageId,
    baseRevision: doc.revision!,
    resolveImage: src => ({ url: src, mimeType: "image/jpeg" })  // for https:// and brand: srcs
});
console.log(res.results, res.warnings, serialisePage(res.doc));
```

- **Reading.** Each element gets a sticky `data-id`: an element keeps its id across reads and edits for as long as the reconciler lives. The page gets a `revision`.
- **Applying.** `applyPage` validates the markup, lays it out in a hidden DOM, and uploads images and resolves fonts before it opens the design. In one session it then:
  1. re-reads the page and refuses if it changed (`stale_revision`)
  2. checks the edit against that page (ids, placeholders, locked elements)
  3. diffs by `data-id`, and makes one `sync()`, so the edit is one undo step in Canva
- **After applying.** The page is re-read. `res.doc` is what Canva actually stored, with a `canva_changed` warning where that differs from what was sent.
- **Errors.** Failures throw `ReconcileError` with a `code` such as `stale_revision`, `validation_failed`, `font_unavailable`, `asset_failed` or `not_supported`.
- **Fakes.** The lower-level pieces take Canva objects as arguments, so they run with fakes (see `tests/canva/`): `executeApply`, `readLivePage`, `conflictsWithLive`, `differences`, `layout`, and the id and font registries.

`./canva` needs the Canva Apps SDK runtime (`@canva/design` 2.13.2-beta.0 and `@canva/asset`; keep the app on the same `@canva/design` version) and a browser DOM.
