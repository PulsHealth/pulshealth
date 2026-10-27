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
fig.text(.065,.875,"What my Watch recorded",fontsize=31,weight="bold")
fig.text(.065,.778,"before a marathon",fontsize=31,weight="bold")
fig.text(.065,.68,"16 weeks • 286 recorded training miles • race excluded",fontsize=17,color=MUTED)
# Published selected weekly aggregates, rounded to 0.1 mile.
MILES=[19.7, 18.7, 0.0, 16.6, 19.2, 21.8, 28.7, 31.8, 25.8, 33.6, 22.1, 25.3, 0.0, 6.0, 14.3, 2.4]
ax=fig.add_axes([.10,.24,.83,.32]);ax.set_ylim(0,40);ax.set_xlim(-.6,15.6)
for i,value in enumerate(MILES):
 if value: ax.bar(i,value,width=.65,color=BLUE)
 else: ax.plot(i,0,marker="x",markersize=10,color=AMBER,markeredgewidth=2,clip_on=False)
ax.set_yticks([0,20,40],["0","20","40 mi"],fontsize=14)
ax.set_xticks([0,4,8,12,15],["Mar 11","Apr 8","May 6","Jun 3","Jun 24"],fontsize=13)
ax.grid(axis="y",color=GRID,alpha=.6);ax.set_axisbelow(True)
for side in ["top","right","left"]:ax.spines[side].set_visible(False)
ax.tick_params(axis="y",length=0,pad=8)
fig.text(.065,.13,"× No running workout recorded",fontsize=14,color=AMBER)
fig.text(.065,.075,"Author’s training records • March–June 2024",fontsize=14,color=MUTED)

fig.text(.93,.075,"PulsHealth",ha="right",fontsize=15,color=MUTED)
b=BytesIO(); fig.savefig(b,format="png",dpi=100); b.seek(0)
Image.open(b).convert("RGB").save(Path(__file__).with_name("social.webp"),"WEBP",quality=95,method=6)
plt.close(fig)
