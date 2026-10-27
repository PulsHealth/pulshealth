"""Render an illustrative averaging example; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
im = Image.new('RGB', (1600, 1000), '#101d2b')
d = ImageDraw.Draw(im)
fonts = Path('/System/Library/Fonts/Supplemental')
def f(size, bold=False):
    p = fonts / ('Arial Bold.ttf' if bold else 'Arial.ttf')
    return ImageFont.truetype(str(p) if p.exists() else ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'), size)
def t(x,y,text,size=28,color='#b5c4d2',bold=False):
    d.text((x,y), text, font=f(size,bold), fill=color)
teal='#73ddd0';amber='#f2bd76';white='#f6f3ec';panel='#1b2c3e'
t(80,55,'PULSHEALTH  /  READING AN HRV SUMMARY',24,teal,True)
t(80,110,'Same readings. Two different means.',53,white,True)
t(80,190,'An illustrative example: one 20 ms reading on Monday; nine 60 ms readings on Tuesday.',29)
d.rounded_rectangle((80,270,1520,460),radius=20,fill=panel)
for i,value in enumerate([20]+[60]*9):
    x=150+i*137; color=amber if i==0 else teal
    d.ellipse((x-40,305,x+40,385),fill=color)
    t(x-23,325,str(value),32,'#101d2b',True)
t(108,411,'Mon',25,amber,True)
t(850,411,'Tuesday',25,teal,True)
for x,kicker,num,label,formula in [(80,'EVERY OBSERVATION GETS ONE VOTE','56','ms','(20 + 9 × 60) ÷ 10'),(830,'EVERY RECORDED DAY GETS ONE VOTE','40','ms','(20 + 60) ÷ 2')]:
    d.rounded_rectangle((x,510,x+690,865),radius=20,fill=panel)
    t(x+35,550,kicker,25,teal,True)
    t(x+35,605,num,112,white,True)
    t(x+180,672,label,36)
    t(x+35,785,formula,35,white)
d.line((80,916,1520,916),fill='#3c5368',width=2)
t(80,948,'ILLUSTRATIVE VALUES  ·  Arithmetic only; this does not reproduce Apple Health’s chart calculation.',23)
im.save(HERE/'same-readings-two-means.webp',quality=94,method=6)
