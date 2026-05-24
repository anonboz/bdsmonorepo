import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { ErrorCodes, formatMoney } from '@repo/shared';

import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const RECEIPT_INCLUDE = {
  lines: { orderBy: { createdAt: 'asc' } },
  lease: {
    include: {
      tenant: { select: { displayName: true, email: true } },
      owner: { select: { displayName: true, email: true } },
      unit: {
        include: {
          house: {
            select: {
              name: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
              country: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BillInclude;

type ReceiptBill = Prisma.BillGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

export interface RenderedReceipt {
  buffer: Buffer;
  filename: string;
}

/**
 * Renders a one-page A4 PDF receipt for a Bill. Pure layout — no
 * authorization. Callers must verify access first by going through
 * BillsService.getForTenant() / getForLease() and only call this once
 * that resolves.
 *
 * pdfkit's API is stream-based; we collect chunks into a single Buffer
 * so the controller can set Content-Length and stream once.
 */
@Injectable()
export class BillsReceiptService {
  private readonly logger = new Logger(BillsReceiptService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async render(billId: string): Promise<RenderedReceipt> {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      include: RECEIPT_INCLUDE,
    });

    if (!bill) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.BILL_NOT_FOUND,
        title: 'Bill not found',
      });
    }

    const buffer = await renderPdf(bill);
    const filename = `bill-${bill.id}-${bill.periodStart.toISOString().slice(0, 10)}.pdf`;
    this.logger.log(`rendered receipt ${filename} (${buffer.length} bytes)`);
    return { buffer, filename };
  }
}

// ---- Pure layout (no DB / no Nest) -----------------------------------

async function renderPdf(bill: ReceiptBill): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const FONT_REGULAR = 'Helvetica';
  const FONT_BOLD = 'Helvetica-Bold';

  // Header band
  doc.font(FONT_BOLD).fontSize(24).text('BDS', { continued: true });
  doc.font(FONT_REGULAR).fontSize(12).text('  ·  Bill receipt', { align: 'left' });
  doc.moveDown(0.5);

  // "PAID" stamp top-right when applicable.
  if (bill.status === 'PAID') {
    const x = doc.page.width - 130;
    const y = 50;
    doc.save().lineWidth(2).strokeColor('#15803d').rect(x, y, 80, 28).stroke();
    doc
      .font(FONT_BOLD)
      .fontSize(16)
      .fillColor('#15803d')
      .text('PAID', x, y + 6, {
        width: 80,
        align: 'center',
      });
    doc.restore().fillColor('black');
  }

  doc.moveDown(0.8);

  // Bill meta block
  const period = `${ymd(bill.periodStart)} – ${ymd(bill.periodEnd)}`;
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Period', period);
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Due', ymd(bill.dueDate));
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Status', bill.status);
  if (bill.issuedAt) {
    metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Issued', isoUtc(bill.issuedAt));
  }
  doc.moveDown(0.5);
  hr(doc);
  doc.moveDown(0.5);

  // Parties + property
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Owner', bill.lease.owner.displayName);
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Tenant', bill.lease.tenant.displayName);
  const house = bill.lease.unit.house;
  const addressLines: string[] = [
    `${bill.lease.unit.label}, ${house.name}`,
    house.addressLine1,
    house.addressLine2 ?? '',
    [house.city, house.state ?? '', house.postalCode ?? ''].filter(Boolean).join(' '),
    house.country,
  ].filter((s): s is string => Boolean(s));
  metaLine(doc, FONT_BOLD, FONT_REGULAR, 'Unit', addressLines[0] ?? '');
  for (const line of addressLines.slice(1)) {
    doc.font(FONT_REGULAR).fontSize(10).text(line, { indent: 60 });
  }
  doc.moveDown(0.5);
  hr(doc);
  doc.moveDown(0.5);

  // Line items table
  const tableTop = doc.y;
  const col = { item: 50, qty: 380, amount: 460 };
  doc
    .font(FONT_BOLD)
    .fontSize(10)
    .fillColor('#666')
    .text('ITEM', col.item, tableTop)
    .text('QTY', col.qty, tableTop, { width: 40, align: 'right' })
    .text('AMOUNT', col.amount, tableTop, { width: 95, align: 'right' })
    .fillColor('black');

  let y = tableTop + 18;
  for (const line of bill.lines) {
    doc.font(FONT_REGULAR).fontSize(11);
    doc.text(line.label, col.item, y, { width: col.qty - col.item - 10 });
    doc.text(String(line.quantity), col.qty, y, { width: 40, align: 'right' });
    doc.text(formatMoney(line.amount, bill.currency, 'en'), col.amount, y, {
      width: 95,
      align: 'right',
    });
    y = doc.y + 8;
  }

  doc.moveDown(0.5);
  hr(doc);
  doc.moveDown(0.5);

  // Totals — pinned to English. Receipt audience is the operator
  // reviewing payments, not the tenant, so we keep one canonical
  // layout regardless of recipient locale.
  totalLine(doc, FONT_REGULAR, 'Subtotal', formatMoney(bill.subtotal, bill.currency, 'en'));
  totalLine(doc, FONT_BOLD, 'Total', formatMoney(bill.total, bill.currency, 'en'));

  // Footer
  doc.moveDown(2);
  doc
    .font(FONT_REGULAR)
    .fontSize(8)
    .fillColor('#999')
    .text(`Generated ${isoUtc(new Date())} · Bill ${bill.id}`, { align: 'center' })
    .fillColor('black');

  doc.end();
  return done;
}

function metaLine(
  doc: PDFKit.PDFDocument,
  bold: string,
  regular: string,
  label: string,
  value: string,
): void {
  doc.font(bold).fontSize(10).text(`${label}: `, { continued: true }).font(regular).text(value);
}

function totalLine(doc: PDFKit.PDFDocument, font: string, label: string, value: string): void {
  doc
    .font(font)
    .fontSize(11)
    .text(label, 380, doc.y, { width: 70, align: 'right', continued: true });
  doc.font(font).text(`  ${value}`, { align: 'right' });
}

function hr(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  doc
    .save()
    .strokeColor('#ddd')
    .lineWidth(0.5)
    .moveTo(50, y)
    .lineTo(doc.page.width - 50, y)
    .stroke()
    .restore();
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoUtc(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\..*/, ' UTC');
}
