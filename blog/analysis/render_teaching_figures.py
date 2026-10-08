"""Render synthetic explanatory figures; no health records are read."""
from pathlib import Path
import io
import statistics

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 12,
                     "text.color": "#193746", "axes.labelcolor": "#193746",
                     "xtick.color": "#193746", "ytick.color": "#193746"})


def save(fig, slug, filename):
    target = ROOT / "blog/images" / slug / filename
    target.parent.mkdir(exist_ok=True)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, facecolor="#f7fafb")
    Image.open(buf).convert("RGB").save(target, "WEBP", quality=92)
    plt.close(fig)


def beats():
    fig, axes = plt.subplots(2, 1, figsize=(10, 6), sharex=True)
    fig.subplots_adjust(top=.77, bottom=.18, left=.09, right=.96, hspace=.8)
    fig.text(.07, .93, "Same average spacing. Different variability.", fontsize=20, weight="bold")
    fig.text(.07, .87, "Synthetic normal-to-normal intervals • four intervals in each example", fontsize=11)
    for ax, values, name, color in zip(axes, [[1000]*4,[850,1150,900,1100]],
                                     ["Even spacing", "Variable spacing"], ["#177f87", "#7860a8"]):
        times = [0]
        for value in values:
            times.append(times[-1] + value)
        assert times[-1] == 4000
        ax.set_facecolor("#f7fafb")
        ax.hlines(.4, 0, 4000, color="#c1ced4", lw=2)
        ax.vlines(times, .18, .7, color=color, lw=3)
        for i, value in enumerate(values):
            ax.text((times[i]+times[i+1])/2, .83, f"{value:,} ms", ha="center", fontsize=11)
        ax.set_title(f"{name}   ·   mean 1,000 ms   ·   sample SD {statistics.stdev(values):.1f} ms",
                     loc="left", pad=18, fontsize=12, weight="bold")
        ax.set_ylim(0,1); ax.set_yticks([]); ax.set_xlim(-80,4080)
        ax.spines[["left","right","top","bottom"]].set_visible(False)
    axes[-1].set_xticks([0,1000,2000,3000,4000],["0","1","2","3","4"])
    axes[-1].set_xlabel("Elapsed time (seconds)")
    fig.text(.07,.045,"Beat markers, not an ECG. Sample SD uses n − 1. This tiny example is not a watch algorithm\nor a health reference range; it illustrates spread within one recording.",fontsize=10)
    save(fig,"apple-watch-hrv-complete-guide","beat-spacing.webp")


def sleep():
    colors={"Awake":"#d98059","Core":"#4284be","Deep":"#61539d","REM":"#259e9f"}
    # Hours after 22:30, deliberately artificial stage ordering.
    stages=[(0,.5,"Awake"),(.5,1,"Core"),(1.5,.75,"Deep"),(2.25,.5,"Core"),
            (2.75,.5,"REM"),(3.25,1.25,"Core"),(4.5,.25,"Awake"),
            (4.75,.75,"Deep"),(5.5,1,"Core"),(6.5,.75,"REM"),(7.25,.5,"Core"),(7.75,.25,"Awake")]
    assert sum(d for _,d,s in stages if s!="Awake")==7
    fig,ax=plt.subplots(figsize=(10,5.4))
    fig.subplots_adjust(top=.69,bottom=.35,left=.15,right=.95)
    fig.text(.07,.92,"Overlapping records do not create extra sleep",fontsize=20,weight="bold")
    fig.text(.07,.85,"Synthetic night • 22:30–06:30 • local clock time",fontsize=11)
    ax.set_facecolor("#f7fafb")
    ax.broken_barh([(0,8)],(.95,.5),facecolors="#d9e2e7",edgecolors="#a5b7c1")
    ax.text(4,1.2,"In bed: 8 hours",ha="center",va="center",weight="bold")
    for start,duration,stage in stages:
        ax.broken_barh([(start,duration)],(.05,.5),facecolors=colors[stage],edgecolors="white")
    ax.set_yticks([1.2,.3],["In bed","Stages"]);ax.tick_params(axis='y',length=0,pad=10)
    ax.set_xticks(range(9),["22:30","23:30","00:30","01:30","02:30","03:30","04:30","05:30","06:30"],rotation=35)
    ax.set_xlim(0,8);ax.set_ylim(-.1,1.65);ax.spines[["top","left","right"]].set_visible(False)
    fig.legend(handles=[Patch(facecolor=c,label=n) for n,c in colors.items()],loc="center",bbox_to_anchor=(.55,.20),ncol=4,frameon=False)
    fig.text(.07,.10,"7 hours asleep + 1 hour awake sit inside the same 8-hour in-bed interval.",fontsize=12,weight="bold")
    fig.text(.07,.045,"Adding in-bed time to asleep time gives 15 hours of rows—not 15 hours asleep.\nIllustrative categories and timing; not a typical night or a device accuracy claim.",fontsize=10)
    save(fig,"apple-watch-sleep-stages","overnight-overlap.webp")


if __name__ == "__main__":
    beats()
    sleep()
