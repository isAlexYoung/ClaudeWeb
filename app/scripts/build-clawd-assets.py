"""Builds ClaudeWeb's Clawd animations from the Clawd 400 GIFs.

Clawd 400 by 风花叶 — CC BY 4.0 — https://github.com/khiqwq/clawd-400

Each GIF is a 40x40 pixel drawing scaled 12x. This script reads every frame
(with GIF disposal applied), checks that each 12x12 block is one colour, and
writes the 40x40 frames side by side as one PNG strip per animation, plus a
catalog with the names, theme and per-frame durations. The browser draws the
strip on a canvas, so the 25 MB of GIFs become about 0.5 MB.

Usage (Pillow required):
    python app/scripts/build-clawd-assets.py <clawd-400 checkout or zip> <index.json>

`index.json` is the gallery catalog (https://khiqwq.github.io/clawd-400/api/index.json);
it supplies the Chinese and English names and the theme of each animation.
"""

import io
import json
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageSequence

SCALE = 12
SIZE = 40
ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / 'public' / 'clawd'
CATALOG = ROOT / 'src' / 'modules' / 'clawd' / 'data' / 'clawd-catalog.json'
NAME = re.compile(r'(?:^|/)gifs/(\d{3})_([a-z0-9_]+)\.gif$')


def gif_sources(source: Path):
    """Yields (number, slug, bytes) for every gifs/NNN_slug.gif in a checkout or a zip of one."""
    if source.is_dir():
        for path in sorted(source.glob('gifs/*.gif')):
            match = NAME.search(path.as_posix())
            if match:
                yield int(match[1]), match[2], path.read_bytes()
        return
    with zipfile.ZipFile(source) as archive:
        for name in sorted(archive.namelist()):
            match = NAME.search(name)
            if match:
                yield int(match[1]), match[2], archive.read(name)


def frames_of(data: bytes):
    """The animation's frames at 40x40 (RGBA) and their durations, failing on anything not a clean 12x scale."""
    image = Image.open(io.BytesIO(data))
    if image.size != (SIZE * SCALE, SIZE * SCALE):
        raise ValueError(f'unexpected size {image.size}')
    frames, durations = [], []
    for frame in ImageSequence.Iterator(image):
        rgba = frame.convert('RGBA')
        small = rgba.resize((SIZE, SIZE), Image.Resampling.NEAREST, reducing_gap=None)
        # Nearest sampling picks one pixel per block; scaling back must give the frame again.
        if small.resize(rgba.size, Image.Resampling.NEAREST).tobytes() != rgba.tobytes():
            raise ValueError('a frame is not a clean 12x scale of a 40x40 drawing')
        # Fully transparent pixels keep no colour, so equal frames compare equal.
        pixels = [(0, 0, 0, 0) if a == 0 else (r, g, b, a) for r, g, b, a in small.getdata()]
        clean = Image.new('RGBA', (SIZE, SIZE))
        clean.putdata(pixels)
        frames.append(clean)
        durations.append(int(frame.info.get('duration', 100)) or 100)
    return frames, durations


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, index_path = Path(sys.argv[1]), Path(sys.argv[2])
    index = json.loads(index_path.read_text(encoding='utf-8'))
    named = {item['n']: item for item in index.get('items', [])}
    if len(named) != 400:
        raise SystemExit(f'the index lists {len(named)} animations, not 400')
    SHEETS.mkdir(parents=True, exist_ok=True)
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    catalog = []
    for number, slug, data in gif_sources(source):
        frames, durations = frames_of(data)
        info = named.get(number, {})
        if info and info.get('slug') != slug:
            raise ValueError(f'{number}: index says {info.get("slug")}, file says {slug}')
        if info and info.get('frames') not in (None, len(frames)):
            raise ValueError(f'{number}: index says {info.get("frames")} frames, the GIF has {len(frames)}')
        strip = Image.new('RGBA', (SIZE * len(frames), SIZE))
        for i, frame in enumerate(frames):
            strip.paste(frame, (i * SIZE, 0))
        strip.save(SHEETS / f'{number:03d}.png', optimize=True)
        catalog.append({
            'n': number, 'slug': slug, 'zh': info.get('zh', slug), 'en': info.get('en', slug.replace('_', ' ')),
            'theme': info.get('theme', ''), 'd': durations,
        })
    if len(catalog) != 400:
        raise SystemExit(f'expected 400 animations, found {len(catalog)}')
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    total = sum(path.stat().st_size for path in SHEETS.glob('*.png'))
    print(f'{len(catalog)} animations, {total // 1024} KB of sheets, catalog {CATALOG.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
