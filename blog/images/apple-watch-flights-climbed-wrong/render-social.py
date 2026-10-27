"""Reproduce this original social card.
Run: uv run --with matplotlib --with pillow PATH/TO/render-social.py
"""
from pathlib import Path
from io import BytesIO
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
from PIL import Image
BG, INK, MUTED, GRID = "#111b28", "#edf3fb", "#b6c7dc", "#33455b"
BLUE, TEAL, AMBER = "#60a5fa", "#2dd4bf", "#fbbf24"
plt.rcParams.update({"font.family":"DejaVu Sans", "text.color":INK, "axes.labelcolor":MUTED, "xtick.color":MUTED,"ytick.color":MUTED,"axes.facecolor":BG,"figure.facecolor":BG,"savefig.facecolor":BG,"axes.edgecolor":GRID})
fig=plt.figure(figsize=(12,6.3))
fig.text(.065,.875,"Why your Watch counts",fontsize=31,weight="bold")
fig.text(.065,.778,"stairs you didn’t climb",fontsize=31,weight="bold")
fig.text(.065,.68,"A sensor estimate, not a visual count of stair treads",fontsize=17,color=MUTED)
ax=fig.add_axes([.065,.19,.87,.4]); ax.set_xlim(0,1000);ax.set_ylim(0,250);ax.axis("off")
for y,label,color in [(140,"Air pressure",BLUE),(10,"Motion",TEAL)]:
 ax.add_patch(FancyBboxPatch((0,y),310,90,boxstyle="round,pad=0,rounding_size=12",facecolor="#182637",edgecolor=color,linewidth=2))
 ax.text(155,y+45,label,ha="center",va="center",fontsize=23,color=color)
 ax.annotate("",xy=(580,125),xytext=(330,y+45),arrowprops={"arrowstyle":"->","color":MUTED,"linewidth":2.5})
ax.add_patch(FancyBboxPatch((610,65),380,120,boxstyle="round,pad=0,rounding_size=12",facecolor="#182637",edgecolor=BLUE,linewidth=2))
ax.text(800,125,"Estimated flights",ha="center",va="center",fontsize=24,weight="bold")
fig.text(.065,.075,"Conceptual sensor diagram",fontsize=15,color=MUTED)

fig.text(.93,.075,"PulsHealth",ha="right",fontsize=15,color=MUTED)
b=BytesIO(); fig.savefig(b,format="png",dpi=100); b.seek(0)
Image.open(b).convert("RGB").save(Path(__file__).with_name("social.webp"),"WEBP",quality=95,method=6)
plt.close(fig)
