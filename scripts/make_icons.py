"""App-Icon aufbereiten: zuschneiden, Ecken transparent runden, Größen erzeugen."""
from PIL import Image, ImageDraw

SRC = r"C:\Users\mderksen\Downloads\ChatGPT Image 12. Juni 2026, 08_45_08.png"

img = Image.open(SRC).convert("RGBA")
w, h = img.size

# Auf das abgerundete Quadrat zuschneiden (ChatGPT lässt ~8,5 % Rand)
m = int(w * 0.085)
img = img.crop((m, m, w - m, h - m))
s = img.size[0]

# iOS-typische Eckenrundung (~22 %) als Alphamaske
mask = Image.new("L", (s, s), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
rounded = img.copy()
rounded.putalpha(mask)

OUT = r"C:\Users\mderksen\IdeaProjects\KartSlalomCircut\public"
rounded.resize((512, 512), Image.LANCZOS).save(f"{OUT}/icon-512.png")
rounded.resize((192, 192), Image.LANCZOS).save(f"{OUT}/icon-192.png")
rounded.resize((64, 64), Image.LANCZOS).save(f"{OUT}/favicon.png")
# Apple Touch Icon: iOS rundet selbst -> quadratisch und deckend
img.resize((180, 180), Image.LANCZOS).convert("RGB").save(f"{OUT}/apple-touch-icon.png")
print("icons written")
