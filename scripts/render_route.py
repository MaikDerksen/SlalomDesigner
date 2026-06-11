import json
import math
from PIL import Image, ImageDraw

d = json.load(open("scripts/route_test.json", encoding="utf-8"))
SCALE = 24
W = int(d["map"]["width"] * SCALE)
H = int(d["map"]["height"] * SCALE)
img = Image.new("RGB", (W, H), "#e2e5e9")
dr = ImageDraw.Draw(img)

def tr(p):
    return (p["x"] * SCALE, p["y"] * SCALE)

for x in range(0, int(d["map"]["width"]) + 1, 5):
    dr.line([(x * SCALE, 0), (x * SCALE, H)], fill="#cfd5db")
for y in range(0, int(d["map"]["height"]) + 1, 5):
    dr.line([(0, y * SCALE), (W, y * SCALE)], fill="#cfd5db")

route = [tr(p) for p in d["route"]]
dr.line(route, fill="#ffffff", width=11)
dr.line(route, fill="#0ea5e9", width=5)
for k in range(14, len(route) - 2, 18):
    x0, y0 = route[k]
    x1, y1 = route[k + 2]
    ang = math.atan2(y1 - y0, x1 - x0)
    for da in (2.6, -2.6):
        dr.line([x1, y1, x1 + 11 * math.cos(ang + da), y1 + 11 * math.sin(ang + da)], fill="#0369a1", width=4)

for o in d["obstacles"]:
    for p, ly in zip(o["pylons"], o["lying"]):
        x, y = tr(p)
        s = 3.5
        col = "#f97316"
        if ly:
            dr.ellipse([x - s, y - s, x + s, y + s], outline=col, width=2)
        else:
            dr.rectangle([x - s, y - s, x + s, y + s], fill=col)
    bx, by = o["x"] * SCALE, o["y"] * SCALE
    dr.ellipse([bx - 11, by - 11, bx + 11, by + 11], fill="#16181d")
    dr.text((bx - 4, by - 7), str(o["n"]), fill="#fff")

for c in d["crossings"]:
    x, y = tr(c)
    dr.ellipse([x - 8, y - 8, x + 8, y + 8], outline="#7c3aed", width=3)

for w in d["warnings"]:
    x, y = tr(w["p"])
    dr.ellipse([x - 9, y - 9, x + 9, y + 9], fill="#d92d20")
    dr.text((x - 3, y - 7), "!", fill="#fff")

sx, sy = route[0]
dr.ellipse([sx - 10, sy - 10, sx + 10, sy + 10], fill="#16a34a")
img.save("scripts/route_test.png")
print("saved scripts/route_test.png")
