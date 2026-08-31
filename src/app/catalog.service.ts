import { Injectable, signal } from '@angular/core';
import { CatalogManifest, Filament, FilamentCatalogFile, FilamentSeriesDefinition, PrintSettings } from './models';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  readonly filaments = signal<Filament[]>([]);
  readonly ready = signal(false);
  readonly loadError = signal('');

  async initialize(): Promise<void> {
    await this.deleteLegacyDatabase();
    try {
      const { items, errors } = await this.loadCatalogs();
      this.filaments.set(items.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name) || a.colorName.localeCompare(b.colorName)));
      this.loadError.set(errors.join(' '));
    } catch (error) {
      this.filaments.set([]);
      this.loadError.set(error instanceof Error ? error.message : 'Не удалось загрузить встроенный каталог');
    } finally {
      this.ready.set(true);
    }
  }

  private async loadCatalogs(): Promise<{ items: Filament[]; errors: string[] }> {
    const response = await fetch('data/catalog-manifest.json');
    if (!response.ok) throw new Error(`Манифест каталога недоступен (${response.status})`);
    const manifest: unknown = await response.json();
    if (!this.isManifest(manifest)) throw new Error('Манифест каталога повреждён или имеет неизвестную версию');
    const results = await Promise.allSettled(manifest.catalogs.map(path => this.loadCatalog(path)));
    const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const errors = results.flatMap((result, index) => result.status === 'rejected'
      ? [`Не загружен ${manifest.catalogs[index]}: ${result.reason instanceof Error ? result.reason.message : 'неизвестная ошибка'}.`]
      : []);
    if (!items.length) throw new Error(errors.join(' ') || 'Встроенные каталоги пусты');
    return { items, errors };
  }

  private async loadCatalog(path: string): Promise<Filament[]> {
    const response = await fetch(`data/${path}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!this.isCatalog(value)) throw new Error('повреждён или имеет неизвестную версию');
    const [logo, logoMonochrome] = await Promise.all([
      this.loadSvgAsset(value.logos.color),
      this.loadSvgAsset(value.logos.monochrome),
    ]);
    const ids = new Set<string>();
    return value.series.flatMap(series => series.colors.map(color => {
      const id = `${value.id}-${series.id}-${color.id}`;
      if (ids.has(id)) throw new Error(`В каталоге повторяется идентификатор ${id}`);
      ids.add(id);
      return {
        id, manufacturer: value.manufacturer, name: series.name, material: series.material,
        colorName: color.name, colorCode: color.colorCode, colorHex: color.hexes[0], colorHexes: color.hexes,
        logo, logoMonochrome,
        settings: { ...series.settings }, sources: {
          technical: { ...(series.sources ?? value.sources).technical, verifiedAt: value.verifiedAt },
          availability: { ...(series.sources ?? value.sources).availability, verifiedAt: value.verifiedAt },
        }, updatedAt: `${value.verifiedAt}T00:00:00.000Z`,
      } satisfies Filament;
    }));
  }

  private async loadSvgAsset(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Ресурс каталога недоступен (${response.status})`);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await response.text())}`;
  }

  private isCatalog(value: unknown): value is FilamentCatalogFile {
    if (!this.isRecord(value) || value['schemaVersion'] !== 3 || typeof value['id'] !== 'string' ||
        !/^[a-z0-9-]+$/.test(value['id']) || typeof value['manufacturer'] !== 'string' ||
        typeof value['verifiedAt'] !== 'string' || !this.isRecord(value['logos']) || !this.isRecord(value['sources']) || !Array.isArray(value['series'])) return false;
    const logos = value['logos'];
    const sources = value['sources'];
    if (typeof logos['color'] !== 'string' || typeof logos['monochrome'] !== 'string' ||
        !this.isSource(sources['technical']) || !this.isSource(sources['availability'])) return false;
    return value['series'].every(item => this.isSeries(item));
  }

  private isSeries(value: unknown): value is FilamentSeriesDefinition {
    if (!this.isRecord(value) || typeof value['id'] !== 'string' || typeof value['name'] !== 'string' ||
        typeof value['material'] !== 'string' || (value['sources'] !== undefined && !this.isRecord(value['sources'])) || !this.isRecord(value['settings']) ||
        !Array.isArray(value['colors'])) return false;
    const sources = value['sources'];
    const settings = value['settings'];
    const settingKeys: Array<keyof PrintSettings> = ['nozzleMin', 'nozzleMax', 'bedMin', 'bedMax', 'speed', 'fan', 'dryingTemperature', 'dryingHours'];
    const sourcesValid = sources === undefined || (this.isRecord(sources) && this.isSource(sources['technical']) && this.isSource(sources['availability']));
    return sourcesValid &&
      settingKeys.every(key => settings[key] === undefined || typeof settings[key] === 'number') &&
      this.isPair(settings, 'nozzleMin', 'nozzleMax') && this.isPair(settings, 'bedMin', 'bedMax') &&
      this.isPair(settings, 'dryingTemperature', 'dryingHours') &&
      value['colors'].every(color => this.isRecord(color) && typeof color['id'] === 'string' && typeof color['name'] === 'string' &&
        (color['colorCode'] === undefined || typeof color['colorCode'] === 'string') &&
        (color['colorAccuracy'] === undefined || color['colorAccuracy'] === 'official' || color['colorAccuracy'] === 'estimated') &&
        Array.isArray(color['hexes']) && color['hexes'].length > 0 && color['hexes'].every(hex => typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex)));
  }

  private isManifest(value: unknown): value is CatalogManifest {
    return this.isRecord(value) && value['schemaVersion'] === 1 && Array.isArray(value['catalogs']) &&
      value['catalogs'].length > 0 && value['catalogs'].every(path => typeof path === 'string' && /^[a-z0-9-]+\.json$/.test(path));
  }

  private isSource(value: unknown): boolean {
    return this.isRecord(value) && typeof value['name'] === 'string' && typeof value['url'] === 'string';
  }

  private isPair(settings: Record<string, unknown>, first: keyof PrintSettings, second: keyof PrintSettings): boolean {
    return (settings[first] === undefined) === (settings[second] === undefined);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private deleteLegacyDatabase(): Promise<void> {
    if (!globalThis.indexedDB) return Promise.resolve();
    return new Promise(resolve => {
      const request = indexedDB.deleteDatabase('filament-labels');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
}
