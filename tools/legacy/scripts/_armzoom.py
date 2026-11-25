from PIL import Image, ImageDraw, ImageFont
import os
d = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks\ghost"
S = 24
names = ["ghost_piston_arm1","ghost_piston_arm2","ghost_piston_plate_side"]
W = len(names)*(16*S+16)+16; H = 16*S+60
out = Image.new("RGBA",(W,H),(250,250,252,255)); dr=ImageDraw.Draw(out)
f=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",13)
for i,n in enumerate(names):
    im=Image.open(os.path.join(d,n+".png")).convert("RGBA")
    big=im.resize((16*S,16*S), Image.NEAREST)
    x=16+i*(16*S+16); y=40
    for by in range(0,16*S,12):
        for bx in range(0,16*S,12):
            if ((bx//12)+(by//12))%2==0: dr.rectangle([x+bx,y+by,x+bx+12,y+by+12], fill=(226,226,230,255))
    out.alpha_composite(big,(x,y))
    dr.text((x,y-18), n.replace("ghost_piston_",""), font=f, fill=(30,30,40,255))
# 画参考线：每 4px 一格
for i,n in enumerate(names):
    x=16+i*(16*S+16); y=40
    for k in range(0,17,4):
        dr.line([x+k*S, y, x+k*S, y+16*S], fill=(255,0,0,90))
        dr.line([x, y+k*S, x+16*S, y+k*S], fill=(0,0,255,90))
out.save(r"D:\GitHub\LitematicaBE\work\render\piston_arm_zoom.png")
print("saved", out.size)
