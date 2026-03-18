#!/usr/bin/env python3
"""Generate simple gold 'F' icons for the Fillr extension."""
import struct
import zlib
import os

def write_png(filename, width, height, pixels):
    """pixels: list of (R,G,B) tuples, row by row."""
    def chunk(type_bytes, data):
        c = type_bytes + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type: None
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += bytes([r, g, b])

    signature = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    idat_data = zlib.compress(raw, 9)

    with open(filename, 'wb') as f:
        f.write(signature)
        f.write(chunk(b'IHDR', ihdr_data))
        f.write(chunk(b'IDAT', idat_data))
        f.write(chunk(b'IEND', b''))


def make_icon_pixels(size):
    bg   = (15, 15, 15)       # #0F0F0F
    gold = (201, 169, 110)    # #C9A96E

    pixels = [bg] * (size * size)

    m  = max(1, size // 6)    # margin
    sw = max(1, size // 8)    # stroke width

    # Vertical bar of "F"
    for y in range(m, size - m):
        for x in range(m, m + sw):
            pixels[y * size + x] = gold

    # Top horizontal bar
    for y in range(m, m + sw):
        for x in range(m, size - m):
            pixels[y * size + x] = gold

    # Middle horizontal bar (slightly shorter)
    mid_y = size // 2 - sw // 2
    for y in range(mid_y, mid_y + sw):
        for x in range(m, size - m - m // 2):
            pixels[y * size + x] = gold

    return pixels


os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    path = f'icons/icon{size}.png'
    write_png(path, size, size, make_icon_pixels(size))
    print(f'Created {path}')
