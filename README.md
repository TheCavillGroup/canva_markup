# @thecavillgroup/canva-markup

Parser, validator and serialiser for Canva Bridge page markup, a strict HTML subset that maps 1:1 onto Canva elements.

```
deno add jsr:@thecavillgroup/canva-markup
```

```ts
import { checkAgainstBase, parsePage, serialisePage } from "@thecavillgroup/canva-markup";

const base = parsePage(`<page width="800" height="600">
  <div data-id="r1" style="position:absolute; left:0px; top:0px; width:100px; height:100px; background-color:#000000"></div>
</page>`);
if(!base.doc) throw new Error(base.issues.map(x => x.message).join("\n"));

const next = parsePage(serialisePage(base.doc).replace("#000000", "brand-text-blue"));
console.log(next.issues, checkAgainstBase(base.doc, next.doc!));
```

`parsePage`, `serialisePage`/`serialiseNode`, `checkAgainstBase`/`flattenIds`, plus the page model types (`PageDoc`, `Node`, `Issue`) and the shape path helpers.

The markup spec is in [docs/MARKUP.md](docs/MARKUP.md).
