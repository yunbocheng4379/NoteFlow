"""Generate TabBar icons as simple PNG files using built-in Python libraries."""
import struct, zlib, os

def create_png(width, height, color, filename):
    """Create a simple solid-color PNG with rounded-circle style."""
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xFFFFFFFF)

    # Create pixel data
    raw_data = b''
    cx, cy, r = width//2, height//2, width//2 - 8  # Circle radius
    
    for y in range(height):
        raw_data += b'\x00'  # Filter byte
        for x in range(width):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            if dist <= r:
                raw_data += bytes(color) + b'\xFF'  # RGBA
            else:
                raw_data += b'\x00\x00\x00\x00'  # Transparent

    # Build PNG
    header = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    idat = make_chunk(b'IDAT', zlib.compress(raw_data))
    iend = make_chunk(b'IEND', b'')

    with open(filename, 'wb') as f:
        f.write(header + ihdr + idat + iend)

# Define icons
icons = [
    ('home', (153, 153, 153), '#999999', 'images/tab'),
    ('home-active', (55, 138, 221), '#378ADD', 'images/tab'),
    ('note', (153, 153, 153), '#999999', 'images/tab'),
    ('note-active', (55, 138, 221), '#378ADD', 'images/tab'),
    ('profile', (153, 153, 153), '#999999', 'images/tab'),
    ('profile-active', (55, 138, 221), '#378ADD', 'images/tab'),
]

base = '/Users/Zhuanz/Documents/prank/BiliNote/noteflow-miniprogram'
for name, color, _, subdir in icons:
    path = os.path.join(base, subdir)
    os.makedirs(path, exist_ok=True)
    create_png(81, 81, color, os.path.join(path, f'{name}.png'))

print('Generated 6 TabBar icons')
