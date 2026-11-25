from PIL import Image, ImageDraw, ImageFont
import os
d = r"D:\GitHub\LitematicaBE\resources\addon\LitematicaBE_RP\textures\blocks\ghost"
names = ["ghost_piston_side","ghost_piston_top_normal","ghost_piston_top_sticky","ghost_piston_bottom",
         "ghost_piston_inner","ghost_piston_plate_side","ghost_piston_arm1","ghost_piston_arm2"]
S=10; pad=8
W = len(names)*(16*S+pad)+pad; H = 16*S+pad*2+20
out = Image.new("RGBA",(W,H),(250,250,252,255)); dr=ImageDraw.Draw(out)
f=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",11)
for i,n in enumerate(names):
    im=Image.open(os.path.join(d,n+".png")).convert("RGBA")
    big=im.resize((16*S,16*S), Image.NEAREST)
    x=pad+i*(16*S+pad); y=pad+20
    # 棋盘底，便于看透明
    for by in range(0,16*S,8):
        for bx in range(0,16*S,8):
            if ((bx//8)+(by//8))%2==0: dr.rectangle([x+bx,y+by,x+bx+8,y+by+8], fill=(228,228,232,255))
    out.alpha_composite(big,(x,y))
    dr.text((x,y-14), n.replace("ghost_piston_",""), font=f, fill=(30,30,40,255))
out.save(r"D:\GitHub\LitematicaBE\work\render\piston_tex_16.png")
print("saved", out.size)
