#!/usr/bin/env python3
"""Make small card images for each NPS thing-to-do.

NPS serves the original uploads (often 10+ MB), far too heavy for a homepage strip.
This downloads each image once, saves a 640px JPEG to assets/things/<id>.jpg, and
records the local path in data/things.json. Existing thumbnails are skipped.

Usage: python3 scripts/thumbs.py   (needs Pillow: pip install pillow)
"""
import io, json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "things.json")
OUT = os.path.join(ROOT, "assets", "things")

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

os.makedirs(OUT, exist_ok=True)
d = json.load(open(DATA))
changed = 0
for it in d["items"]:
    img = it.get("image")
    if not img:
        continue
    rel = f"assets/things/{it['id']}.jpg"
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(img["url"], headers={"User-Agent": "BadlandsToday/1.0 (badlandstoday.labs.trlibrary.com)"})
            raw = urllib.request.urlopen(req, timeout=60).read()
            im = Image.open(io.BytesIO(raw)).convert("RGB")
            im.thumbnail((640, 640))
            im.save(path, "JPEG", quality=78, optimize=True, progressive=True)
            print("saved", rel, im.size)
        except Exception as e:  # keep going; the widget falls back to the NPS URL
            print("skip", it["title"], e)
            continue
    if img.get("thumb") != rel:
        img["thumb"] = rel
        changed += 1
if changed:
    json.dump(d, open(DATA, "w"), indent=1)
print(f"{changed} records updated")
