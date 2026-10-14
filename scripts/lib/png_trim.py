#!/usr/bin/env python3
"""Trim transparent padding from an 8-bit RGBA PNG using only the stdlib.

Store tiles carry a wide transparent safe area that makes them look tiny as a
Steam library icon. SteamOS ships python3 but not Pillow or ImageMagick, so
this decodes, crops and re-encodes the PNG by hand.

usage: png_trim.py IN.png OUT.png [margin_px]
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, header = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    width, height, depth, color, _, _, interlace = header
    if depth != 8 or color != 6 or interlace:
        raise ValueError("only non-interlaced 8-bit RGBA PNGs are supported")
    raw = zlib.decompress(idat)
    stride, bpp = width * 4, 4
    rows, prev = [], bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        ftype, line = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else b if pb <= pc else c
                line[i] = (line[i] + pred) & 0xFF
        rows.append(line)
        prev = line
    return width, height, rows


def write_png(path, width, height, rows):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n")
        fh.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        fh.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        fh.write(chunk(b"IEND", b""))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    margin = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    width, height, rows = read_png(src)
    xs, ys = [], []
    for y, row in enumerate(rows):
        for x in range(width):
            if row[x * 4 + 3] > 8:
                xs.append(x)
                ys.append(y)
    if not xs:
        write_png(dst, width, height, rows)
        return
    # Square crop around the opaque content, centred, plus a margin.
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    side = max(max(xs) - min(xs), max(ys) - min(ys)) + 1 + 2 * margin
    x0, y0 = int(round(cx - side / 2)), int(round(cy - side / 2))
    out = []
    for y in range(y0, y0 + side):
        line = bytearray(side * 4)
        if 0 <= y < height:
            for x in range(x0, x0 + side):
                if 0 <= x < width:
                    line[(x - x0) * 4:(x - x0) * 4 + 4] = rows[y][x * 4:x * 4 + 4]
        out.append(line)
    write_png(dst, side, side, out)


if __name__ == "__main__":
    main()
