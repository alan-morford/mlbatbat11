# Running Mozilla Readability (Reader Mode) in a Legacy webOS App

How to get a real "Reader Mode" article-extraction view working inside an
app targeting ancient HP webOS (3.0.x, the TouchPad-era WebKit, roughly
2010-2011 vintage — `AppleWebKit/534.6`-class engines). This is a general
recipe, not tied to any specific app or content source — the techniques
below apply to any project embedding a modern JS library (Readability or
otherwise) into that generation of WebKit.

## Why this isn't the normal Node.js recipe

Every off-the-shelf "readability" package (`@mozilla/readability`,
`node-red-contrib-node-moz-readability`, etc.) is written for **Node.js**,
paired with `jsdom` to fake a DOM. Don't reach for that combination here:

- `jsdom` needs a modern Node runtime with native bindings. A legacy webOS
  device's on-board Node/JS service host (if it even has one) is far too
  old and constrained to run it.
- It's also **unnecessary**. `jsdom` exists only to fake a DOM for Node.
  A webOS app already runs inside a real WebKit `document` — Readability's
  actual algorithm just needs *some* `Document` object to walk; it doesn't
  care whether that document came from a live page or was built from a raw
  HTML string in-app. Run the algorithm directly in the app's own WebKit,
  and the whole "can this old Node runtime run jsdom" question disappears.

So the shape of the solution is: **fetch raw article HTML → parse it into a
real in-app `Document` → run Readability against that → render the
extracted HTML.** Everything below is about making each of those steps
work on an engine old enough to predate most of the APIs modern code
assumes exist.

## Step 1: Get an ES5-only build of Readability

Pull `Readability.js` from `@mozilla/readability` (MIT/Apache-licensed,
dependency-free beyond a DOM). Current releases use ES2015+ syntax
(`class`, `let`/`const`, arrow functions, template literals, `for...of`) —
a 2010/2011 WebKit engine cannot parse any of that; the file throws a
`SyntaxError` and never loads at all.

Transpile it yourself with Babel, targeting old browsers:

```js
const babel = require('@babel/core');
const result = babel.transformFileSync('Readability.js', {
  presets: [['@babel/preset-env', { targets: { ie: '9' } }]],
  configFile: false,
  babelrc: false
});
// write result.code to your vendored file
```

(`ie: '9'` is just a convenient stand-in for "assume nothing ES6+" — there's
no real "ancient WebKit" Babel target, but IE9's feature set is a close
enough proxy for syntax purposes.)

**Verify the output, don't trust it blindly.** Grep the transpiled file for
leftover modern syntax before moving on:

```
grep -n "=>" out.js                              # arrow functions
grep -nE "(^|[^\w$.])(let|const)[[:space:]]" out.js
grep -c '`' out.js                                # template literals (check they're just comments)
grep -n "for *(.*of " out.js                      # for-of
grep -n "class " out.js                           # class keyword
node --check out.js                                # basic syntax sanity
```

## Step 2: Patch what Babel's syntax transform *doesn't* cover

Babel's `preset-env` only rewrites **syntax**. It does not polyfill missing
**built-in methods/globals** an engine this old lacks, and it doesn't
protect you from bugs in its own generated helper code on such an engine.
Two categories of gap to expect and fix by hand:

### Missing ES2015+ built-ins

Grep the transpiled output for these and add minimal manual polyfills for
whichever appear (don't ship a general-purpose polyfill library — a few
lines each is enough, scoped to exactly how the vendored file uses them):

- `Array.from`
- `Array.prototype.includes` / `String.prototype.includes`
- `String.prototype.startsWith`
- `Array.prototype.find`
- `Set` (often just needs `.has()` — check actual usage before building more)

```js
if (!Array.from) {
	Array.from = function (arrayLike, mapFn) {
		var result = [], len = arrayLike && arrayLike.length ? arrayLike.length : 0;
		for (var i = 0; i < len; i++) { result.push(mapFn ? mapFn(arrayLike[i], i) : arrayLike[i]); }
		return result;
	};
}
// ...same pattern for the others: guard with `if (!X)`, array-like-only,
// no need for full iterator-protocol support unless you've confirmed the
// vendored code actually needs it.
```

### `new URL()` is not available

The `URL` constructor arrived in WebKit years after this generation. Any
code doing `new URL(relative, base).href` will throw. Replace it with the
classic pre-`URL`-API trick: assign to a real `<a>` element's `.href` in a
document whose base is already set, then read `.href` back — this is
standard DOM href resolution, supported since the earliest scriptable
browsers:

```js
function toAbsoluteURI(uri, doc) {
	try {
		var a = doc.createElement("a");
		a.href = uri;
		return a.href;
	} catch (ex) { return uri; }
}
```

### Babel's own `for...of` helper can break on `NodeList`

If the source has any `for (var x of someNodeList)`, Babel transpiles it
through a generated `_createForOfIteratorHelper` + `_unsupportedIterableToArray`
pair. On an engine with **no `Symbol` at all** (this generation of WebKit),
the `Symbol.iterator` fast path is always skipped, and the generated
fallback (`_unsupportedIterableToArray`) only recognizes `Map`/`Set`/
`Arguments`/typed arrays by name — a plain `NodeList` or `HTMLCollection`
falls through and throws `"Invalid attempt to iterate non-iterable
instance"`. This is easy to miss until you actually run the code on the
real engine (see Testing Strategy below — this specific bug did not
surface in local Node/jsdom testing, only on-device).

Fix by widening Babel's generated helper to treat anything with a numeric
`.length` as array-like:

```js
// find the generated `_unsupportedIterableToArray` function and change its
// final `: void 0` fallback to:
("number" == typeof (r && r.length) ? _arrayLikeToArray(r, a) : void 0)
```

## Step 3: Parse raw HTML into a Document — don't use `DOMParser`

`DOMParser.parseFromString(html, "text/html")` looks like the obvious tool,
but **HTML-mode DOMParser is a later spec addition** — WebKit didn't
support it until years after this generation. On the real device it
silently returns a useless/falsy result rather than throwing, which makes
it easy to misdiagnose as something else. (`DOMParser` in **XML** mode,
e.g. `"text/xml"`, has been supported since much earlier — it's
specifically the HTML-parsing mode that's missing.)

Use the technique that predates `DOMParser` entirely: a hidden iframe,
populated via `document.open()/write()/close()`. This has worked in
scriptable browsers forever:

```js
var iframe = document.createElement("iframe");
iframe.setAttribute("sandbox", "allow-same-origin"); // see security note below
iframe.style.position = "absolute";
iframe.style.left = "-9999px";
iframe.style.width = "1px";
iframe.style.height = "1px";
document.body.appendChild(iframe);

var idoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
idoc.open();
idoc.write(html);
idoc.close();
// idoc now behaves as a genuine parsed Document: .title, .head, .body,
// .documentElement, getElementsByTagName, etc. all work normally.
```

**Don't detach the iframe until you're completely done with the document.**
Readability's own extraction algorithm does a fairly deep, multi-pass
DOM walk/mutation over the whole thing. Detaching the iframe from the DOM
before that finishes risks the underlying browsing context (and the
liveness of its document) being torn down mid-algorithm on some engines.
Keep it attached for the entire extraction, and only `removeChild` it in a
`finally` block wrapping the whole operation.

### Security note: this makes a *live*, script-capable document

Unlike `DOMParser`'s result (always inert, scripts never run),
`document.write()`-ing arbitrary third-party HTML into a real iframe
creates a genuine browsing context that **will parse and execute
`<script>` tags** during the write, in a context that's same-origin with
your app by default (an undirected `about:blank`-style iframe inherits the
creator's origin) — a real risk if you're rendering content from anywhere
you don't fully trust.

Layer your defenses, since you can't be fully sure any single one is
honored on an old/embedded WebKit build:

1. `sandbox="allow-same-origin"` on the iframe — blocks script execution
   *if the browser honors `sandbox` at all* (introduced ~2010-2011,
   plausible but not guaranteed on an embedded/mobile WebKit build of that
   vintage). Must be exactly `allow-same-origin` with **no** `allow-scripts`
   — and you need `allow-same-origin` specifically, or a sandboxed iframe's
   origin becomes opaque and you lose synchronous access to
   `contentDocument` entirely.
2. Strip `<script>...</script>` from the raw HTML **string**, before it
   ever reaches `document.write()`, as an unconditional second layer
   regardless of whether `sandbox` worked:
   ```js
   html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
       .replace(/<script\b[^>]*\/>/gi, "");
   ```
3. Do a final DOM-level sanitize pass on the **extracted result** specifically
   (strip `<script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>/<form>`,
   strip any `on*` attribute, strip `javascript:` in any `src`/`href`) —
   this is what actually ends up rendered inside your app's own privileged
   UI, so it's worth sanitizing even though Readability's own internal
   cleanup already removes most of this during extraction.

## Step 4: Fix relative URLs

A document built via `document.write()` (or `DOMParser`, if it had worked)
has no real base URL of its own — it was never navigated to the article's
actual URL. Readability resolves relative image/link URLs against
`document.baseURI`, so insert a `<base>` element into `<head>` **before**
running it:

```js
var base = doc.createElement("base");
base.setAttribute("href", articleUrl);
doc.head.insertBefore(base, doc.head.firstChild);
```

Per the DOM spec, `Node.baseURI` resolves against the first `<base>`
element in document order — this is what makes the anchor-element
resolution trick from Step 2 actually produce correct absolute URLs.

## Step 5: Add your own "is this actually an article" gate

Readability's built-in minimum-content-length check only forces a `null`
return as an *absolute last resort* — non-article pages (video players,
redirects, listing pages) often still come back with *some* short, useless
"content" rather than failing cleanly. Add your own floor on top of
whatever the library gives you (e.g. require the extracted plain-text
length to clear some minimum like 150-300 characters) before treating
extraction as successful, so you can cleanly fall back to a plain
live-page view instead of rendering a near-empty result.

## Step 6: Rendering the result

The extracted content is an HTML **string**. Whatever UI toolkit you're
using almost certainly escapes string content by default when you set it
on a text/label control — you need the control's explicit "treat this as
raw HTML" opt-in (framework-dependent; look for something like
`allowHtml`/`dangerouslySetInnerHTML`/similar). This is exactly why the
sanitize pass in Step 3 matters: whatever you inject this way is trusted by
your own app's chrome.

## Fetch-layer gotcha (unrelated to parsing, but you'll likely hit it too)

If the content source sits behind a WAF/bot-detection layer, an old or
embedded WebKit's outgoing request fingerprint can get blocked outright —
regardless of what headers your own code sets (browsers also forbid
scripts from overriding some headers, like `User-Agent`, entirely, so a
header tweak isn't even on the table). If your app has *any* non-browser
HTTP transport available — a native system HTTP client, a companion
service/daemon, a bundled `curl`, anything that isn't the WebView's own
networking stack — route the fetch through that instead. This is a
separate problem from everything above (it's about the request being
blocked, not about parsing the response), but the two show up together
often enough in this environment that it's worth checking early.

## Debugging without a console

Old/embedded platforms like this typically have no attached devtools
console for a running app. Build a small on-device logger (file-based with
a `localStorage` fallback if filesystem writes aren't reliably available)
before you start debugging failures, not after — and log full stack traces
(`e.stack`, not just `e.message`) on every caught exception. The exact
failing function/line in a caught stack trace is what actually
distinguishes "the parser is fundamentally missing" from "one specific
helper function has one specific bug" — both of which can look identical
from the outside (extraction just silently fails) but need completely
different fixes.

## Testing strategy: verify locally, but don't trust it fully

Before ever deploying to the real device, run the *exact* vendored/patched
file (not a re-implementation) against real-world content using a modern
Node + `jsdom` harness — this is cheap, fast, and catches most logic bugs
(confirms the algorithm itself extracts sensible content, confirms your
sanitize/base-URI logic works, confirms non-article pages correctly fail).

But treat this as a strong signal, not a guarantee. `jsdom` implements
modern DOM/JS behavior faithfully — which means it will happily paper over
exactly the kind of gaps that matter here. Neither the missing
`DOMParser` HTML mode nor the `NodeList`/`for...of` helper bug (Step 2/3
above) showed up in local `jsdom` testing at all; both only appeared on the
real device. Budget for at least one real on-device debugging round-trip
with detailed logging already in place, even after local tests pass clean.

## Summary checklist

- [ ] Vendor Readability (or whatever library), transpiled to ES5 via Babel
      (`preset-env`), output verified syntax-clean by grep + `node --check`
- [ ] Polyfilled whatever ES2015+ built-ins the transpiled file actually
      calls (`Array.from`, `#includes`, `#startsWith`, `#find`, `Set`, ...)
- [ ] Replaced any `new URL()` usage with the anchor-element resolution trick
- [ ] Patched Babel's `_unsupportedIterableToArray` helper if the source has
      any `for...of` loops over DOM collections
- [ ] Parsing raw HTML via a hidden iframe + `document.write()`, not
      `DOMParser` — kept attached until extraction fully completes
- [ ] Iframe sandboxed (`allow-same-origin`, no `allow-scripts`) + raw HTML
      string pre-filtered to strip `<script>` + final DOM-level sanitize on
      the extracted output
- [ ] `<base href>` inserted before running extraction, for correct relative
      URL resolution
- [ ] Own minimum-content-length gate on top of the library's own success
      signal
- [ ] Fetch routed around any WAF/bot-detection blocking the WebView's own
      networking, if applicable
- [ ] On-device logging in place *before* the first real-device test, not
      added reactively after
- [ ] Local `jsdom` test pass done first, real on-device pass budgeted for
      regardless
