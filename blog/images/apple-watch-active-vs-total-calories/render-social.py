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
fig.text(.065,.875,"Active vs. total calories",fontsize=31,weight="bold")
fig.text(.065,.778,"Follow one day’s numbers",fontsize=31,weight="bold")
fig.text(.065,.68,"Daily resting energy + daily active energy",fontsize=17,color=MUTED)
ax=fig.add_axes([.065,.285,.87,.28]);ax.set_xlim(0,3711);ax.set_ylim(0,1);ax.axis("off")
ax.barh(.5,2245,height=.7,color="#6e829c")
ax.barh(.5,1466,left=2245,height=.7,color=BLUE)
ax.text(2245/2,.5,"2,245 resting",ha="center",va="center",fontsize=22,color=INK,weight="bold")
ax.text(2245+1466/2,.5,"1,466 active",ha="center",va="center",fontsize=22,color=BG,weight="bold")
fig.text(.065,.225,"3,711 kcal total",fontsize=25,weight="bold")
fig.text(.065,.075,"Author’s Oct 13, 2026 aggregates • rounded kcal",fontsize=14,color=MUTED)

fig.text(.93,.075,"PulsHealth",ha="right",fontsize=15,color=MUTED)
b=BytesIO(); fig.savefig(b,format="png",dpi=100); b.seek(0)
Image.open(b).convert("RGB").save(Path(__file__).with_name("social.webp"),"WEBP",quality=95,method=6)
plt.close(fig)
