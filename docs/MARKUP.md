# Canva Bridge markup

You edit a Canva page by writing **one HTML-like document per page**. The Canva app turns it into
real, editable Canva elements: text stays text, boxes become shapes, images become image elements.
Nothing is rasterised. Anything this spec doesn't allow is **rejected with an error that names the
node and suggests a fix**. It is never approximated.

This is the spec for the `@thecavillgroup/canva-markup` parser. Everything below is checked by
`parsePage` and `checkAgainstBase` unless it is marked **(host)**: those parts are applied inside the
Canva app by the package's `./canva` reconciler, or by the host around it (tools, asset resolution).

Font aliases and colour names come from a brand. The `<!-- brand:… -->` placeholders are filled by
`renderSpec(spec, brand)`; serve the rendered text, never this file as is.

## Workflow (host)

1. `get_page` returns the page as markup, plus a `revision`.
2. Edit that markup. Keep every `data-id` you didn't mean to change exactly as it was.
3. `apply_page(page_index, markup, base_revision)` applies the whole page as **one undo step**.
   - Elements you didn't touch are left alone.
   - Elements you removed are deleted.
   - Elements without a `data-id` are created.
4. If someone changed the page in Canva after your `get_page`, the apply is refused as stale. Call
   `get_page` again and redo the edit.

For a brand-new page, write the markup from scratch (no `data-id`s) and apply it to an empty page,
or one created with `add_page`.

## The page root

```html
<page width="1080" height="1350" style="background-color:#f4efe9">
  <!-- elements; comments are allowed and ignored -->
</page>
```

- `width` and `height` are required whole px values, 40–8000, and the area can be at most
  25,000,000 px². They **must match the page**: apps can't resize an existing page, so use
  `add_page(width, height)` for another size.
- `data-page-id`, `data-revision` and `data-locked` come from `get_page`. Leave them as they are.
- Only `width`, `height`, `data-page-id`, `data-revision`, `data-locked` and `style` are allowed on
  `<page>`. The markup must be exactly one `<page>`, with no `<html>` or `<body>`.
- Page style: `background-color`, `background-image: url(…)`, layout properties (flex/grid,
  padding, gap), and text properties that children inherit (font-family, color, …).

## Elements

| Markup | Becomes in Canva |
|---|---|
| `<text>` containing `<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>` | one text box with several paragraphs |
| a bare `<p>` / `<h1>`–`<h6>` / `<ul>` / `<ol>` | one text box each |
| `<div>` with `background-color`, `background-image` or `border` | a rectangle (or a shape if it has `border-radius`) |
| `<div>` without those | nothing: layout only. Its children still become elements |
| `<img src>` | an image (or a rounded shape with an image fill if it has `border-radius`) |
| `<svg viewBox><path …/></svg>` | a vector shape |
| `<group>` | an existing Canva group from `get_page` (see Groups below) |
| `<canva-embed>` | an existing embed (video etc.): kept from `get_page`, never created |
| `<canva-unsupported>` | something Canva's API can't read (lines, charts, tables, …): kept untouched |

Only `style`, `data-id` and `data-locked` are allowed on elements (plus `src`/`alt` on `<img>`,
`viewBox` on `<svg>`, `data-measured-height` on text). `class`, `id` and `on…` handlers are rejected.

**Stacking order is document order:** later elements sit on top. A box is drawn behind its own
children. There is no `z-index`.

## Two ways to position things

- **Layout mode** (best for new pages): use `display:flex` or `display:grid`, `padding`, `gap`,
  `width`/`height` and percentages. The app lays the page out like a browser would, then places
  each element exactly where it landed.
- **Absolute mode** (what `get_page` returns): `position:absolute; left; top; width; height` on
  every element. Positions inside a `<group>` are relative to the group.

You can mix the two. Units are `px` and `%`; `0` needs no unit. Up to 2 decimals are kept.

## Text

```html
<text style="position:absolute; left:64px; top:900px; width:952px; color:#ffffff">
  <h1>Just Listed</h1>
  <p style="font-size:28px">12 Example St, <b>Wahroonga</b></p>
  <ul>
    <li>4 bedrooms</li>
    <li>2 bathrooms
      <ul style="list-style-type:circle"><li>main with ensuite</li></ul>
    </li>
  </ul>
</text>
```

- **Paragraph-level** properties (on `<p>`, `<h1>`–`<h6>`, `<li>`, `<ul>`/`<ol>`, `<text>`, or
  inherited from containers): `font-family`, `font-size` (px, 1–1000), `text-align`
  (left/center/right/justify), `line-height` (unitless or em 0.5–2.5, or px), `letter-spacing`
  (em −0.2–0.8, or px), `color`, `font-weight`, `font-style`, `text-decoration`.
- **Inside a paragraph** only these can change: `<b>`/`<strong>`, `<i>`/`<em>`, `<u>`,
  `<s>`/`<del>`, `<a href>`, and `<span style>` with `color`, `font-weight`, `font-style`,
  `text-decoration`. To change font or size mid-paragraph, split it into separate paragraphs.
- **Defaults:** `font-family: <!-- brand:default-font -->`, `16px`, `color:#000000`, `line-height:1.4`, left
  aligned. `<h1>`–`<h6>` default to `<!-- brand:heading-font -->` at 64/48/36/28/22/18px. Headings are
  otherwise plain paragraphs (`get_page` returns them as `<p>`).
- **Lists:** `<ul>`/`<ol>` with `<li>`. Nest lists inside an `<li>` for deeper levels.
  `list-style-type`: disc, circle, square, decimal, lower-alpha, lower-roman, checked, unchecked,
  none.
- **No line breaks:** there is no `<br>`; start a new `<p>`. An empty `<p></p>` is a blank line.
- **Whitespace:** a line break in your markup (with its indentation) collapses to one space.
  Spaces within a line are kept exactly.
- **Escape `&`, `<` and `>`** as `&amp;`, `&lt;`, `&gt;`.
- **Text boxes** need at least one paragraph, and text can't sit directly inside `<text>`, a list
  or a `<div>`: wrap it in `<p>`. Paragraphs inside `<text>` don't take `data-id`; put it on `<text>`.
- **Text height is decided by Canva:** set `width`, never `height`. `get_page` reports the real
  height as `data-measured-height` (read-only).
- **Links** must be `https://`, `mailto:` or `tel:`, and can't nest.

## Fonts

The parser accepts a font family as one of the names below; which weights each one actually has is
Canva's **(host)**.

| `font-family` | Font |
|---|---|
<!-- brand:fonts -->
| `"Montserrat"` | a Canva library font, by name (an unknown name is an error) |
| `"ref:YAF209YF8M8:0"` | an exact Canva font reference, as `get_page` returns it for fonts it can't name |

Give exactly one family: there are no fallback lists. `font-weight` accepts `normal`, `bold`,
`100`–`900`, or thin/extralight/light/medium/semibold/ultrabold/heavy. Canva doesn't fake missing
weights: a weight the font lacks shows as the nearest one it has, and `apply_page` warns
(`font_weight`) when that looks no different from normal.

## Brand colours

These names work anywhere a colour does (`color`, `background-color`, `border`, path `fill`/`stroke`).
`get_page` shows them as hex. Colours are `#rgb`, `#rrggbb` or one of these names; `rgba()`, named
CSS colours and 8-digit hex are rejected.

| Name | Hex |
|---|---|
<!-- brand:colors -->

## Boxes

```html
<div style="position:absolute; left:0; top:900px; width:1080px; height:450px; background-color:#1d1d1b"></div>
<div style="width:320px; height:200px; background-image:url('https://…/kitchen.jpg'); border-radius:24px"></div>
```

- `background-color` takes `#rgb`, `#rrggbb` or a brand colour name (above). For transparency
  use `opacity` (0–1).
- `background-image: url(…)` fills the box like `background-size: cover`, centred.
- `border: <0–100>px solid #rrggbb`, uniform on all sides only.
- `border-radius`: 1–4 values in px or %. `50%` on a square makes a circle.
- `transform: rotate(<deg>)` and `opacity` work on every element.

## Images

```html
<img src="https://example.com/front.jpg" alt="Front of house" style="width:100%; aspect-ratio:4 / 3; border-radius:16px">
```

- `src` takes one of:
  - an `https://` URL
  - `brand:<key>` for a brand asset (table below)
  - `canva:<ref>`, which `get_page` returns for images already in the design (reuse it to keep
    that image)
- No `http:` and no `data:` URLs.
- Images can't have children.
- Images must have a definite size: `width` and `height`, or one of them plus `aspect-ratio`.
- Images always **cover** their box, centred (`object-fit: cover`; `contain` isn't available).
  Crop beforehand, or match the box to the image's aspect ratio.

### Brand images (host)

The parser only checks that `brand:<key>` is shaped like a key; the server maps these keys to
images in the agency's Canva account (or uploads the logos).

| `src` | Image |
|---|---|
| `brand:logo-black` | The Cavill Group logo, black (aspect 2.76 : 1, e.g. `width:276px; height:100px`) |
| `brand:logo-white` | The Cavill Group logo, white |
| `brand:placeholder-photo` | Placeholder agent photo |
| `brand:anna-photo` | Anna (agent photo) |
| `brand:maria-photo` | Maria (agent photo) |
| `brand:open-homes-cover` | Open Homes cover image |
| `brand:suburb-dl` | Suburb DL background |
| `brand:default-qr` | Default QR code |

Photos and the QR code are images already in the agency's Canva account (`get_page` shows them as
`canva:` refs after applying). Logos are uploaded on first use.

## Shapes

```html
<svg viewBox="0 0 100 100" style="position:absolute; left:40px; top:40px; width:64px">
  <path d="M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 Z" fill="#c8a165" />
</svg>
```

- `viewBox` is required. Size the shape with `style` width and/or height (not `width`/`height`
  attributes); a missing dimension follows the viewBox ratio.
- `<path>` attributes: `d`, `fill` (`#rrggbb` or `none`; default black), `fill-image` (an image
  src), `stroke`, `stroke-width` (0–100).
- Limits per `<svg>`: 1–30 paths, 2 KB of path data in total, 6 distinct fill colours. Use an
  `<img>` for complex artwork such as logos.
- Path commands: M L H V C S A Z (absolute or relative). Q/T are converted to C automatically
  (exactly the same curve), with a warning.

## Groups

Groups that already exist (from `get_page`) can be moved, rotated and faded, and their members can
be edited in place. Removing the `<group>` wrapper (keeping its members) ungroups them.

A group holds at least 2 elements. You **can't** create new groups, or change which elements a group contains, right now. Canva's API
fails when it creates a group. Either is rejected with `group_unavailable`; place the elements
without a `<group>` instead. Groups don't nest.

## data-id rules

- `get_page` puts a `data-id` on every element. **Only use ids from `get_page`.** Never invent one.
- To **keep or edit** an element, keep its `data-id`.
- To **delete** it, remove the element from the markup.
- To **create** one, write it without a `data-id`.
- A `data-id` is lowercase letters, digits and `-`, starting with a letter. An id may appear once.
- A `<div data-id>` that has no background or border isn't a Canva element and is rejected: keep
  the background/border, or delete it.
- An element can't change type: to turn a box into an image, delete it and
  add a new `<img>`.
- **(host)** Changing an existing element's **size or shape** recreates it (Canva can't resize in place).
  The result lists it as `replaced`, with a warning that Canva-only effects on it (filters, crops,
  animations) may be lost.

## Things you must leave alone

- **`<canva-unsupported>`**: copy it back **exactly**, with the same attributes, the same group,
  and the same order relative to other `<canva-unsupported>` elements. You may move other elements
  in front of or behind it.
- **`data-locked="true"`** (an element locked in Canva): copy it back exactly. On a locked page,
  nothing can change.
- **`<canva-embed>`**: you may move, rotate, fade, reorder or delete it, but not change its `src`,
  `width` or `height`. New embeds can't be created.

## Not supported, and what to do instead

| Instead of | Do |
|---|---|
| `<table>` | rows of `display:grid` `<div>`s with a `<p>` per cell |
| gradients | a solid `background-color`, or an image with the gradient baked in |
| `box-shadow` / `text-shadow` | an offset darker `<div>` behind, or stronger contrast |
| `filter`, blend modes, masks, `clip-path` | edit the image beforehand; `border-radius` or an `<svg>` path for shapes |
| `z-index` | reorder the elements |
| `overflow: hidden` | size children to fit |
| per-side borders, `<hr>` | a thin `<div>` with a background colour |
| `<br>` | a new `<p>` |
| `rgba()`, named colours, 8-digit hex | `#rrggbb` plus `opacity` |
| `transform: scale/translate` | change `width`/`height`/`left`/`top` |
| `calc()`, `var()`, `class`, `<style>` | write computed values inline |
| `<section>`, `<header>`, … | `<div>` |

## Errors

`apply_page` validates before touching the design. Every problem is reported in one pass (up to
50):

```json
{
  "severity": "error",
  "code": "unsupported_css",
  "path": "page > div[1]",
  "dataId": "r2",
  "property": "box-shadow",
  "message": "Shadows can't be created through the Canva API.",
  "fix": "Remove it. If depth matters, place a slightly offset, darker <div> behind the element."
}
```

`path` counts children of the same tag from 0 (`div[1]` is the second `<div>`). Warnings (such as
`converted_path`) don't block the apply.

### Issue codes

| Code | Meaning |
|---|---|
| `parse_error` | the HTML couldn't be tokenised (unclosed tag, bad entity, …) |
| `missing_page` | not exactly one `<page>` root |
| `unknown_tag` / `unsupported_tag` | a tag outside the subset / a tag with a documented alternative |
| `unknown_attribute` / `unsupported_attribute` | an attribute the tag doesn't take / one that is never used (`class`, `id`, `on…`) |
| `missing_attribute` | a required attribute is absent (`width`, `src`, `href`, `viewBox`, …) |
| `unknown_css` / `unsupported_css` | a property outside the subset / one that is rejected or not allowed on this tag |
| `invalid_value` | the value can't be used (bad colour, unit, link, path data, …) |
| `out_of_range` | the value is outside its allowed range |
| `invalid_nesting` | the element can't sit there (text outside a paragraph, nested groups or links, …) |
| `invalid_id` / `duplicate_id` | a malformed `data-id`, or one used twice |
| `shape_limit` | an `<svg>` has too many paths, path bytes or fill colours |
| `converted_path` | warning: Q/T curves were rewritten as C |
| `too_many_issues` | validation stopped after 50 errors |

`checkAgainstBase` adds the rules that need the page you read:

| Code | Meaning |
|---|---|
| `unknown_id` | a `data-id` that isn't on the base page |
| `kind_changed` | an element changed type |
| `page_size_mismatch` / `page_locked` | the page size changed / the page is locked and was edited |
| `modified_placeholder` / `deleted_placeholder` / `reordered_placeholder` | a `<canva-unsupported>` was changed, removed or moved relative to another |
| `modified_locked` / `deleted_locked` | a locked element was changed or removed |
| `modified_embed` | an embed's `src`, `width` or `height` changed |
| `group_unavailable` | a group was created, or its members changed |

The host adds its own codes when applying (for example `font_weight`); they aren't produced here.

## Example: a new page

```html
<page width="1080" height="1350" style="background-color:#f4efe9; display:flex; flex-direction:column; padding:64px; gap:32px; color:#1d1d1b">
  <img src="brand:logo-black" style="width:276px; aspect-ratio:1296 / 470">
  <img src="https://example.com/front.jpg" alt="Front" style="width:100%; aspect-ratio:4 / 3; border-radius:24px">
  <h1>Just Listed</h1>
  <p style="font-size:32px">12 Example Street, <b>Wahroonga</b></p>
  <div style="background-color:#1d1d1b; padding:32px; display:grid; grid-template-columns:repeat(3, 1fr); gap:16px">
    <p style="color:#ffffff; font-size:28px; text-align:center">4 bed</p>
    <p style="color:#ffffff; font-size:28px; text-align:center">2 bath</p>
    <p style="color:#ffffff; font-size:28px; text-align:center">2 car</p>
  </div>
</page>
```

## Example: editing what get_page returned

```html
<page width="800" height="600" data-page-id="PBllB4wHzD1KYHl9" data-revision="7a627bd74c174fcb" style="background-color:#ffffff">
  <div data-id="r1" style="position:absolute; left:40px; top:40px; width:200px; height:120px; background-color:#c8a165"></div>
  <text data-id="t1" style="position:absolute; left:40px; top:200px; width:600px" data-measured-height="57.4">
    <p style="font-family:brand-headline; font-size:48px; color:#1d1d1b">Open Saturday 10am</p>
  </text>
  <canva-unsupported data-id="u1" data-kind="unsupported" style="position:absolute; left:264px; top:298px; width:272px; height:4px" />
</page>
```

Here the heading text and the box position changed; `u1` is copied back untouched.
