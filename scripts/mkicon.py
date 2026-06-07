from PIL import Image, ImageDraw

size = 256
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background rounded rect (cyan to green gradient)
draw.rounded_rectangle([(0, 0), (255, 255)], radius=48, fill=(0, 200, 200, 255))

# Green gradient overlay (bottom half)
for y in range(120, 256):
    alpha = int(200 * (1 - (y - 120) / 136))
    if alpha > 0:
        draw.rectangle([(0, y), (255, y)], fill=(0, 200, 0, alpha))

# Microphone icon
cx, cy = 128, 85
draw.rounded_rectangle([(cx-22, cy-35), (cx+22, cy+18)], radius=10, fill=(26, 26, 46, 230))
draw.arc([(cx-28, cy+12), (cx+28, cy+48)], 0, 180, fill=(26, 26, 46, 230), width=5)
draw.rectangle([(cx-2, cy+44), (cx+2, cy+62)], fill=(26, 26, 46, 230))

# Letter M
try:
    from PIL import ImageFont
    font = ImageFont.truetype("arial.ttf", 130)
except:
    font = ImageFont.load_default()
draw.text((128, 170), "M", fill=(26, 26, 46, 230), font=font, anchor="mm")

# Save as .ico with multiple sizes
sizes = [(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)]
icons = [img.resize(s, Image.LANCZOS) for s in sizes]

outpath = r"C:\Users\user\Desktop\Mimico\assets\icon.ico"
img.save(outpath, format='ICO', sizes=sizes, append_images=icons[1:])
print(f"Icon saved: {outpath}")

png_path = r"C:\Users\user\Desktop\Mimico\assets\icon.png"
img.save(png_path, 'PNG')
print(f"PNG saved: {png_path}")
