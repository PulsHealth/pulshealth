"""Render original explanatory figures. Requires Pillow; run from any directory."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
BG='#101d2b'; PANEL='#1b2c3e'; TEXT='#f6f3ec'; MUTED='#b5c4d2'; TEAL='#73ddd0'; AMBER='#f2bd76'; LINE='#3c5368'
FONT=Path('/System/Library/Fonts/Supplemental')
def font(n,bold=False):
    candidate=FONT/('Arial Bold.ttf' if bold else 'Arial.ttf')
    return ImageFont.truetype(str(candidate) if candidate.exists() else ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'), n)
def base(kicker,title,subtitle):
    im=Image.new('RGB',(1600,1000),BG); d=ImageDraw.Draw(im)
    d.text((80,58),kicker,font=font(24,True),fill=TEAL)
    d.text((80,116),title,font=font(56,True),fill=TEXT)
    d.text((80,198),subtitle,font=font(29),fill=MUTED)
    return im,d
def arrow(d,a,b,color=TEAL):
    d.line([a,b],fill=color,width=6)
    x,y=b;d.polygon([(x,y),(x-16,y-10),(x-16,y+10)],fill=color)
def foot(d,text):
    d.line((80,909,1520,909),fill=LINE,width=2)
    d.text((80,940),text,font=font(23),fill=MUTED)

im,d=base('PULSHEALTH  /  UNDER THE NUMBER','A flight is a sensor estimate','Pressure and movement provide clues. The Watch does not count stair treads.')
# Two input panels merge into the estimate panel.
for y,color,title,sub in [(295,TEAL,'Air pressure','Barometer'),(555,AMBER,'Movement','Motion information')]:
    d.rounded_rectangle((80,y,650,y+200),radius=22,fill=PANEL)
    d.text((124,y+35),title,font=font(40,True),fill=color)
    d.text((124,y+103),sub,font=font(30),fill=MUTED)
    d.line((650,y+100,735,y+100),fill=color,width=5)
d.line((735,395,735,655),fill=TEAL,width=5)
arrow(d,(735,525),(840,525))
d.rounded_rectangle((850,340,1520,770),radius=22,fill=PANEL)
d.text((900,386),'Estimated flights',font=font(42,True),fill=TEXT)
# Stair silhouette, intentionally schematic.
pts=[(915,667),(915,637),(985,637),(985,597),(1055,597),(1055,557),(1125,557),(1125,517),(1195,517)]
d.line(pts,fill=TEAL,width=8)
d.text((1260,538),'?',font=font(82,True),fill=AMBER)
d.text((900,712),'No direct view of the staircase',font=font(28),fill=MUTED)
foot(d,'CONCEPTUAL DIAGRAM  ·  Sensor roles described in Apple’s November 2024 technical paper')
im.save(OUT/'how-flights-work.webp',quality=94,method=6)

im,d=base('PULSHEALTH  /  INSPECT THE INTERVAL','Same total. Different questions.','Both examples add up to 12 flights. The daily number hides when they were recorded.')
for x,title,values,color in [(80,'Spread through the day',[3,3,3,3],TEAL),(830,'One concentrated entry',[0,0,12,0],AMBER)]:
    d.rounded_rectangle((x,290,x+690,830),radius=22,fill=PANEL)
    d.text((x+40,328),title,font=font(37,True),fill=TEXT)
    d.text((x+40,386),'12 flights total',font=font(28),fill=color)
    left=x+82;bottom=717;scale=20
    for tick in [0,6,12]:
        yy=bottom-tick*scale
        d.line((left,yy,x+640,yy),fill=LINE,width=2)
        d.text((x+28,yy-14),str(tick),font=font(23),fill=MUTED)
    for i,(v,label) in enumerate(zip(values,['08:00','11:00','14:00','18:00'])):
        xx=left+36+i*130
        if v:
            d.rounded_rectangle((xx,bottom-v*scale,xx+68,bottom),radius=6,fill=color)
            d.text((xx+22,bottom-v*scale-37),str(v),font=font(26,True),fill=color)
        d.text((xx-3,bottom+20),label,font=font(22),fill=MUTED)
    d.text((x+40,781),'Flights recorded in each interval',font=font(24),fill=MUTED)
foot(d,'ILLUSTRATIVE DATA  ·  Neither pattern alone proves accuracy or error. Check source and context.')
im.save(OUT/'same-total-different-records.webp',quality=94,method=6)
