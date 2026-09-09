import React from "react";
import {
  Activity,
  Flame,
  Footprints,
  Heart,
  HeartPulse,
  Thermometer,
  Scale,
  Dumbbell,
  Accessibility,
  Bike,
  Mountain,
  Waves,
  Zap,
  Percent,
  User,
  Eye,
  Utensils,
  Moon,
  Wine,
  Clock,
  Map,
  ArrowUpRight,
  MoveDown,
  ChevronUp,
  Droplet,
  Wind,
  TrendingUp,
  Coffee,
  Gauge,
  Sun,
  Ear,
  Syringe,
  TestTube,
  Ruler,
  PersonStanding,
  Timer,
  Beef,
  Wheat,
  Candy,
  Cookie,
  Pill,
  Apple,
  Carrot,
  Fish,
  Milk,
  CircleDot,
  Brain,
  Sparkles,
  Headphones,
  AlertTriangle,
  Leaf,
  Square,
  Battery,
  Calendar,
  Hand,
  Bed,
  Baby,
  LucideIcon,
} from "lucide-react";
import { LucideProps } from "lucide-react";

interface HealthIconProps extends LucideProps {
  iconName?: string | null;
  category?: string;
}

// Pattern-based icon mapping for SF Symbols to Lucide icons
const ICON_PATTERNS: Array<{ pattern: RegExp; icon: LucideIcon }> = [
  // Waveform/ECG icons
  { pattern: /waveform|ecg/i, icon: HeartPulse },

  // Heart icons
  { pattern: /heart/i, icon: Heart },

  // Fire/Flame icons
  { pattern: /flame/i, icon: Flame },

  // Activity/Figure icons - more specific patterns first
  { pattern: /figure\.walk/i, icon: Footprints },
  { pattern: /figure\.run/i, icon: PersonStanding },
  { pattern: /figure\.outdoor\.cycle|bicycle/i, icon: Bike },
  { pattern: /figure\.roll|wheelchair/i, icon: Accessibility },
  { pattern: /figure\.stand/i, icon: User },
  { pattern: /figure\.stairs/i, icon: TrendingUp },
  { pattern: /figure\.strengthtraining/i, icon: Dumbbell },
  { pattern: /figure\.skiing|skiing/i, icon: Mountain },
  { pattern: /figure\.pool\.swim|swimming|swim/i, icon: Waves },
  { pattern: /figure\.arms\.open/i, icon: User },
  { pattern: /figure\.fall|fall/i, icon: AlertTriangle },
  { pattern: /figure\.and\.child|child/i, icon: Baby },

  // Temperature icons
  { pattern: /thermometer/i, icon: Thermometer },

  // Drop/liquid icons
  { pattern: /drop/i, icon: Droplet },

  // Respiratory
  { pattern: /lungs/i, icon: Wind },

  // Measurement icons
  { pattern: /percent/i, icon: Percent },
  { pattern: /scale/i, icon: Scale },
  { pattern: /ruler/i, icon: Ruler },
  { pattern: /gauge|speedometer/i, icon: Gauge },
  { pattern: /timer|stopwatch/i, icon: Timer },

  // Energy/power
  { pattern: /lightning|bolt/i, icon: Zap },

  // Eyes/Vision
  { pattern: /eye/i, icon: Eye },

  // Food/Nutrition icons
  { pattern: /fork\.knife|utensils/i, icon: Utensils },
  { pattern: /carrot/i, icon: Carrot },
  { pattern: /fish/i, icon: Fish },
  { pattern: /apple/i, icon: Apple },
  { pattern: /leaf/i, icon: Leaf },
  { pattern: /wheat|grain/i, icon: Wheat },
  { pattern: /meat|protein/i, icon: Beef },
  { pattern: /candy/i, icon: Candy },
  { pattern: /cube/i, icon: Square },
  { pattern: /cookie/i, icon: Cookie },
  { pattern: /milk|calcium/i, icon: Milk },
  { pattern: /pill|vitamin|capsule/i, icon: Pill },

  // Beverages
  { pattern: /cup|mug|caffeine|coffee/i, icon: Coffee },
  { pattern: /wine|alcohol/i, icon: Wine },
  { pattern: /water/i, icon: Droplet },

  // Sleep
  { pattern: /bed/i, icon: Bed },
  { pattern: /moon|sleep/i, icon: Moon },

  // Time/Calendar
  { pattern: /calendar/i, icon: Calendar },
  { pattern: /clock|time/i, icon: Clock },

  // Distance/map
  { pattern: /map|distance|location/i, icon: Map },

  // Direction arrows
  { pattern: /upright|arrow\.up/i, icon: ArrowUpRight },
  { pattern: /down/i, icon: MoveDown },
  { pattern: /up/i, icon: ChevronUp },

  // Hearing/audio
  { pattern: /headphones?/i, icon: Headphones },
  { pattern: /ear|audio/i, icon: Ear },
  { pattern: /waveform\.and\.mic|speaker/i, icon: Ear },

  // Sun/Light
  { pattern: /sun|daylight/i, icon: Sun },

  // Medical/Lab
  { pattern: /syringe|needle/i, icon: Syringe },
  { pattern: /testtube|lab|flask/i, icon: TestTube },
  { pattern: /inhaler/i, icon: Wind },
  { pattern: /bandage|cross/i, icon: Activity },

  // Mental/Brain
  { pattern: /brain|mind/i, icon: Brain },

  // Body parts
  { pattern: /hands?/i, icon: Hand },
  { pattern: /mouth|nose/i, icon: User },

  // Battery/Energy state
  { pattern: /battery/i, icon: Battery },

  // Weather/Nature
  { pattern: /tornado/i, icon: Wind },

  // Misc
  { pattern: /sparkles|star/i, icon: Sparkles },
  { pattern: /circle/i, icon: CircleDot },
  { pattern: /person/i, icon: User },
  { pattern: /face/i, icon: User },
];

// Category-based fallback icons
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Vital: Heart,
  Body: Scale,
  Nutrition: Utensils,
  Activity: Activity,
  Mobility: Footprints,
  Lab: TestTube,
  Hearing: Ear,
};

function getIconForName(name: string): LucideIcon | null {
  const lowerName = name.toLowerCase();
  for (const { pattern, icon } of ICON_PATTERNS) {
    if (pattern.test(lowerName)) {
      return icon;
    }
  }
  return null;
}

function getIconForCategory(category: string): LucideIcon {
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (category.includes(key)) {
      return icon;
    }
  }
  return Activity;
}

/**
 * Resolves the appropriate icon for a given icon name and category.
 * This is a pure function that can be called outside of render.
 */
function resolveIcon(iconName?: string | null, category?: string): LucideIcon {
  if (iconName) {
    const matched = getIconForName(iconName);
    if (matched) {
      return matched;
    }
  }

  if (category) {
    return getIconForCategory(category);
  }

  return Activity;
}

export function HealthIcon({
  iconName,
  category,
  ...props
}: HealthIconProps) {
  // Lucide icons are stateless, so dynamically selecting them is safe
  /* eslint-disable react-hooks/static-components */
  const IconComponent = resolveIcon(iconName, category);
  return <IconComponent {...props} />;
  /* eslint-enable react-hooks/static-components */
}

// Export for build-time validation
export { getIconForName };
