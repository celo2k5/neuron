# Neuron brand kit

**Mark.** Three dendrites leave their input nodes and converge on one lit soma: a neuron
summing its inputs. It is the site's own idea, *intelligence is a network*, at its smallest.

**Banners.** The network in every banner is not an illustration. It is a real NEURON model
(sparse, seed `neuronai.online`, 9→18→26→22→12→1, artifact `1b449ad5d53e…`) laid out with the app's
CONSTELLATION form. Edge brightness is the actual |w·a| signal from one forward pass, converging on its single output neuron.

| colour | hex | use |
| --- | --- | --- |
| Obsidian | `#080B12` | backgrounds |
| Obsidian raised | `#0F1628` | tiles, surfaces |
| Signal blue | `#4D8DFF` | dendrites, input nodes |
| Synapse cyan | `#8BE9FF` | glow, the soma's halo |
| Soma white | `#EEF4FF` | soma, text on dark |

Type: **Newsreader** 400/500 (wordmark, headlines), **Geist** (body), **Geist Mono** (domain, hashes).

| folder | contents |
| --- | --- |
| `logo/` | mark (colour, black, white) and horizontal lockups (on dark, on light, black, white), as SVG + PNG |
| `icons/` | favicon.svg/.ico (16/32/48), apple-touch-icon 180, PWA 192/512, maskable 512, app icon SVG |
| `social/` | X header (3000×1000 and 1500×500), link preview 1200×630 (and 2×), GitHub social 1280×640, avatar 400 |
| `src/` | generators: `node build.mjs && node png.mjs` (needs `@fontsource/newsreader`, `@fontsource/geist-sans`, `@fontsource/geist-mono`, `opentype.js`) |

Clear space around the mark: the soma's diameter. Smallest size: 16 px (use `icons/favicon.svg`, whose heavier strokes hold up there).
On the X header, the avatar covers the bottom-left, which is why the type sits on the right.
