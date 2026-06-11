import json
import math
from PIL import Image, ImageDraw, ImageFont

data = json.load(open("scripts/templates.json", encoding="utf-8"))

COLS = 5
CELL = 340
rows = math.ceil(len(data) / COLS)
img = Image.new("RGB", (COLS * CELL, rows * CELL), "#f5f6f8")
d = ImageDraw.Draw(img)

for idx, t in enumerate(data):
    cx0 = (idx % COLS) * CELL
    cy0 = (idx // COLS) * CELL
    pts = t["pylons"] + [{"x": p["x"], "y": p["y"]} for p in t["route"]]
    xs = [p["x"] for p in pts]
    ys = [p["y"] for p in pts]
    span = max(max(xs) - min(xs), max(ys) - min(ys), 1) + 2
    scale = (CELL - 50) / span
    mx = (max(xs) + min(xs)) / 2
    my = (max(ys) + min(ys)) / 2

    def tr(p):
        return (cx0 + CELL / 2 + (p["x"] - mx) * scale, cy0 + CELL / 2 + (p["y"] - my) * scale)

    d.rectangle([cx0, cy0, cx0 + CELL - 1, cy0 + CELL - 1], outline="#d0d5db")
    # Route (blau) mit Richtungspfeilen
    route = [tr(p) for p in t["route"]]
    if len(route) > 1:
        d.line(route, fill="#2563eb", width=3)
        for k in range(0, len(route) - 1, max(1, len(route) // 5)):
            x0, y0 = route[k]
            x1, y1 = route[k + 1]
            ang = math.atan2(y1 - y0, x1 - x0)
            ax, ay = x1, y1
            for da in (2.6, -2.6):
                d.line([ax, ay, ax + 9 * math.cos(ang + da), ay + 9 * math.sin(ang + da)], fill="#2563eb", width=3)
        sx, sy = route[0]
        d.ellipse([sx - 6, sy - 6, sx + 6, sy + 6], fill="#16a34a")  # Start grün
    # Pylonen
    for p in t["pylons"]:
        x, y = tr(p)
        if p.get("lying"):
            a = math.radians(p.get("angle", 0))
            tip = (x + 10 * math.cos(a), y + 10 * math.sin(a))
            b1 = (x + 7 * math.cos(a + 2.5), y + 7 * math.sin(a + 2.5))
            b2 = (x + 7 * math.cos(a - 2.5), y + 7 * math.sin(a - 2.5))
            d.polygon([tip, b1, b2], fill="#f97316")
        else:
            s = max(3, 0.28 * scale / 2)
            d.rectangle([x - s, y - s, x + s, y + s], fill="#f97316")
    d.text((cx0 + 10, cy0 + 8), t["name"], fill="#16181d")

img.save("scripts/templates_overview.png")
print("saved scripts/templates_overview.png")
