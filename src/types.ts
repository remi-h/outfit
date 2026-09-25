export type Category = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'dress' | 'accessory';
export type Formality = 'casual' | 'smart' | 'formal';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface ItemTags {
  category: Category;
  color: string;
  warmth: 1 | 2 | 3 | 4 | 5;
  formality: Formality;
  rainproof: boolean;
  season: Season[];          // one or more; all four = year-round
}

export interface ClosetItem {
  id: string;                // uuid
  photoUri: string;          // file:// in documentDirectory/closet/
  createdAt: string;         // ISO
  tags: ItemTags | null;
  tagStatus: 'pending' | 'tagging' | 'tagged' | 'failed';
}

export interface DayForecast {
  date: string;              // YYYY-MM-DD
  tMaxC: number;
  tMinC: number;
  rainChance: number;        // 0–100
  weatherCode: number;       // WMO
}

export interface Forecast {
  fetchedAt: string;
  latitude: number;
  longitude: number;
  locationName: string;
  days: DayForecast[];       // 7
}

export interface DayPlan {
  date: string;
  itemIds: string[];
  reason: string;
  generatedAt: string;
  status: 'ok' | 'failed';   // failed = AI/validation failed twice; card shows error + Regenerate
}

export interface Settings {
  unit: 'C' | 'F';
  stylePreference: string;
  locationOverride: { name: string; latitude: number; longitude: number } | null;
}

export type DressCodes = Record<string /* date */, Formality>;
