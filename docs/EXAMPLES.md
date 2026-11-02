# Examples

End to end, inside a Canva app: build markup with `html`, check it, apply it to a page. Each block is
self-contained. The Canva calls sit in functions you call from your app panel, and the code at the
bottom of each block runs anywhere, so you can check the markup before it gets near a design.

`html` escapes every value (an `&` in a team name can't break the page), turns objects into styles
(`{ fontSize: 28 }` → `font-size:28px`), joins arrays, and drops `false`/`null`/`undefined` so
`&&` and `?:` work. A node or page from `readPage()` renders back as markup with its `data-id`.

## A new listing page

Small functions return markup, and the page puts them together. `addPage` gives an empty page, and
`applyPage` creates everything on it in one undo step.

```ts
import { html, parsePage, type TemplateResult } from "@thecavillgroup/canva-markup";
import type { Reconciler, ResolvedImage } from "@thecavillgroup/canva-markup/canva";

// Your app's backend, which serves the brand: images
const BACKEND_HOST = "https://example.com";

interface Listing {
    address : string,
    suburb : string,
    photo : string,
    beds : number,
    baths : number,
    cars : number,
    auction? : string,
    inspections : Array<string>,
    agent : { name : string, team : string, phone : string, photo : string }
}

const stat = (n : number, label : string) => html`<p style=${{ color: "#ffffff", fontSize: 28, textAlign: "center" }}>${n} ${label}</p>`;

const agentCard = (agent : Listing["agent"]) => html`
    <div style=${{ display: "flex", alignItems: "center", gap: 24 }}>
        <img src=${agent.photo} alt=${agent.name} style=${{ width: 120, height: 120, borderRadius: "50%" }}>
        <text>
            <p style=${{ fontSize: 28 }}><b>${agent.name}</b></p>
            <p>${agent.team}</p>
            <p><a href=${`tel:${agent.phone.replace(/\s/g, "")}`}>${agent.phone}</a></p>
        </text>
    </div>`;

function listingPage(l : Listing) : TemplateResult {
    return html`<page width="1080" height="1350" style=${{ backgroundColor: "brand-lexicon", display: "flex", flexDirection: "column", padding: 64, gap: 32, color: "brand-domino" }}>
        <img src="brand:logo-black" style=${{ width: 276, aspectRatio: "1296 / 470" }}>
        <img src=${l.photo} alt=${`Front of ${l.address}`} style=${{ width: "100%", aspectRatio: "4 / 3", borderRadius: 24 }}>
        <h1>${l.auction ? "Auction" : "Just Listed"}</h1>
        <p style=${{ fontSize: 32 }}>${l.address}, <b>${l.suburb}</b></p>
        ${l.auction && html`<p style=${{ fontSize: 24 }}>Auction ${l.auction}, unless sold prior</p>`}
        <div style=${{ backgroundColor: "brand-domino", padding: 32, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            ${stat(l.beds, "bed")}
            ${stat(l.baths, "bath")}
            ${stat(l.cars, "car")}
        </div>
        ${l.inspections.length > 0 && html`
            <ul style=${{ fontSize: 22 }}>
                ${l.inspections.map(x => html`<li>Open ${x}</li>`)}
            </ul>`}
        ${agentCard(l.agent)}
    </page>`;
}

// https photos are uploaded by URL; brand: keys come from the app's backend
const resolveImage = (src : string) : ResolvedImage => src.startsWith("brand:")
    ? { url: `${BACKEND_HOST}/brand/${src.slice(6)}.png`, mimeType: "image/png" }
    : { url: src, mimeType: "image/jpeg" };

export async function addListingPage(canva : Reconciler, listing : Listing) {
    const page = listingPage(listing);
    const added = await canva.addPage({ width: 1080, height: 1350, title: listing.address });
    const { doc } = await canva.readPage(added.pageIndex);

    const res = await canva.applyPage(page, { pageIndex: added.pageIndex, pageId: added.pageId, baseRevision: doc.revision!, resolveImage });
    console.log(res.results.map(x => `${x.action} ${x.path} ${x.newId ?? ""}`));
    console.log(res.warnings);
    return res;
}

// In the app panel: await addListingPage(createReconciler(), SAMPLE)

const SAMPLE : Listing = {
    address: "12 Example Street",
    suburb: "Wahroonga",
    photo: "https://example.com/12-example-st/front.jpg",
    beds: 4,
    baths: 2,
    cars: 2,
    auction: "Sat 15 Nov, 11am",
    inspections: ["Sat 1 Nov, 10:00–10:30am", "Wed 5 Nov, 5:30–6:00pm"],
    agent: { name: "Alex Example", team: "Sales & Leasing", phone: "0400 000 000", photo: "brand:placeholder-photo" }
};

const r = parsePage(listingPage(SAMPLE));
if(!r.doc) throw new Error(r.issues.map(x => `${x.path}: ${x.message}`).join("\n"));
```

## Editing a page that's already there

Read the page, keep what you didn't touch, and change the rest. Nodes from `readPage()` drop
straight into `html` with their `data-id`s, so Canva keeps them as they are. A node you rewrite keeps
its `data-id` and is updated in place, and anything without a `data-id` is created.

If someone edits the page in Canva between the read and the apply, it fails with `stale_revision`.
Read it again and redo the edit.

```ts
import { checkAgainstBase, html, parsePage, type PageDoc, type TemplateResult, type TextNode } from "@thecavillgroup/canva-markup";
import { isReconcileError, type Reconciler } from "@thecavillgroup/canva-markup/canva";

const plainText = (n : TextNode) => n.paragraphs.map(p => p.runs.map(r => r.text).join("")).join("\n");

/** Swaps text in the first text box containing `from`, and puts an "Under offer" banner on top */
function underOffer(doc : PageDoc, from : string, to : string) : TemplateResult {
    const target = doc.children.find(n => n.kind === "text" && plainText(n).includes(from));
    if(!target) throw new Error(`No text containing "${from}"`);

    // Same node, new run text: formatting and data-id are kept
    const edited = structuredClone(target) as TextNode;
    for(const p of edited.paragraphs) for(const r of p.runs) r.text = r.text.replaceAll(from, to);

    return html`<page width=${doc.width} height=${doc.height} data-page-id=${doc.pageId} data-revision=${doc.revision} style=${doc.style}>
        ${doc.children.map(n => n === target ? edited : n)}
        <div style=${{ position: "absolute", left: 0, top: 48, width: doc.width, height: 96, backgroundColor: "brand-text-blue" }}></div>
        <h2 style=${{ position: "absolute", left: 0, top: 70, width: doc.width, textAlign: "center", color: "#ffffff" }}>Under offer</h2>
    </page>`;
}

export async function markUnderOffer(canva : Reconciler, from : string, to : string) {
    for(let attempt = 1; attempt <= 2; attempt++) {
        const { doc, pageIndex } = await canva.readPage();
        try {
            return await canva.applyPage(underOffer(doc, from, to), { pageIndex, pageId: doc.pageId, baseRevision: doc.revision! });
        } catch(err) {
            if(isReconcileError(err) && err.code === "stale_revision" && attempt < 2) continue;
            throw err;
        }
    }
}

// What readPage() gives back, roughly
const base = parsePage(`<page width="800" height="600" data-page-id="PBllB4wHzD1KYHl9" data-revision="7a627bd74c174fcb" style="background-color:#ffffff">
  <div data-id="r1" style="position:absolute; left:40px; top:40px; width:200px; height:120px; background-color:#c8a165"></div>
  <text data-id="t1" style="position:absolute; left:40px; top:200px; width:600px" data-measured-height="57.4">
    <p style="font-family:brand-headline; font-size:48px; color:#1d1d1b">Open Saturday 10am</p>
  </text>
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:264px; top:298px; width:272px; height:4px" />
</page>`).doc!;

const next = parsePage(underOffer(base, "Saturday 10am", "Sunday 11am"));
if(!next.doc) throw new Error(next.issues.map(x => `${x.path}: ${x.message}`).join("\n"));
const conflicts = checkAgainstBase(base, next.doc);
if(conflicts.length) throw new Error(conflicts.map(x => x.message).join("\n"));
```

## When markup is rejected

Nothing is applied unless all of it can be. `parsePage` lists every problem with the node's path
and usually a fix. `applyPage` throws `validation_failed` with the same issues in `details`, and
also rejects markup that conflicts with the live page (an unknown `data-id`, an edited locked
element, …).

```ts
import { html, parsePage, type Issue, type TemplateResult } from "@thecavillgroup/canva-markup";
import { isReconcileError, type Reconciler } from "@thecavillgroup/canva-markup/canva";

const describe = (issues : Array<Issue>) => issues.map(x => `${x.severity} ${x.code} at ${x.path}${x.property ? ` (${x.property})` : ""}: ${x.message}${x.fix ? `\n  fix: ${x.fix}` : ""}`).join("\n");

export async function tryApply(canva : Reconciler, page : TemplateResult) {
    const { doc, pageIndex } = await canva.readPage();
    try {
        return await canva.applyPage(page, { pageIndex, pageId: doc.pageId, baseRevision: doc.revision! });
    } catch(err) {
        if(!isReconcileError(err)) throw err;
        if(err.code === "validation_failed") console.error(describe((err.details as { issues : Array<Issue> }).issues));
        else console.error(err.code, err.message);
    }
}

const card = html`<page width="1080" height="1080">
    <div style=${{ width: 600, height: 400, backgroundColor: "#ffffff", boxShadow: "0 4px 12px #000000" }}></div>
    <p style=${{ color: "rgba(0, 0, 0, 0.5)" }}>Just Sold</p>
</page>`;

const r = parsePage(card);
console.log(describe(r.issues));
// error unsupported_css at page > div[0] (box-shadow): Shadows can't be created through the Canva API.
//   fix: Remove it. If depth matters, place a slightly offset, darker <div> behind the element.
// error invalid_value at page > p[0] (color): "rgba(0, 0, 0, 0.5)" isn't supported.
//   fix: Use a hex colour like #1d1d1b (put any alpha in opacity).
if(r.doc || !r.issues.some(x => x.code === "unsupported_css" && x.property === "box-shadow")) throw new Error("Expected box-shadow to be rejected");
```
