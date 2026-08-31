import { Injectable } from '@angular/core';
import type { jsPDF } from 'jspdf';

export interface SheetLabelSource {
  svg: SVGSVGElement;
  copies: number;
}

export function calculateA4Layout(widthMm: number, heightMm: number, margin = 10, gap = 3) {
  const columns = Math.max(1, Math.floor((210 - margin * 2 + gap) / (widthMm + gap)));
  const rows = Math.max(1, Math.floor((297 - margin * 2 + gap) / (heightMm + gap)));
  return { columns, rows, perPage: columns * rows, margin, gap };
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private fontData?: Promise<{ regular: string; bold: string }>;

  downloadSvg(svg: SVGSVGElement, filename: string): void {
    this.download(new Blob([this.serialize(svg)], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`);
  }

  async downloadPng(svg: SVGSVGElement, widthMm: number, heightMm: number, filename: string): Promise<void> {
    const dpi = 300;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((widthMm / 25.4) * dpi);
    canvas.height = Math.round((heightMm / 25.4) * dpi);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas недоступен');

    const image = new Image();
    const url = URL.createObjectURL(new Blob([this.serialize(svg)], { type: 'image/svg+xml' }));
    await new Promise<void>((resolve, reject) => {
      image.onload = () => { context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(); };
      image.onerror = () => reject(new Error('Не удалось преобразовать SVG в PNG'));
      image.src = url;
    });
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Не удалось создать PNG')), 'image/png'),
    );
    this.download(blob, `${filename}.png`);
  }

  async downloadPdf(svg: SVGSVGElement, widthMm: number, heightMm: number, filename: string): Promise<void> {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    const pdf = new jsPDF({ orientation: widthMm >= heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [widthMm, heightMm], putOnlyUsedFonts: true });
    await this.registerPdfFonts(pdf);
    await svg2pdf(svg.cloneNode(true) as SVGSVGElement, pdf, { x: 0, y: 0, width: widthMm, height: heightMm });
    pdf.save(`${filename}.pdf`);
  }

  async downloadA4(svg: SVGSVGElement, widthMm: number, heightMm: number, copies: number, filename: string): Promise<void> {
    await this.downloadA4Batch([{ svg, copies }], widthMm, heightMm, filename);
  }

  async downloadA4Batch(items: SheetLabelSource[], widthMm: number, heightMm: number, filename: string): Promise<void> {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
    await this.registerPdfFonts(pdf);
    const { columns, perPage, margin, gap } = calculateA4Layout(widthMm, heightMm);
    let index = 0;

    for (const item of items) {
      for (let copy = 0; copy < item.copies; copy++, index++) {
        if (index > 0 && index % perPage === 0) pdf.addPage();
        const position = index % perPage;
        const x = margin + (position % columns) * (widthMm + gap);
        const y = margin + Math.floor(position / columns) * (heightMm + gap);
        await svg2pdf(item.svg.cloneNode(true) as SVGSVGElement, pdf, { x, y, width: widthMm, height: heightMm });
      }
    }
    pdf.save(`${filename}-a4.pdf`);
  }

  printA4Batch(items: SheetLabelSource[], widthMm: number, heightMm: number, title = 'Печать этикеток'): boolean {
    const popup = window.open('', '_blank', 'popup,width=1000,height=800');
    if (!popup) return false;
    const { columns, perPage, margin, gap } = calculateA4Layout(widthMm, heightMm);
    const pages: string[][] = [];
    let index = 0;

    for (const item of items) {
      for (let copy = 0; copy < item.copies; copy++, index++) {
        const pageIndex = Math.floor(index / perPage);
        const position = index % perPage;
        const x = margin + (position % columns) * (widthMm + gap);
        const y = margin + Math.floor(position / columns) * (heightMm + gap);
        pages[pageIndex] ??= [];
        pages[pageIndex].push(`<div class="label" style="left:${x}mm;top:${y}mm;width:${widthMm}mm;height:${heightMm}mm">${this.serialize(item.svg, `sheet-${index}`)}</div>`);
      }
    }

    const pageMarkup = pages.map(labels => `<section class="page">${labels.join('')}</section>`).join('');
    const regularFont = new URL('fonts/NotoSans-Regular.ttf', document.baseURI).href;
    const boldFont = new URL('fonts/NotoSans-Bold.ttf', document.baseURI).href;
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@font-face{font-family:NotoSans;src:url('${regularFont}');font-weight:400}@font-face{font-family:NotoSans;src:url('${boldFont}');font-weight:700}@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}.page{position:relative;width:210mm;height:297mm;overflow:hidden;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}.label{position:absolute}.label>svg{display:block;width:100%;height:100%;filter:none}@media screen{body{background:#dfe3dd}.page{margin:8mm auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.16)}}</style></head><body>${pageMarkup}<script>onload=()=>{document.fonts.ready.then(()=>{print();onafterprint=()=>close()})}<\/script></body></html>`);
    popup.document.close();
    return true;
  }

  private serialize(svg: SVGSVGElement, idSuffix = ''): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (idSuffix) this.namespaceIds(clone, idSuffix);
    return new XMLSerializer().serializeToString(clone);
  }

  private namespaceIds(svg: SVGSVGElement, suffix: string): void {
    const replacements = new Map<string, string>();
    for (const element of Array.from(svg.querySelectorAll('[id]'))) {
      const current = element.id;
      const next = `${current}-${suffix}`;
      replacements.set(current, next);
      element.id = next;
    }
    for (const element of Array.from(svg.querySelectorAll('*'))) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name === 'id') continue;
        let value = attribute.value;
        for (const [current, next] of replacements) {
          value = value.replaceAll(`url(#${current})`, `url(#${next})`);
          if (value === `#${current}`) value = `#${next}`;
        }
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      }
    }
  }

  private async registerPdfFonts(pdf: jsPDF): Promise<void> {
    const fonts = await this.loadPdfFonts();
    pdf.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
    pdf.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
    pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    pdf.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  }

  private loadPdfFonts(): Promise<{ regular: string; bold: string }> {
    return this.fontData ??= Promise.all([
      this.fetchFont('fonts/NotoSans-Regular.ttf'),
      this.fetchFont('fonts/NotoSans-Bold.ttf'),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }

  private async fetchFont(path: string): Promise<string> {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error(`Шрифт PDF недоступен (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
