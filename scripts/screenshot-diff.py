#!/usr/bin/env python3
"""
Visuele regressie: vergelijkt twee uitvoermappen van scripts/mobile-audit.mjs
(bv. main vs. feature-branch) per scherm op afwijkende pixels.

Gebruik:
  AUDIT_OUT=/tmp/shots-main   node scripts/mobile-audit.mjs   # op main
  AUDIT_OUT=/tmp/shots-branch node scripts/mobile-audit.mjs   # op de branch
  python3 scripts/screenshot-diff.py /tmp/shots-main /tmp/shots-branch [drempel%]

Vereist Pillow (pip install pillow). Schermen boven de drempel krijgen '!!'.
Tip: VISUEEL_DESKTOP=1 VISUEEL_ALLE_THEMAS=1 voor desktop + alle thema's.
"""
import glob, os, sys
try:
    from PIL import Image, ImageChops
except ImportError:
    sys.exit('Pillow ontbreekt: pip install pillow')

base, new = sys.argv[1], sys.argv[2]
drempel = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
rijen = []
for f in sorted(glob.glob(os.path.join(base, '*.png'))):
    n = os.path.basename(f); g = os.path.join(new, n)
    if not os.path.exists(g):
        rijen.append((n, None, None)); continue
    a = Image.open(f).convert('RGB'); b = Image.open(g).convert('RGB')
    w, h = min(a.width, b.width), min(a.height, b.height)
    d = ImageChops.difference(a.crop((0, 0, w, h)), b.crop((0, 0, w, h))).convert('L').point(lambda p: 255 if p > 24 else 0)
    pct = 100.0 * sum(1 for p in d.getdata() if p) / (w * h)
    rijen.append((n, pct, d.getbbox()))
for n, pct, bbox in sorted(rijen, key=lambda r: -(r[1] or 0)):
    if pct is None:
        print(f'{n:55s} ONTBREEKT in {new}'); continue
    print(f"{'!!' if pct > drempel else '  '} {n:55s} {pct:6.2f}%  bbox={bbox}")
