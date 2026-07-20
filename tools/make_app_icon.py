from PIL import Image
from collections import deque
from pathlib import Path

src = Path(
    r"C:\Users\USER\.cursor\projects\e-Codes-SLMSurvey\assets"
    r"\c__Users_USER_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"1e8d5c3d7d1e67dd7ba12aab79cba386_images_icon-5da61f30-6357-473c-91b2-b594eeaac1cb.png"
)
res = Path(r"E:\Codes\SLMSurvey\app\src\main\res")
work = Path(r"E:\Codes\SLMSurvey\tools")
work.mkdir(exist_ok=True)

img = Image.open(src).convert("RGBA")
w, h = img.size
px = img.load()
print("size", w, h)

THRESH = 35


def is_bg(c):
    r, g, b, a = c
    return a < 10 or (r <= THRESH and g <= THRESH and b <= THRESH)


visited = [[False] * w for _ in range(h)]
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if is_bg(px[x, y]):
            q.append((x, y))
            visited[y][x] = True
for y in range(h):
    for x in (0, w - 1):
        if not visited[y][x] and is_bg(px[x, y]):
            q.append((x, y))
            visited[y][x] = True

while q:
    x, y = q.popleft()
    px[x, y] = (0, 0, 0, 0)
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and is_bg(px[nx, ny]):
            visited[ny][nx] = True
            q.append((nx, ny))

bbox = img.getbbox()
print("bbox", bbox)
cropped = img.crop(bbox)
cw, ch = cropped.size
print("cropped", cw, ch)

master = work / "slm_icon_transparent.png"
cropped.save(master)
print("saved", master)

# Square canvas with transparent padding for launcher icons
side = max(cw, ch)
pad = int(side * 0.08)
canvas_side = side + pad * 2
square = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
square.paste(cropped, ((canvas_side - cw) // 2, (canvas_side - ch) // 2), cropped)

# Density sizes for legacy launcher icons
sizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

for folder, size in sizes.items():
    out_dir = res / folder
    out_dir.mkdir(parents=True, exist_ok=True)
    icon = square.resize((size, size), Image.Resampling.LANCZOS)

    # Round variant: circular mask
    round_icon = icon.copy()
    mask = Image.new("L", (size, size), 0)
    from PIL import ImageDraw

    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    round_rgba = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    round_rgba.paste(icon, (0, 0))
    round_rgba.putalpha(mask)

    # Prefer PNG; remove old webp if present
    for name, im in (("ic_launcher", icon), ("ic_launcher_round", round_rgba)):
        png_path = out_dir / f"{name}.png"
        webp_path = out_dir / f"{name}.webp"
        im.save(png_path, format="PNG")
        if webp_path.exists():
            webp_path.unlink()
        print("wrote", png_path)

# Adaptive icon foreground (108dp @ xxxhdpi = 432px), keep safe zone padding
fg_size = 432
fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
# Safe content roughly center 66/108 of canvas
safe = int(fg_size * 0.72)
art = square.resize((safe, safe), Image.Resampling.LANCZOS)
fg.paste(art, ((fg_size - safe) // 2, (fg_size - safe) // 2), art)
fg_path = res / "drawable" / "ic_launcher_foreground.png"
fg.save(fg_path)
print("wrote", fg_path)

print("done")
