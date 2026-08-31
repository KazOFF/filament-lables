import { Component, ElementRef, ViewChild, computed, input } from '@angular/core';
import { Filament, LabelOptions } from './models';

interface LabelParameter {
  id: 'nozzle' | 'bed' | 'speed' | 'fan' | 'drying';
  label: string;
  value: string;
}

@Component({
  selector: 'app-label-preview',
  templateUrl: './label-preview.component.html',
  styleUrl: './label-preview.component.scss',
})
export class LabelPreviewComponent {
  readonly Math = Math;
  @ViewChild('svg', { static: true }) private svg?: ElementRef<SVGSVGElement>;
  readonly filament = input.required<Filament>();
  readonly options = input.required<LabelOptions>();
  readonly scale = computed(() => Math.min(this.options().width / 80, this.options().height / 50, 1));
  readonly fontScale = computed(() => Math.sqrt(this.scale()));
  readonly colorLabel = computed(() => {
    const filament = this.filament();
    return filament.colorCode ? `${filament.colorName} (${filament.colorCode})` : filament.colorName;
  });
  readonly colorFontSize = computed(() => {
    const preferredSize = this.fu(2.7);
    const availableWidth = Math.max(this.u(10), this.options().width - this.colorTextX() - this.u(4));
    const fittedSize = availableWidth / Math.max(1, this.colorLabel().length * .56);
    return Math.min(preferredSize, fittedSize);
  });
  readonly seriesFontSize = computed(() => {
    const preferredSize = this.fu(4.2);
    const availableWidth = Math.max(this.u(10), this.options().width - this.u(16));
    const fittedSize = availableWidth / Math.max(1, this.filament().name.length * .56);
    return Math.min(preferredSize, fittedSize);
  });
  readonly materialFontSize = computed(() => {
    const preferredSize = this.fu(5);
    const availableWidth = Math.max(this.u(10), this.options().width - this.u(30));
    const fittedSize = availableWidth / Math.max(1, this.filament().material.length * .58);
    return Math.min(preferredSize, fittedSize);
  });
  readonly parameterRows = computed<LabelParameter[][]>(() => {
    const options = this.options();
    const settings = this.filament().settings;
    const parameters: LabelParameter[] = [];
    if (options.showTemperatures) {
      if (settings.nozzleMin !== undefined && settings.nozzleMax !== undefined)
        parameters.push({ id: 'nozzle', label: 'СОПЛО', value: `${settings.nozzleMin}–${settings.nozzleMax}°` });
      if (settings.bedMin !== undefined && settings.bedMax !== undefined)
        parameters.push({ id: 'bed', label: 'СТОЛ', value: `${settings.bedMin}–${settings.bedMax}°` });
    }
    if (options.showSpeed && settings.speed !== undefined) parameters.push({ id: 'speed', label: 'СКОРОСТЬ', value: `до ${settings.speed} мм/с` });
    if (options.showFan && settings.fan !== undefined) parameters.push({ id: 'fan', label: 'ОБДУВ', value: `${settings.fan}%` });
    if (options.showDrying && settings.dryingTemperature !== undefined && settings.dryingHours !== undefined)
      parameters.push({ id: 'drying', label: 'СУШКА', value: `${settings.dryingTemperature}° · ${settings.dryingHours}ч` });

    if (parameters.length <= 3) return parameters.length ? [parameters] : [];
    if (parameters.length === 4) return [parameters.slice(0, 2), parameters.slice(2)];
    return [parameters.slice(0, 3), parameters.slice(3)];
  });

  get element(): SVGSVGElement | undefined { return this.svg?.nativeElement; }
  u(value: number): number { return value * this.scale(); }
  fu(value: number): number { return value * this.fontScale(); }
  isMonochrome(): boolean { return this.options().colorMode === 'monochrome'; }
  manufacturerY(): number { return this.u(8) - this.typographyBoost(2.5); }
  colorTextX(): number { return this.isMonochrome() ? this.u(9) : this.u(13.5); }
  logoSource(): string | undefined { return this.isMonochrome() ? this.filament().logoMonochrome ?? this.filament().logo : this.filament().logo; }
  parameterX(index: number, count: number): number {
    const left = this.u(9);
    const availableWidth = this.options().width - left - this.u(7);
    return left + availableWidth / count * index;
  }
  parameterLabelY(rowIndex: number, rowCount: number): number {
    return this.options().height - this.u(7.5) - this.typographyBoost(2.5) - (rowCount - rowIndex - 1) * this.parameterRowGap();
  }
  parameterValueY(rowIndex: number, rowCount: number): number {
    return this.options().height - this.u(3.2) - (rowCount - rowIndex - 1) * this.parameterRowGap();
  }
  bg(): string { return this.options().template === 'dark' ? '#111411' : '#FCFCF7'; }
  fg(): string { return this.options().template === 'dark' ? '#F5F7F2' : '#171A17'; }
  muted(): string { return this.options().template === 'dark' ? '#A5ADA4' : '#687068'; }
  accent(): string {
    if (!this.isMonochrome()) return this.options().template === 'outline' ? '#171A17' : this.filament().colorHex;
    if (this.options().template === 'dark') return '#3C433D';
    return this.options().template === 'outline' ? '#171A17' : '#D9DED8';
  }
  colorFill(): string { return (this.filament().colorHexes?.length ?? 0) > 1 ? 'url(#filament-gradient)' : this.filament().colorHex; }
  accentText(): string {
    if (this.isMonochrome()) return this.options().template === 'dark' ? '#F5F7F2' : '#171A17';
    const hex = this.filament().colorHex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 170 ? '#172018' : '#fff';
  }
  private parameterRowGap(): number { return this.u(8.3) + this.typographyBoost(4.5); }
  private typographyBoost(value: number): number { return (this.fontScale() - this.scale()) * value; }
}
