# PulsHealth Blog Content Creation System

A comprehensive system for creating high-quality, SEO-optimized, multimedia blog posts with minimal manual effort using Claude Code skills and reusable components.

> The `/blog*` Claude Code commands and the `generate-blog-images.js` helper
> described below stayed behind in the archived marketing-site repository
> (`PulsHealth/pulshealth-legacy-site`); the MDX, the components, and the
> image pipeline they drive all came across. Site paths below are `site/`.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Skills Reference](#skills-reference)
- [Component Library](#component-library)
- [Sample Data](#sample-data)
- [Content Workflow](#content-workflow)
- [Image Generation](#image-generation)
- [File Locations](#file-locations)
- [Best Practices](#best-practices)

---

## Overview

The blog system consists of four main parts:

1. **Claude Code Skills** - Automated workflows for content creation
2. **MDX Components** - Reusable React components for rich content
3. **Sample Data Library** - Realistic health data for visualizations
4. **Knowledge Base Integration** - Automatic extraction of clinical data from YAML files

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code Skills                        │
│  /blog  /blog-review  /blog-images  /blog-charts            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Knowledge Base                            │
│  quantity_types/  category_types/                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Blog Articles                             │
│  blog/articles/*.mdx                                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Website                           │
│  Static generation → pulshealth.com/blog                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Generate a New Blog Post

```bash
# In Claude Code, run:
/blog heart rate variability
```

This will:
1. Search the knowledge base for relevant YAML files
2. Extract clinical ranges and references
3. Generate SEO keywords
4. Create a complete MDX article with components
5. Provide image prompts for hero and diagrams

### Review an Existing Article

```bash
/blog-review blog/articles/hrv-guide.mdx
```

### Add Visualizations

```bash
/blog-charts blog/articles/hrv-guide.mdx
```

### Generate Image Prompts

```bash
/blog-images blog/articles/hrv-guide.mdx
```

---

## Skills Reference

### `/blog [topic]`

**Location:** `.claude/commands/blog.md`

**Purpose:** Generate a complete blog post from scratch.

**Usage:**
```
/blog heart rate variability stress
/blog vo2 max training
/blog sleep stages deep dive
```

**What it does:**
1. Researches the knowledge-base YAML files
2. Extracts clinical_ranges, typical_range, and references
3. Determines SEO keywords (primary, secondary, long-tail)
4. Generates 2000-3000 word MDX article with:
   - SEO-optimized frontmatter
   - Structured content sections
   - Required MDX components (Callout, Grid, StatHighlight, DataTypeLink)
   - Chart suggestions with sample data
5. Provides DALL-E/Midjourney image prompts

**Output:** MDX file at `blog/articles/[slug].mdx`

---

### `/blog-review [file-path]`

**Location:** `.claude/commands/blog-review.md`

**Purpose:** Review an existing article for SEO and quality.

**Usage:**
```
/blog-review blog/articles/understanding-resting-heart-rate.mdx
```

**What it checks:**
- Title tag length and keyword usage
- Meta description (excerpt) optimization
- Heading hierarchy and keyword placement
- Component usage (Callout, Grid, DataTypeLink)
- Internal linking
- Medical/legal compliance
- Technical accuracy against YAML data

**Output:** Detailed review with scores and specific improvement suggestions.

---

### `/blog-images [file-path]`

**Location:** `.claude/commands/blog-images.md`

**Purpose:** Generate AI image prompts for an article.

**Usage:**
```
/blog-images blog/articles/sleep-stages.mdx
```

**What it generates:**
- Hero image prompt (lifestyle, Apple Watch context)
- Medical diagram prompts (anatomy, processes)
- Infographic suggestions
- BlogImage component code snippets

**Output:** Ready-to-use prompts for DALL-E 3 or Midjourney.

---

### `/blog-charts [file-path]`

**Location:** `.claude/commands/blog-charts.md`

**Purpose:** Add data visualizations to an article.

**Usage:**
```
/blog-charts blog/articles/vo2-max.mdx
```

**What it does:**
- Analyzes article content for visualization opportunities
- Matches data to sample-data.ts patterns
- Generates complete chart component code
- Specifies insertion points in the article

**Output:** Ready-to-paste MDX component code with data.

---

## Component Library

All components are available in MDX files automatically.

### Callout

Highlight important information with styled boxes.

```mdx
<Callout type="info" title="Did You Know?">
  Your resting heart rate can predict cardiovascular health.
</Callout>

<Callout type="warning" title="When to See a Doctor">
  Consult a healthcare provider if your RHR is consistently above 100 BPM.
</Callout>

<Callout type="tip" title="Pro Tip">
  Measure your heart rate first thing in the morning for best accuracy.
</Callout>

<Callout type="success" title="Good News">
  Regular exercise can lower your resting heart rate by 10-20 BPM.
</Callout>
```

**Types:** `info` | `warning` | `tip` | `success`

---

### StatHighlight

Display key statistics prominently.

```mdx
<Grid cols={3}>
  <StatHighlight value="60-100" label="BPM" description="Normal adult range" />
  <StatHighlight value="40-60" label="BPM" description="Athletes" />
  <StatHighlight value="<40" label="BPM" description="Bradycardia" />
</Grid>
```

---

### Grid

Responsive layout for multiple items.

```mdx
<Grid cols={2}>
  <!-- 2 columns on desktop, 1 on mobile -->
</Grid>

<Grid cols={3}>
  <!-- 3 columns on desktop, 2 on tablet, 1 on mobile -->
</Grid>

<Grid cols={4}>
  <!-- 4 columns on desktop -->
</Grid>
```

---

### DataTypeLink

Link to knowledge base entries.

```mdx
<DataTypeLink identifier="HKQuantityTypeIdentifierRestingHeartRate">
  Learn more about Resting Heart Rate
</DataTypeLink>

<!-- Or with auto-generated text: -->
<DataTypeLink identifier="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" />
```

---

### GenericChart

Flexible line, bar, or area charts.

```mdx
<GenericChart
  title="Heart Rate Over Time"
  description="Daily variation pattern"
  type="line"
  data={[
    { time: "6 AM", bpm: 58 },
    { time: "12 PM", bpm: 85 },
    { time: "6 PM", bpm: 95 },
    { time: "10 PM", bpm: 65 },
  ]}
  xKey="time"
  yKey="bpm"
  yLabel="BPM"
  color="#0092FF"
  height={300}
  showGrid={true}
  referenceLines={[
    { y: 60, label: "Resting", color: "#22c55e" },
    { y: 100, label: "Elevated", color: "#f97316" },
  ]}
  yDomain={[40, 120]}
/>
```

**Props:**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `"line"` \| `"bar"` \| `"area"` | `"line"` | Chart type |
| `data` | `Array<{[key]: value}>` | required | Data points |
| `xKey` | `string` | required | Key for x-axis values |
| `yKey` | `string` | required | Key for y-axis values |
| `yLabel` | `string` | - | Unit label for tooltip |
| `color` | `string` | `"#0092FF"` | Chart color |
| `height` | `number` | `300` | Chart height in pixels |
| `showGrid` | `boolean` | `true` | Show grid lines |
| `referenceLines` | `Array<{y, label, color}>` | `[]` | Horizontal reference lines |
| `yDomain` | `[min, max]` | auto | Y-axis range |
| `gradientFill` | `boolean` | `false` | Gradient fill for area charts |

---

### MultiLineChart

Compare multiple metrics on one chart.

```mdx
<MultiLineChart
  title="VO2 Max by Gender"
  description="Average values by age group"
  data={[
    { age: "20-29", male: 44, female: 38 },
    { age: "30-39", male: 42, female: 36 },
    { age: "40-49", male: 40, female: 34 },
  ]}
  xKey="age"
  lines={[
    { key: "male", label: "Male", color: "#0092FF" },
    { key: "female", label: "Female", color: "#ec4899" },
  ]}
  height={300}
  yDomain={[20, 50]}
/>
```

---

### HeartRateChart

Specialized heart rate visualization with zones.

```mdx
<HeartRateChart
  title="Daily Heart Rate Pattern"
  description="Notice variation throughout the day"
  showZones={true}
/>
```

---

### ClinicalRangesTable

Display clinical reference ranges.

```mdx
<ClinicalRangesTable
  title="Resting Heart Rate Ranges"
  description="Reference values by population"
  metric="Heart Rate"
  unit="BPM"
  ranges={[
    { population: "Adults (18-65)", low: "<60", normal: "60-100", high: ">100" },
    { population: "Athletes", low: "<40", normal: "40-60", high: ">60" },
    { population: "Children (6-15)", low: "<70", normal: "70-100", high: ">100" },
  ]}
/>
```

---

### DeviceComparisonTable

Compare device accuracy and features.

```mdx
<DeviceComparisonTable
  title="Heart Rate Monitor Accuracy"
  description="Comparison of popular wearables"
  showRating={true}
  devices={[
    { device: "Apple Watch Series 9", accuracy: "±2 BPM", rating: 5, notes: "Best optical sensor" },
    { device: "Fitbit Charge 6", accuracy: "±3 BPM", rating: 4, notes: "Good for most activities" },
    { device: "Polar H10 (Chest)", accuracy: "±1 BPM", rating: 5, notes: "Gold standard" },
  ]}
/>
```

---

### FeatureComparisonTable

Feature matrix with checkmarks.

```mdx
<FeatureComparisonTable
  title="Wearable Features"
  columns={["Apple Watch", "Fitbit", "Garmin"]}
  features={[
    { feature: "Heart Rate", "Apple Watch": true, Fitbit: true, Garmin: true },
    { feature: "ECG", "Apple Watch": true, Fitbit: true, Garmin: false },
    { feature: "Blood Oxygen", "Apple Watch": true, Fitbit: true, Garmin: true },
    { feature: "GPS", "Apple Watch": true, Fitbit: "Some models", Garmin: true },
  ]}
/>
```

---

### DataTable

Simple data table with optional highlighting.

```mdx
<DataTable
  title="Quick Reference"
  headers={["Category", "Normal Range", "Notes"]}
  rows={[
    ["Adults", "60-100 BPM", "At rest"],
    ["Athletes", "40-60 BPM", "Trained cardiovascular system"],
    ["Children", "70-100 BPM", "Age 6-15"],
  ]}
  highlightColumn={1}
/>
```

---

### ProConComparison

Pros and cons layout.

```mdx
<ProConComparison
  title="Optical Heart Rate Sensors"
  pros={[
    { text: "Convenient, always-on monitoring" },
    { text: "No chest strap needed" },
    { text: "Comfortable for sleep tracking" },
  ]}
  cons={[
    { text: "Less accurate during intense exercise" },
    { text: "Can be affected by skin tone and tattoos" },
    { text: "Motion artifacts during activities" },
  ]}
/>
```

---

### BlogImage

Optimized images with captions.

```mdx
<BlogImage
  src="/blog/hrv-guide/hero.webp"
  alt="Apple Watch showing HRV data on wrist"
  caption="Heart rate variability provides insights into recovery and stress"
  width={1920}
  height={1080}
  priority={true}
/>
```

---

## Sample Data

Pre-built realistic data patterns are available in `site/src/lib/sample-data.ts`.

### Available Datasets

| Dataset | Description | Use Case |
|---------|-------------|----------|
| `heartRateDailyPattern` | 24-hour HR cycle | Daily variation articles |
| `restingHeartRateWeekly` | 7-day RHR trend | Weekly patterns |
| `hrvWeeklyPattern` | HRV with recovery labels | Recovery/training articles |
| `hrvMonthlyTrend` | 8-week improvement | Training progress |
| `sleepStagesNight` | Single night stages | Sleep deep dives |
| `sleepDurationWeekly` | Weekly hours + quality | Sleep habits |
| `vo2MaxByAge` | Male/female by decade | VO2 max articles |
| `vo2MaxTrainingProgress` | 8-month improvement | Fitness progress |
| `walkingSpeedByAge` | Speed by age group | Mobility articles |
| `stepsWeeklyPattern` | Weekly step counts | Activity articles |
| `bloodOxygenNight` | Overnight SpO2 | Blood oxygen articles |
| `wristTemperatureCycle` | 14-day ovulation pattern | Cycle tracking |
| `caffeineHalfLife` | Caffeine decay curve | Caffeine articles |
| `daylightExposureWeekly` | Minutes of daylight | Daylight articles |

### Clinical Range Data

| Dataset | Description |
|---------|-------------|
| `restingHeartRateClinicalRanges` | RHR by population |
| `hrvClinicalRanges` | HRV (RMSSD) by age |
| `heartRateDeviceComparison` | Device accuracy ratings |
| `wearableFeatureComparison` | Feature matrix data |

### Usage in MDX

Since MDX doesn't support direct imports from TypeScript, copy the data inline:

```mdx
<GenericChart
  title="Weekly HRV Pattern"
  data={[
    { day: "Mon", hrv: 42 },
    { day: "Tue", hrv: 48 },
    { day: "Wed", hrv: 55 },
    { day: "Thu", hrv: 52 },
    { day: "Fri", hrv: 45 },
    { day: "Sat", hrv: 58 },
    { day: "Sun", hrv: 62 },
  ]}
  xKey="day"
  yKey="hrv"
  yLabel="ms"
  type="bar"
/>
```

---

## Content Workflow

### Step-by-Step Process

| Step | Who | Tool | Output |
|------|-----|------|--------|
| 1. Topic Selection | You | `ideas.md` or brainstorm | Topic + target keyword |
| 2. Research & Draft | Claude | `/blog [topic]` | Complete MDX article |
| 3. Review | Claude | `/blog-review [file]` | SEO improvements |
| 4. Visualizations | Claude | `/blog-charts [file]` | Chart components |
| 5. Image Prompts | Claude | `/blog-images [file]` | DALL-E prompts |
| 6. Image Generation | You | ChatGPT/Midjourney | WebP images |
| 7. Final Review | You | Manual review | Published article |

**Your effort per article:** ~30-45 minutes (topic selection, image generation, final review)

### Quality Checklist

Before publishing, ensure:

- [ ] Title under 60 characters with primary keyword
- [ ] Excerpt 150-160 characters
- [ ] At least 2 `<Callout>` components
- [ ] At least 1 `<Grid>` with `<StatHighlight>`
- [ ] At least 1 `<DataTypeLink>` to knowledge base
- [ ] Hero image with descriptive alt text
- [ ] Clinical ranges cited from YAML files
- [ ] No direct medical advice (use disclaimers)
- [ ] Internal links to related content

---

## Image Generation

### Recommended Tools

| Image Type | Best Tool | Notes |
|------------|-----------|-------|
| Hero images | Midjourney v6 | Photorealistic lifestyle shots |
| Medical diagrams | DALL-E 3 | Clean vectors, educational |
| Infographics | Canva Pro | Templates, brand consistency |
| Data charts | Recharts (code) | Interactive, already integrated |

### Prompt Templates

**Hero Image:**
```
Apple Watch on wrist showing [metric] screen, [context: morning/workout/sleeping],
soft natural lighting, health technology aesthetic, clean background,
photorealistic, no text --ar 16:9
```

**Medical Diagram:**
```
Clean medical illustration of [anatomy/concept], vector style,
white background, blue accent color #0092FF, labeled parts,
educational, flat design, no photorealism
```

### File Naming Convention

Images live in `blog/images/` (the source of truth) and are copied to `site/public/blog/` during build/dev:

```
blog/images/[slug]/
  ├── hero.webp          # Main hero image (1920x1080)
  ├── diagram-1.webp     # Medical diagrams
  ├── infographic.webp   # Data visualizations
  └── lifestyle-1.webp   # Supporting images
```

The copy happens automatically via `bun run predev` and `bun run prebuild`.

---

## File Locations

| Purpose | Location |
|---------|----------|
| Blog skills | `.claude/commands/blog*.md` |
| MDX articles | `blog/articles/*.mdx` |
| Article ideas | `blog/articles/ideas.md` |
| Chart components | `site/src/components/charts/` |
| MDX component registry | `site/src/components/mdx-components.tsx` |
| Sample data | `site/src/lib/sample-data.ts` |
| Blog images (source) | `blog/images/[slug]/` |
| YAML data sources | `knowledge-base/quantity_types/` etc. |

---

## Best Practices

### Writing

1. **Start with a hook** - Personal scenario or surprising fact
2. **Use active voice** - "Your watch measures" not "Heart rate is measured"
3. **Include specific numbers** - "60-100 BPM" not "normal range"
4. **Break up text** - Short paragraphs, bullet points, subheadings
5. **End with action** - "Start tracking today"

### SEO

1. **Primary keyword in first 100 words**
2. **H2 headings contain secondary keywords**
3. **Internal links to 2-3 related articles**
4. **External links to authoritative sources**
5. **Alt text describes images for accessibility**

### Technical Accuracy

1. **Cite YAML knowledge base** for clinical ranges
2. **Include references section** for claims
3. **Add disclaimers** for health information
4. **Verify device capabilities** match current specs

### Components

1. **Use Callouts sparingly** - 2-3 per article max
2. **StatHighlight for key numbers** - Not paragraphs
3. **Charts for trends** - Tables for reference data
4. **DataTypeLink for internal navigation**

---

## Troubleshooting

### Components Not Rendering

Ensure the component is registered in `site/src/components/mdx-components.tsx`.

### Charts Not Displaying

1. Check that data format matches expected structure
2. Verify `xKey` and `yKey` match data object keys
3. Ensure `"use client"` is at top of chart component

### Build Errors

```bash
cd site
bun run build
```

Check for:
- Missing imports
- TypeScript type errors
- Invalid MDX syntax

### MDX Syntax Errors with `<` and `>`

**CRITICAL:** MDX parses angle brackets as JSX tags. Using `<` followed by a number in prose text will cause a build error.

**Error example:**
```
Error: Unexpected character `3` (U+0033) before name
```

**Cause:** Text like `(<30 years)` or `<10 minutes` in prose.

**Solutions:**
1. Use words: "under 30 years", "less than 10 minutes"
2. Use HTML entities: `&lt;30` renders as <30
3. Note: `<` inside quoted JSX props (e.g., `low="<20 ms"`) and code blocks are safe

### Image Not Loading

1. Verify file exists in `site/public/blog/[slug]/`
2. Check path starts with `/blog/` (no `public/` prefix)
3. Ensure WebP format for optimization

---

## Version History

- **v1.0** (2026-02-01) - Initial release
  - Blog generation skill
  - Review, images, and charts skills
  - GenericChart and comparison table components
  - Sample data library
