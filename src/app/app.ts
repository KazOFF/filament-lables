import { CommonModule } from '@angular/common';
import { Component, OnInit, QueryList, ViewChild, ViewChildren, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CatalogService } from './catalog.service';
import { ExportService, SheetLabelSource, calculateA4Layout } from './export.service';
import { Filament, LabelOptions, MaterialType } from './models';
import { LabelPreviewComponent } from './label-preview.component';

const EMPTY_FILAMENT: Filament = {
  id: '', manufacturer: 'Bambu Lab', name: '', material: 'PLA', colorName: 'Новый цвет', colorHex: '#7CFF6B',
  settings: { nozzleMin: 190, nozzleMax: 230, bedMin: 35, bedMax: 45, speed: 250, fan: 100, dryingTemperature: 55, dryingHours: 8 },
  updatedAt: '',
};

interface SheetQueueItem {
  key: string;
  filament: Filament;
  copies: number;
}

@Component({
  selector: 'app-root', imports: [CommonModule, ReactiveFormsModule, LabelPreviewComponent], templateUrl: './app.html', styleUrl: './app.scss',
})
export class App implements OnInit {
  @ViewChild('editorPreview') editorPreview?: LabelPreviewComponent;
  @ViewChild('quickPreview') quickPreview?: LabelPreviewComponent;
  @ViewChildren('sheetPreview') sheetPreviews?: QueryList<LabelPreviewComponent>;
  readonly catalog = inject(CatalogService);
  private readonly exporter = inject(ExportService);
  private readonly fb = inject(FormBuilder);
  readonly activeTab = signal<'editor' | 'catalog'>('catalog');
  readonly current = signal<Filament>(structuredClone(EMPTY_FILAMENT));
  readonly search = signal('');
  readonly manufacturerFilter = signal('Все');
  readonly materialFilter = signal('Все');
  readonly seriesFilter = signal('Все');
  readonly quickTarget = signal<Filament | null>(null);
  readonly sheetOpen = signal(false);
  readonly sheetItems = signal<SheetQueueItem[]>([]);
  readonly selectedSheetKey = signal<string | null>(null);
  readonly selectedSheetItem = computed(() => this.sheetItems().find(item => item.key === this.selectedSheetKey()) ?? this.sheetItems()[0] ?? null);
  readonly toast = signal('');
  readonly materials: MaterialType[] = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PC', 'PA', 'PVA', 'Другое'];
  readonly catalogManufacturers = computed(() => ['Все', ...new Set(this.catalog.filaments().map(item => item.manufacturer))]);
  readonly catalogMaterials = computed(() => ['Все', ...new Set(this.catalog.filaments().map(item => item.material))]);
  readonly catalogSeries = computed(() => ['Все', ...new Set(this.catalog.filaments()
    .filter(item => this.manufacturerFilter() === 'Все' || item.manufacturer === this.manufacturerFilter())
    .filter(item => this.materialFilter() === 'Все' || item.material === this.materialFilter())
    .map(item => item.name))]);
  readonly filteredFilaments = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('ru');
    return this.catalog.filaments().filter(item => (!query || `${item.manufacturer} ${item.name} ${item.material} ${item.colorName} ${item.colorCode ?? ''}`.toLocaleLowerCase('ru').includes(query))
      && (this.manufacturerFilter() === 'Все' || item.manufacturer === this.manufacturerFilter())
      && (this.materialFilter() === 'Все' || item.material === this.materialFilter())
      && (this.seriesFilter() === 'Все' || item.name === this.seriesFilter()));
  });
  readonly filamentForm = this.fb.nonNullable.group({
    id: [''], manufacturer: ['', [Validators.required, Validators.maxLength(50)]], name: ['', [Validators.required, Validators.maxLength(60)]],
    material: ['PLA' as MaterialType, Validators.required], colorName: ['', Validators.required], colorHex: ['#7CFF6B', Validators.required], logo: [''], logoMonochrome: [''],
    settings: this.fb.nonNullable.group({
      nozzleMin: [190, [Validators.required, Validators.min(0), Validators.max(500)]], nozzleMax: [230, [Validators.required, Validators.min(0), Validators.max(500)]],
      bedMin: [35, [Validators.required, Validators.min(0), Validators.max(200)]], bedMax: [45, [Validators.required, Validators.min(0), Validators.max(200)]],
      speed: [250, [Validators.required, Validators.min(1), Validators.max(1000)]], fan: [100, [Validators.required, Validators.min(0), Validators.max(100)]],
      dryingTemperature: [55, [Validators.required, Validators.min(0), Validators.max(150)]], dryingHours: [8, [Validators.required, Validators.min(0), Validators.max(72)]],
    }),
  });
  readonly labelForm = this.fb.nonNullable.group({
    width: [80, [Validators.required, Validators.min(40), Validators.max(190)]], height: [50, [Validators.required, Validators.min(25), Validators.max(277)]],
    template: ['light' as LabelOptions['template']], colorMode: ['color' as LabelOptions['colorMode']], copies: [12, [Validators.required, Validators.min(1), Validators.max(100)]],
    showColor: [true], showTemperatures: [true], showSpeed: [true], showFan: [true], showDrying: [true], showCutLine: [true],
  });
  readonly sheetForm = this.fb.nonNullable.group({
    width: [80, [Validators.required, Validators.min(40), Validators.max(190)]], height: [50, [Validators.required, Validators.min(25), Validators.max(277)]],
    template: ['light' as LabelOptions['template']], colorMode: ['color' as LabelOptions['colorMode']],
    showColor: [true], showTemperatures: [true], showSpeed: [true], showFan: [true], showDrying: [true], showCutLine: [true],
  });
  private readonly sheetFormRevision = signal(0);
  readonly sheetTotal = computed(() => this.sheetItems().reduce((sum, item) => sum + item.copies, 0));
  readonly sheetCapacity = computed(() => {
    this.sheetFormRevision();
    const { width, height } = this.sheetForm.getRawValue();
    return calculateA4Layout(Math.max(width, 1), Math.max(height, 1)).perPage;
  });
  readonly sheetPages = computed(() => Math.ceil(this.sheetTotal() / this.sheetCapacity()));
  private customSheetSequence = 0;

  constructor() {
    this.filamentForm.valueChanges.subscribe(() => this.syncCurrent());
    this.sheetForm.valueChanges.subscribe(() => this.sheetFormRevision.update(value => value + 1));
    this.setForm({ ...structuredClone(EMPTY_FILAMENT), id: 'custom-preview' });
  }
  async ngOnInit(): Promise<void> { await this.catalog.initialize(); }
  newFilament(): void { this.setForm({ ...structuredClone(EMPTY_FILAMENT), id: 'custom-preview' }); this.activeTab.set('editor'); }
  async handleLogo(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type) || file.size > 2_000_000) { this.notify('Выберите SVG, PNG или JPEG размером до 2 МБ'); return; }
    try {
      const logo = await this.readAsDataUrl(file);
      const logoMonochrome = await this.createMonochromeLogo(logo);
      this.filamentForm.patchValue({ logo, logoMonochrome });
    } catch { this.notify('Не удалось обработать логотип'); }
  }
  removeLogo(): void { this.filamentForm.patchValue({ logo: '', logoMonochrome: '' }); }
  openQuickPrint(item: Filament): void { this.quickTarget.set(item); }
  closeQuickPrint(): void { this.quickTarget.set(null); }
  addCatalogToSheet(item: Filament): void { this.addToSheet(item, item.id, true); }
  addCustomToSheet(): void {
    if (!this.customValuesValid()) return;
    const snapshot = structuredClone(this.current());
    const key = `custom-${Date.now()}-${this.customSheetSequence++}`;
    snapshot.id = key;
    this.addToSheet(snapshot, key, false);
  }
  openSheet(): void {
    if (!this.sheetItems().length) { this.notify('Добавьте хотя бы одну этикетку на лист'); return; }
    if (!this.sheetItems().some(item => item.key === this.selectedSheetKey())) this.selectedSheetKey.set(this.sheetItems()[0].key);
    this.sheetOpen.set(true);
  }
  closeSheet(): void { this.sheetOpen.set(false); }
  setSheetCopies(key: string, rawValue: string): void {
    const items = this.sheetItems();
    const current = items.find(item => item.key === key);
    if (!current) return;
    const requested = Number.parseInt(rawValue, 10);
    const otherCopies = this.sheetTotal() - current.copies;
    const copies = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 1, 100 - otherCopies));
    this.sheetItems.set(items.map(item => item.key === key ? { ...item, copies } : item));
    if (copies !== requested) this.notify('На одном пакете можно подготовить до 100 этикеток');
  }
  selectSheetItem(key: string): void { this.selectedSheetKey.set(key); }
  removeSheetItem(key: string): void {
    const items = this.sheetItems();
    const index = items.findIndex(item => item.key === key);
    const remaining = items.filter(item => item.key !== key);
    this.sheetItems.set(remaining);
    if (this.selectedSheetKey() === key) this.selectedSheetKey.set(remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.key ?? null);
  }
  clearSheet(): void { this.sheetItems.set([]); this.selectedSheetKey.set(null); this.closeSheet(); }
  labelOptions(): LabelOptions { return this.labelForm.getRawValue(); }
  sheetOptions(): LabelOptions { return { ...this.sheetForm.getRawValue(), copies: 1 }; }
  previewMaxWidth(maxHeight: number): number {
    const { width, height } = this.labelForm.getRawValue();
    return maxHeight * Math.max(width, 1) / Math.max(height, 1);
  }
  sheetPreviewMaxWidth(maxHeight: number): number {
    const { width, height } = this.sheetForm.getRawValue();
    return maxHeight * Math.max(width, 1) / Math.max(height, 1);
  }
  colorLabel(item: Filament): string { return item.colorCode ? `${item.colorName} (${item.colorCode})` : item.colorName; }
  setManufacturerFilter(value: string): void {
    this.manufacturerFilter.set(value);
    if (!this.catalogSeries().includes(this.seriesFilter())) this.seriesFilter.set('Все');
  }
  setMaterialFilter(value: string): void {
    this.materialFilter.set(value);
    if (!this.catalogSeries().includes(this.seriesFilter())) this.seriesFilter.set('Все');
  }
  hasCardSettings(item: Filament): boolean {
    const settings = item.settings;
    return settings.nozzleMin !== undefined || settings.bedMin !== undefined || settings.speed !== undefined;
  }
  swatch(item: Filament): string { return (item.colorHexes?.length ?? 0) > 1 ? `linear-gradient(135deg, ${item.colorHexes!.join(', ')})` : item.colorHex; }
  async outputSheet(mode: 'pdf' | 'print'): Promise<void> {
    if (!this.sheetItems().length) { this.notify('Лист печати пуст'); return; }
    if (this.sheetForm.invalid) { this.sheetForm.markAllAsTouched(); this.notify('Проверьте размер этикеток'); return; }
    const previews = this.sheetPreviews?.toArray() ?? [];
    if (previews.length !== this.sheetItems().length || previews.some(preview => !preview.element)) {
      this.notify('Предпросмотр листа ещё не готов');
      return;
    }
    const sources: SheetLabelSource[] = this.sheetItems().map((item, index) => ({ svg: previews[index].element!, copies: item.copies }));
    const { width, height } = this.sheetForm.getRawValue();
    try {
      if (mode === 'pdf') {
        await this.exporter.downloadA4Batch(sources, width, height, 'filament-labels-sheet');
        this.notify('PDF-лист подготовлен');
      } else if (!this.exporter.printA4Batch(sources, width, height)) {
        this.notify('Разрешите всплывающие окна для печати');
      }
    } catch { this.notify('Не удалось подготовить лист'); }
  }
  async export(format: 'svg' | 'png' | 'pdf' | 'a4', quick = false): Promise<void> {
    const svg = (quick ? this.quickPreview : this.editorPreview)?.element; if (!svg || this.labelForm.invalid) return;
    if (!quick && !this.customValuesValid()) return;
    const item = quick ? this.quickTarget() ?? this.current() : this.current();
    const { width, height, copies } = this.labelForm.getRawValue(); const filename = this.slug(`${item.manufacturer}-${item.name}-${this.colorLabel(item)}`);
    try {
      if (format === 'svg') this.exporter.downloadSvg(svg, filename);
      if (format === 'png') await this.exporter.downloadPng(svg, width, height, filename);
      if (format === 'pdf') await this.exporter.downloadPdf(svg, width, height, filename);
      if (format === 'a4') await this.exporter.downloadA4(svg, width, height, copies, filename);
      this.notify('Файл подготовлен');
    } catch { this.notify('Не удалось подготовить файл'); }
  }
  printLabel(quick = false): void {
    const svg = (quick ? this.quickPreview : this.editorPreview)?.element; if (!svg) return;
    if (!quick && !this.customValuesValid()) return;
    const { width, height } = this.labelForm.getRawValue(); const popup = window.open('', '_blank', 'popup,width=900,height=700');
    if (!popup) { this.notify('Разрешите всплывающие окна для печати'); return; }
    const markup = new XMLSerializer().serializeToString(svg);
    const regularFont = new URL('fonts/NotoSans-Regular.ttf', document.baseURI).href;
    const boldFont = new URL('fonts/NotoSans-Bold.ttf', document.baseURI).href;
    popup.document.write(`<!doctype html><html><head><title>Печать этикетки</title><style>@font-face{font-family:NotoSans;src:url('${regularFont}');font-weight:400}@font-face{font-family:NotoSans;src:url('${boldFont}');font-weight:700}@page{size:${width}mm ${height}mm;margin:0}*{box-sizing:border-box}body{margin:0}svg{display:block;width:${width}mm;height:${height}mm}</style></head><body>${markup}<script>onload=()=>{document.fonts.ready.then(()=>{print();onafterprint=()=>close()})}<\/script></body></html>`); popup.document.close();
  }
  private setForm(item: Filament): void { this.current.set(structuredClone(item)); this.filamentForm.reset({ ...structuredClone(item), logo: item.logo ?? '', logoMonochrome: item.logoMonochrome ?? '' }); this.syncCurrent(); }
  private addToSheet(filament: Filament, key: string, merge: boolean): void {
    if (this.sheetTotal() >= 100) { this.notify('На одном пакете можно подготовить до 100 этикеток'); return; }
    const items = this.sheetItems();
    const existing = merge ? items.find(item => item.key === key) : undefined;
    const nextItems = existing
      ? items.map(item => item.key === key ? { ...item, copies: item.copies + 1 } : item)
      : [...items, { key, filament: structuredClone(filament), copies: 1 }];
    this.sheetItems.set(nextItems);
    if (!this.selectedSheetKey()) this.selectedSheetKey.set(key);
    this.notify('Этикетка добавлена на лист');
  }
  private syncCurrent(): void { const value = this.filamentForm.getRawValue(); this.current.set({ ...this.current(), ...value, logo: value.logo || undefined, logoMonochrome: value.logoMonochrome || undefined, updatedAt: this.current().updatedAt || new Date().toISOString() }); }
  private readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  private createMonochromeLogo(source: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const sourceWidth = image.naturalWidth || 512;
        const sourceHeight = image.naturalHeight || 512;
        const scale = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('Canvas is unavailable')); return; }
        context.filter = 'grayscale(1)';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => reject(new Error('Logo is invalid'));
      image.src = source;
    });
  }
  private rangesValid(): boolean { const s = this.filamentForm.controls.settings.getRawValue(); return s.nozzleMin <= s.nozzleMax && s.bedMin <= s.bedMax; }
  private customValuesValid(): boolean {
    if (!this.filamentForm.invalid && this.rangesValid()) return true;
    this.filamentForm.markAllAsTouched();
    this.notify('Проверьте пользовательские значения и диапазоны температур');
    return false;
  }
  private slug(value: string): string { return value.toLocaleLowerCase('ru').replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'label'; }
  private notify(message: string): void { this.toast.set(message); window.setTimeout(() => { if (this.toast() === message) this.toast.set(''); }, 2800); }
}
