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
fig.text(.065,.875,"Headphone audio levels:",fontsize=31,weight="bold")
fig.text(.065,.778,"volume needs a time scale",fontsize=31,weight="bold")
fig.text(.065,.68,"WHO weekly listening reference durations",fontsize=17,color=MUTED)
ax=fig.add_axes([.17,.235,.71,.31]);ax.set_xlim(0,46);ax.set_ylim(1.6,-.6)
ax.barh(0,40,height=.45,color=BLUE);ax.barh(1,4,height=.45,color=TEAL)
ax.text(40.8,0,"40 h",va="center",fontsize=21)
ax.text(4.8,1,"4 h",va="center",fontsize=21)
ax.set_yticks([0,1],["80 dB","90 dB"],fontsize=21)
ax.set_xticks([0,10,20,30,40],["0","10","20","30","40 h"],fontsize=14)
ax.grid(axis="x",color=GRID,alpha=.6);ax.set_axisbelow(True)
for side in ["top","right","left"]:ax.spines[side].set_visible(False)
ax.tick_params(axis="y",length=0,pad=14)
fig.text(.065,.075,"Reference values, not personal safety guarantees",fontsize=14,color=MUTED)

fig.text(.93,.075,"PulsHealth",ha="right",fontsize=15,color=MUTED)
b=BytesIO(); fig.savefig(b,format="png",dpi=100); b.seek(0)
Image.open(b).convert("RGB").save(Path(__file__).with_name("social.webp"),"WEBP",quality=95,method=6)
plt.close(fig)
