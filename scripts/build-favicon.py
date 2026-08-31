"""Packs the rendered mark PNGs into public/favicon.ico.

An .ico is just a small directory of images; every browser in use reads the
PNG-compressed form, which keeps the 256px entry from bloating the file.
Run scripts/render-mark.mjs first to produce the PNGs.
"""
import io, struct, sys, os

SIZES = [16, 24, 32, 48, 64, 128, 256]

def build(src_dir, out):
    images = []
    for n in SIZES:
        with open(os.path.join(src_dir, f"ico-{n}.png"), "rb") as fh:
            images.append((n, fh.read()))
    offset = 6 + 16 * len(images)
    header = struct.pack("<HHH", 0, 1, len(images))
    entries, blobs = b"", b""
    for n, data in images:
        entries += struct.pack(
            "<BBBBHHII", n if n < 256 else 0, n if n < 256 else 0, 0, 0, 1, 32, len(data), offset
        )
        blobs += data
        offset += len(data)
    with open(out, "wb") as fh:
        fh.write(header + entries + blobs)
    print(f"{out}: {len(images)} sizes, {os.path.getsize(out)} bytes")

if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
