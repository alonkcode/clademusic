"""Generates the Clade mark: a C whose branches radiate like a neuron.

One geometry, three outputs -- the monochrome mark, the full-colour logo and
the favicon -- so the three can never drift apart. Coordinates are hand-placed
on a 100x100 grid: the ring sits at (50,42), a stem drops from it into a cradle
at the foot, and six branches leave the ring and end in dots.

    python scripts/gen-logo.py            # rewrite the SVGs
    node scripts/render-mark.mjs '[...]'  # rasterise them
    python scripts/build-favicon.py <dir> public/favicon.ico
"""
import io
import math

INK = "#111111"
DARK = "#2A2140"

CX, CY = 50.0, 42.0

# The ring is a C, open to the right between -25 and 25 degrees.
RING = "M61.78,36.51 A13,13 0 1 0 61.78,47.49"
STEM = "M50,55 L50,74"
CRADLE = "M41.14,81.56 A9,9 0 1 0 58.86,81.56"
CRADLE_DOT = (50, 80, 4.6)

# Six branches as (path, dot centre), mirrored about x=50. The upper pair runs
# straight out on the diagonal; the side and lower pairs bow outwards so the
# mark reads as a spray rather than a wheel.
BRANCHES = [
    ("M40.1,32.1 L30.4,23", (29.9, 22.5)),
    ("M59.9,32.1 L69.6,23", (70.1, 22.5)),
    ("M36.6,45.4 C30.5,48 24,44.5 18.3,41", (17.5, 40.6)),
    ("M63.4,45.4 C69.5,48 76,44.5 81.7,41", (82.5, 40.6)),
    ("M47.5,55 C41,61.5 29,64.5 18.7,60.2", (17.9, 59.9)),
    ("M52.5,55 C59,61.5 71,64.5 81.3,60.2", (82.1, 59.9)),
]
DOT_R = 5.0
W_RING, W_STEM, W_BRANCH = 6.4, 4.6, 4.2

# The spectrum sweeps anticlockwise from the lower right, so the colour of any
# spoke follows from its angle alone and the logo never looks shuffled.
SPECTRUM = [
    "#1B6AC9", "#3AA0E8", "#22B3A0", "#5BB947", "#B5C82E",
    "#FFD200", "#F58220", "#E33127", "#D6218F", "#7A2FA8",
]
SPREAD = (-30.0, 210.0)   # angles the spectrum is stretched across


def angle_of(x, y):
    a = math.degrees(math.atan2(CY - y, x - CX))
    return a + 360 if a < SPREAD[0] else a   # keep the sweep unbroken


def hue(a):
    lo, hi = SPREAD
    t = min(1.0, max(0.0, (a - lo) / (hi - lo)))
    return SPECTRUM[round(t * (len(SPECTRUM) - 1))]


def mark(ink, dot_fill, colour=False, cls=""):
    """The letterform plus its branches, in one colour or across the spectrum."""
    c = ' class="%s"' % cls if cls else ""
    w_ring, w_stem, w_branch, dot_r = W_RING, W_STEM, W_BRANCH, DOT_R
    out = [
        '  <g%s fill="none" stroke="%s" stroke-linecap="round">' % (c, ink),
        '    <path d="%s" stroke-width="%.2f" />' % (RING, w_ring),
        '    <path d="%s" stroke-width="%.2f" />' % (STEM, w_stem),
        '    <path d="%s" stroke-width="%.2f" />' % (CRADLE, w_branch),
        "  </g>",
    ]
    for path, (dx, dy) in BRANCHES:
        col = hue(angle_of(dx, dy)) if colour else ink
        klass = "" if colour else c
        out.append(
            '  <g%s fill="%s" stroke="%s" stroke-width="%s" stroke-linecap="round">\n'
            '    <path d="%s" fill="none" />\n'
            '    <circle cx="%s" cy="%s" r="%s" stroke="none" />\n'
            "  </g>" % (klass, col, col, w_branch, path, dx, dy, dot_r)
        )
    x, y, r = CRADLE_DOT
    out.append(
        '  <circle%s cx="%s" cy="%s" r="%.2f" fill="%s" />'
        % ("" if colour else c, x, y, r, dot_fill)
    )
    return "\n".join(out)


def filaments():
    """Thin circuit traces fanning out behind the branches, logo only."""
    out = []
    for i, a in enumerate(range(-46, 226, 8)):
        if any(abs(a - b) < 7 for b in (-29, -2, 44, 136, 182, 209)):
            continue
        col = hue(a)
        r0, r1 = 18.0, 27.0 + 3.5 * (i % 3)
        rad = math.radians(a)
        elbow = math.radians(a + (7 if i % 2 else -7))
        sx, sy = CX + r0 * math.cos(rad), CY - r0 * math.sin(rad)
        mx, my = CX + (r1 - 6) * math.cos(rad), CY - (r1 - 6) * math.sin(rad)
        ex, ey = CX + r1 * math.cos(elbow), CY - r1 * math.sin(elbow)
        out.append(
            '  <g fill="%s" stroke="%s" stroke-width="1.2" stroke-linecap="round">\n'
            '    <path d="M%.1f,%.1f L%.1f,%.1f L%.1f,%.1f" fill="none" />\n'
            '    <circle cx="%.1f" cy="%.1f" r="1.8" stroke="none" />\n'
            "  </g>" % (col, col, sx, sy, mx, my, ex, ey, ex, ey)
        )
    return "\n".join(out)


def head(box):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" role="img" aria-label="Clade">\n'
        "  <title>Clade</title>\n" % box
    )


def write(path, body, style="", box="0 0 100 100"):
    io.open(path, "w", encoding="utf-8", newline="\n").write(head(box) + style + body + "\n</svg>\n")
    print("wrote", path)


# The icon is a white mark on a black disc: it keeps its own contrast on any
# tab strip, light or dark, instead of vanishing into one of them. The mark
# is scaled about its own centre (50,55) so it sits inside the disc.
BADGE = '  <circle cx="50" cy="50" r="50" fill="#0B0B12" />\n'
BADGE_FIT = '  <g transform="translate(50,50) scale(0.78) translate(-50,-55)">\n%s\n  </g>'

def to_jsx(svg):
    """Rewrite the SVG fragment's attributes into the names React expects."""
    for a, b in (
        ("stroke-width=", "strokeWidth="),
        ("stroke-linecap=", "strokeLinecap="),
        ("aria-label=", "aria-label="),
    ):
        svg = svg.replace(a, b)
    return svg


def write_component(path):
    """A React component so the mark's ink can follow the surrounding text
    colour -- the site is dark, and a fixed dark ink disappears into it."""
    body = "\n".join("      " + ln.lstrip() if ln.strip() else ln for ln in mark("currentColor", "currentColor", colour=True).split("\n"))
    fil = "\n".join("        " + ln.lstrip() if ln.strip() else ln for ln in filaments().split("\n"))
    src = (
        "// Generated by scripts/gen-logo.py -- edit the geometry there, not here.\n"
        "\n"
        "/**\n"
        " * The Clade mark: branches in the brand spectrum, letterform in\n"
        " * `currentColor` so it takes the ink of whatever it sits in.\n"
        " *\n"
        " * `filaments` adds the fine circuit traces from the full logo; they are\n"
        " * noise below about 64px, so they stay off by default.\n"
        " */\n"
        "export function CladeMark({\n"
        "  className,\n"
        "  filaments = false,\n"
        "  label,\n"
        "}: {\n"
        "  className?: string;\n"
        "  filaments?: boolean;\n"
        "  label?: string;\n"
        "}) {\n"
        "  return (\n"
        '    <svg\n'
        '      viewBox="0 0 100 100"\n'
        "      className={className}\n"
        '      role="img"\n'
        "      aria-label={label}\n"
        "      aria-hidden={label ? undefined : true}\n"
        '      focusable="false"\n'
        "    >\n"
        "      {filaments && (\n"
        "        <g>\n"
        "%s\n"
        "        </g>\n"
        "      )}\n"
        "%s\n"
        "    </svg>\n"
        "  );\n"
        "}\n"
    ) % (to_jsx(fil), to_jsx(body))
    io.open(path, "w", encoding="utf-8", newline="\n").write(src)
    print("wrote", path)


write("public/clade-mark-mono.svg", mark("currentColor", "currentColor"))
write("public/clade-logo.svg", filaments() + "\n" + mark(DARK, "#7A2FA8", colour=True))
write("public/favicon.svg", BADGE + BADGE_FIT % mark("#FFFFFF", "#FFFFFF"))
write_component("src/components/CladeMark.tsx")
