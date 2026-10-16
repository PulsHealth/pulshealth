# PulsHealth motion studies

Open `index.html` directly, or serve this directory with any static HTTP server.
It is one self-contained HTML file: inline SVG, CSS, and a small gallery script.
There are no dependencies, fonts to download, data requests, or real health data.
The gallery is a separate experiment; it does not change or deploy the site.

Eighteen studies explore watch-to-phone flows, signals, devices, database sync,
files, summaries, running, routes, and live readings. The devices use restrained
hardware silhouettes and abstract screens. Narrative text lives in captions;
the graphics retain only a few data values and file formats. All loop automatically. A global pause control and
reduced-motion handling are included; offscreen graphics pause to save work.

Colors match the current site's charcoal shell (`#0a0a0a`, `#171717`) and brand
blue (`#4ca9ff`, `#78bdff`). Muted pink, lilac, and mint distinguish health signals.
The original SVG compositions are easy to simplify or recolor using the CSS
variables and the helper functions in the script. No screenshot assets are used.

## Work on one animation

Every tile has a **Save SVG** button that downloads the animation with its CSS
embedded, ready to use as an image or inline vector. The SVG has a transparent
background and includes reduced-motion handling. Every tile also has a **View
alone** link. For example:

- `index.html?scene=watch-phone-archive`
- `index.html?scene=watch-to-phone`
- `index.html?scene=watch-signals`
- `index.html?scene=signal-archive`
- `index.html?scene=signal-files`
- `index.html?scene=phone-archive`
- `index.html?scene=many-phones`
- `index.html?scene=workout-live`

Isolated views use the full viewport and can be embedded in an iframe. Keep the
HTML file alongside an integrating project, or copy the chosen study's SVG
markup, relevant keyframes, and helper definitions into a component. SVG IDs are
prefixed by the study ID so all variants can coexist in the gallery.

`studies` defines each composition, name, description, and group. `phone`,
`watch`, `database`, `file`, `wire`, `runner`, `wave`, and `bars` provide reusable shapes.
Change `--speed` and `--delay` to adjust the flow. Continuous motion is CSS-driven;
there are no JavaScript animation timers or frame loops.
