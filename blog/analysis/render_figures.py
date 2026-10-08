#!/usr/bin/env python3
"""Render selected summary figures from private, owner-scoped analysis JSON.

Input stays outside the repository; see README.md for extraction and methods.
"""
import argparse
import collections
import datetime as dt
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from PIL import Image
import io

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 12,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.spines.left': False, 'axes.spines.bottom': False,
                     'axes.titleweight': 'bold', 'axes.labelcolor': '#334155',
                     'text.color': '#152838', 'xtick.color': '#475569',
                     'ytick.color': '#475569', 'figure.facecolor': '#f7fafb',
                     'axes.facecolor': '#f7fafb', 'axes.axisbelow': True})
TEAL, BLUE, ORANGE = '#007f78', '#365ea8', '#b65019'

def style(ax, unit):
    ax.grid(axis='y', color='#dce5e9', linewidth=.8)
    ax.set_ylabel(unit, labelpad=12)
    ax.tick_params(length=0, pad=8)

def dates(ax):
    ax.xaxis.set_major_locator(mdates.DayLocator(interval=5))
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %-d'))

def save(fig, root, slug, name, title, subtitle, note):
    fig.suptitle(title, x=.07, y=.955, ha='left', fontsize=19, fontweight='bold')
    fig.text(.07,.875,subtitle,ha='left',fontsize=12,color='#475569')
    fig.text(.07,.033,note,ha='left',fontsize=10,color='#475569',linespacing=1.5)
    fig.subplots_adjust(left=.085,right=.965,top=.815,bottom=.20,hspace=.33)
    target=root/slug/name
    target.parent.mkdir(parents=True,exist_ok=True)
    buf=io.BytesIO()
    fig.savefig(buf,format='png',dpi=160)
    buf.seek(0)
    im=Image.open(buf).convert('RGB')
    im.save(target,format='WEBP',quality=92)
    print(f'{target}: {im.width} × {im.height}')
    plt.close(fig)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('--output',type=Path,default=Path('blog/images'))
    parser.add_argument('--label',default='September 2026')
    args=parser.parse_args()
    data=json.loads(args.input.read_text())
    h=data['hrv_daily']; xx=[dt.date.fromisoformat(r['day']) for r in h]
    fig,(ax,ax2)=plt.subplots(2,1,figsize=(10,6.5),sharex=True,gridspec_kw={'height_ratios':[2,1]})
    ax.plot(xx,[r['median'] for r in h],color=TEAL,marker='o',markersize=4,lw=2)
    ax.set_ylim(0,100); style(ax,'Daily median SDNN (ms)')
    ax2.bar(xx,[r['n'] for r in h],width=.75,color=BLUE)
    style(ax2,'Samples / day'); ax2.set_ylim(0,20); dates(ax2)
    save(fig,args.output,'apple-watch-hrv-complete-guide','hrv-observations.webp',
         'HRV varies—and each day contains several readings',
         f'{args.label} · {sum(r["n"] for r in h)} observations · one person',
         'Daily medians of recorded samples; not a continuous physiological signal.\nDays use America/Los_Angeles. Descriptive example, not a reference range.')

    counts=collections.Counter()
    for r in data['sleep']: counts[r['stage']]+=r['n']
    names=['Asleep Core','Awake','Asleep REM','Asleep Deep']
    fig,ax=plt.subplots(figsize=(10,5.5))
    bars=ax.barh([s.replace('Asleep ','') for s in names],[counts[s] for s in names],color=[TEAL,ORANGE,BLUE,'#6e53a1'],height=.55)
    ax.invert_yaxis(); ax.grid(axis='x',color='#dce5e9'); ax.set_xlabel('Stored intervals (count)'); ax.tick_params(length=0,pad=8)
    ax.set_xlim(0,max(counts.values())*1.16)
    for bar in bars:ax.text(bar.get_width()+7,bar.get_y()+bar.get_height()/2,str(int(bar.get_width())),va='center',fontweight='bold')
    save(fig,args.output,'apple-watch-sleep-stages','sleep-intervals.webp',
         'A sleep export is a collection of intervals',
         f'{args.label} · {sum(counts.values())} stage intervals · one person',
         'These are row counts, not hours asleep or percentages of sleep time.\nIntervals selected by start time; overlapping source records are included.')

    v=data['vo2']; months=sorted(set(r['day'][:7] for r in v))
    totals=[sum(r['n'] for r in v if r['day'].startswith(m)) for m in months]
    fig,ax=plt.subplots(figsize=(10,5.5))
    bars=ax.bar([dt.date.fromisoformat(m+'-01').strftime('%b %Y') for m in months],totals,color=TEAL,width=.55)
    style(ax,'Recorded VO₂ max estimates');ax.set_ylim(0,max(totals)+4)
    ax.set_yticks(range(0,max(totals)+4,2))
    for b in bars: ax.text(b.get_x()+b.get_width()/2,b.get_height()+.3,str(int(b.get_height())),ha='center',fontweight='bold',fontsize=15)
    save(fig,args.output,'apple-watch-cardio-fitness-low','cardio-fitness-cadence.webp',
         'Cardio fitness is an occasional estimate',
         f'June–September 2026 · {sum(totals)} estimates on {len(v)} dates · one person',
         'Counts of recorded VO₂ max samples, grouped by local calendar month.\nA day without a sample is missing an estimate—not a zero fitness score.')

    raw=collections.defaultdict(float)
    for r in data['steps_sources']:raw[r['day']]+=r['steps']
    s=data['steps_daily'];xx=[dt.date.fromisoformat(r['day']) for r in s]
    if any(r['source'] != 'aggregate' for r in s):
        raise ValueError('This figure requires HealthKit aggregate-backed daily rows.')
    fig,ax=plt.subplots(figsize=(10,6))
    ax.plot(xx,[raw[r['day']] for r in s],color=ORANGE,lw=2,marker='o',markersize=3,label='Raw samples: all-source sum')
    ax.plot(xx,[r['value'] for r in s],color=TEAL,lw=2,marker='s',markersize=3,label='HealthKit daily aggregate')
    style(ax,'Steps per day');dates(ax);ax.set_ylim(bottom=0)
    ax.legend(loc='upper left',frameon=False,fontsize=10)
    ax.yaxis.set_major_formatter(matplotlib.ticker.StrMethodFormatter('{x:,.0f}'))
    save(fig,args.output,'apple-health-step-counts-dont-match','step-totals.webp',
         'Adding every step record inflates this monthly total',
         f'{args.label} · {sum(raw.values()):,.0f} raw-summed vs {sum(r["value"] for r in s):,.0f} aggregate steps',
         'One person. Raw rows grouped by local start date; all 30 daily values use aggregates.\nSource overlap and interval attribution can differ. No phone-screen comparison performed.')

if __name__=='__main__':main()
