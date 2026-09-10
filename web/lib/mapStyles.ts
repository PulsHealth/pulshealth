// Basemap tile styles for the workout route map. All are free and need no API
// key (attribution required, set per-style). The user's choice persists in
// localStorage and is read by RouteMap; "auto" follows the app's dark/light
// theme so the map always matches the surrounding UI.

import type { ClientPref } from "./clientPref";

export type MapStyleId =
  | "auto"
  | "dark"
  | "light"
  | "voyager"
  | "osm"
  | "satellite"
  | "terrain";

export interface TileSpec {
  url: string;
  subdomains?: string;
  attribution: string;
  maxZoom: number;
}

export interface MapStyle {
  id: MapStyleId;
  label: string;
  description: string;
  // Concrete tiles, or null for "auto" (resolved against the theme at runtime).
  spec: TileSpec | null;
  // A representative background for the settings swatch (CSS value).
  swatch: string;
}

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

const CARTO_DARK: TileSpec = {
  url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  subdomains: "abcd",
  attribution: CARTO_ATTR,
  maxZoom: 20,
};

const CARTO_LIGHT: TileSpec = {
  url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  subdomains: "abcd",
  attribution: CARTO_ATTR,
  maxZoom: 20,
};

const CARTO_VOYAGER: TileSpec = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  subdomains: "abcd",
  attribution: CARTO_ATTR,
  maxZoom: 20,
};

const OSM: TileSpec = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  subdomains: "abc",
  attribution: OSM_ATTR,
  maxZoom: 19,
};

const SATELLITE: TileSpec = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
};

const TERRAIN: TileSpec = {
  url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  subdomains: "abc",
  attribution: `${OSM_ATTR}, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
  maxZoom: 17,
};

// Display order in the settings picker.
export const MAP_STYLES: MapStyle[] = [
  {
    id: "auto",
    label: "Auto",
    description: "Matches the app theme — dark map in dark mode, light in light mode.",
    spec: null,
    swatch: "linear-gradient(135deg, #14161b 0 50%, #e9ebee 50% 100%)",
  },
  {
    id: "dark",
    label: "Dark",
    description: "CARTO Dark Matter — minimal, low-glare basemap.",
    spec: CARTO_DARK,
    swatch: "#14161b",
  },
  {
    id: "light",
    label: "Light",
    description: "CARTO Positron — clean, pale basemap.",
    spec: CARTO_LIGHT,
    swatch: "#e9ebee",
  },
  {
    id: "voyager",
    label: "Voyager",
    description: "CARTO Voyager — subtle color with street detail.",
    spec: CARTO_VOYAGER,
    swatch: "linear-gradient(135deg, #eae5dd, #cfe0d6)",
  },
  {
    id: "osm",
    label: "Standard",
    description: "Classic OpenStreetMap — full colour and labels.",
    spec: OSM,
    swatch: "linear-gradient(135deg, #aadaa0, #cfe0ef)",
  },
  {
    id: "satellite",
    label: "Satellite",
    description: "Esri World Imagery — aerial photography.",
    spec: SATELLITE,
    swatch: "linear-gradient(135deg, #2f4a2a, #4a6b3f 60%, #6b7a55)",
  },
  {
    id: "terrain",
    label: "Terrain",
    description: "OpenTopoMap — contour lines and relief, good for trails.",
    spec: TERRAIN,
    swatch: "linear-gradient(135deg, #d9e7c8, #b5c79a)",
  },
];

export const DEFAULT_MAP_STYLE: MapStyleId = "auto";
export const MAP_STYLE_KEY = "puls-map-style";
// Same-tab change notification (storage events only fire cross-tab).
export const MAP_STYLE_EVENT = "puls-mapstylechange";

// Resolve a style id to concrete tiles, picking dark/light for "auto".
export function getTileSpec(id: MapStyleId, isDark: boolean): TileSpec {
  if (id === "auto") return isDark ? CARTO_DARK : CARTO_LIGHT;
  const found = MAP_STYLES.find((s) => s.id === id);
  return found?.spec ?? (isDark ? CARTO_DARK : CARTO_LIGHT);
}

export function readMapStyle(): MapStyleId {
  if (typeof window === "undefined") return DEFAULT_MAP_STYLE;
  try {
    const v = localStorage.getItem(MAP_STYLE_KEY) as MapStyleId | null;
    return v && MAP_STYLES.some((s) => s.id === v) ? v : DEFAULT_MAP_STYLE;
  } catch {
    return DEFAULT_MAP_STYLE;
  }
}

// The saved style as a subscribable preference. `writeMapStyle` already fires
// MAP_STYLE_EVENT for same-tab listeners, and `storage` covers other tabs.
export const mapStylePref: ClientPref<MapStyleId> = {
  read: readMapStyle,
  subscribe: (onChange) => {
    window.addEventListener(MAP_STYLE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(MAP_STYLE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  },
  serverDefault: DEFAULT_MAP_STYLE,
};

export function writeMapStyle(id: MapStyleId): void {
  try {
    localStorage.setItem(MAP_STYLE_KEY, id);
  } catch {}
  try {
    window.dispatchEvent(new Event(MAP_STYLE_EVENT));
  } catch {}
}
