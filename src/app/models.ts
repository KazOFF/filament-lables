export type MaterialType = string;

export interface PrintSettings {
  nozzleMin?: number;
  nozzleMax?: number;
  bedMin?: number;
  bedMax?: number;
  speed?: number;
  fan?: number;
  dryingTemperature?: number;
  dryingHours?: number;
}

export interface Filament {
  id: string;
  manufacturer: string;
  name: string;
  material: MaterialType;
  colorName: string;
  colorCode?: string;
  colorHex: string;
  colorHexes?: string[];
  logo?: string;
  logoMonochrome?: string;
  settings: PrintSettings;
  sources?: {
    technical: CatalogSource;
    availability: CatalogSource;
  };
  updatedAt: string;
}

export interface LabelOptions {
  width: number;
  height: number;
  template: 'light' | 'dark' | 'outline';
  colorMode: 'color' | 'monochrome';
  copies: number;
  showColor: boolean;
  showTemperatures: boolean;
  showSpeed: boolean;
  showFan: boolean;
  showDrying: boolean;
  showCutLine: boolean;
}

export interface FilamentColorDefinition {
  id: string;
  name: string;
  colorCode?: string;
  hexes: string[];
  colorAccuracy?: 'official' | 'estimated';
}

export interface FilamentSeriesDefinition {
  id: string;
  name: string;
  material: MaterialType;
  sources?: {
    technical: CatalogSource;
    availability: CatalogSource;
  };
  settings: PrintSettings;
  colors: FilamentColorDefinition[];
}

export interface FilamentCatalogFile {
  schemaVersion: 3;
  id: string;
  manufacturer: string;
  verifiedAt: string;
  logos: { color: string; monochrome: string };
  sources: {
    technical: CatalogSource;
    availability: CatalogSource;
  };
  series: FilamentSeriesDefinition[];
}

export interface CatalogSource {
  name: string;
  url: string;
  verifiedAt?: string;
}

export interface CatalogManifest {
  schemaVersion: 1;
  catalogs: string[];
}
