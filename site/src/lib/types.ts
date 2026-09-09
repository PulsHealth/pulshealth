export interface HealthKitType {
  identifier: string;
  source: string;
  type: string;
  category: string;
  human_readable_name: string;
  short_description: string;
  icon?: string | null;
  color?: string | null;
  default_unit?: string | null;
  supported_units?: string[] | null;
  unit_description?: string | null;
  aggregation_type?: "discrete" | "cumulative" | null;
  typical_range?: {
    min: number;
    max: number;
    unit: string;
    notes?: string;
  } | null;
  clinical_ranges?: Array<{
    population: string;
    name?: string;
    normal?: string;
    low?: string;
    high?: string;
    rda?: string;
    systolic_range?: string;
    diastolic_range?: string;
    description?: string;
    notes?: string;
    [key: string]: string | undefined;
  }> | null;
  category_values?: Array<{
    value: number;
    name: string;
    description?: string;
  }> | null;
  component_types?: Array<{
    identifier: string;
    description: string;
    required?: boolean;
  }> | null;
  description: string;
  devices: Array<{
    name: string;
    capability: string;
    series?: string;
    examples?: string[];
  }>;
  references: Array<{
    title: string;
    url: string;
    type: "official" | "medical" | "research" | "tutorial";
  }>;
  last_updated: string;
  related_types?: Array<{
    identifier: string;
    relationship: string;
  }> | null;
  ios_introduced: {
    version: string;
    year: number;
    notes?: string;
  };
  watchos_introduced?: {
    version: string;
    year: number;
    notes?: string;
  } | null;
  deprecated?: boolean;
  deprecated_in?: string | null;
  writable: boolean;
  requires_authorization?: boolean;
  sensitive_data?: boolean;
  primary_source?: string | null;
  metadata_keys?: Array<{
    key: string;
    description: string;
    values?: string[];
  }> | null;
  statistics_options?: string[] | null;
  research_notes?: string | null;
  // Computed fields (not in schema, added by api.ts)
  slug: string;
  path: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  author: string;
  tags: string[];
  excerpt: string;
  content: string;
  featured_image?: string;
}

// Unified search types
export type SearchItemType = 'page' | 'blog' | 'healthkit';

export interface SearchItem {
  id: string;
  type: SearchItemType;
  title: string;
  description: string;
  href: string;
  icon?: string;
  color?: string;
  category?: string;
  tags?: string[];
}
