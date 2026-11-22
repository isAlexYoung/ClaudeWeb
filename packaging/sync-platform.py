#!/usr/bin/env python3
"""Embed platform.sh into the two standalone entry points; --check never writes."""
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
BEGIN = '# BEGIN GENERATED PLATFORM RULES (packaging/platform.sh)'
END = '# END GENERATED PLATFORM RULES'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    options = parser.parse_args()
    block = BEGIN + '\n' + (ROOT / 'packaging/platform.sh').read_text().rstrip() + '\n' + END
    stale = []
    for target in (ROOT / 'install.sh', ROOT / 'packaging/claudeweb'):
        source = target.read_text()
        start, end = source.index(BEGIN), source.index(END) + len(END)
        expected = source[:start] + block + source[end:]
        if source != expected:
            stale.append(str(target.relative_to(ROOT)))
            if not options.check:
                with target.open('w', newline='\n') as stream:
                    stream.write(expected)
    if stale and options.check:
        print('Run python3 packaging/sync-platform.py: ' + ', '.join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
