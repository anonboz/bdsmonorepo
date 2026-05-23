import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

import type { ImageProcessor } from './media.service.js';

/** Inscribed thumbnail box. v1 ships a single 320px variant — see
 *  the §9 out-of-scope notes in the phase 10.3 spec. */
const THUMBNAIL_PX = 320;
const THUMBNAIL_QUALITY = 75;

/**
 * Production implementation of {@link ImageProcessor} backed by sharp.
 *
 * `stripExif` re-encodes through sharp without explicitly forwarding
 * metadata — sharp's default behaviour drops EXIF / IPTC / XMP. The
 * output preserves the source MIME so a JPEG stays a JPEG and a PNG
 * stays a PNG; the thumbnail variant is always JPEG because that's
 * what every browser renders consistently at small sizes.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  async stripExif(input: { bytes: Buffer; contentType: string }): Promise<Buffer> {
    const pipeline = sharp(input.bytes, { failOn: 'error' }).rotate();
    // .rotate() applies the EXIF orientation flag to pixel data, so
    // the re-encoded output renders the right way up without needing
    // the flag preserved.
    if (input.contentType.includes('png')) return pipeline.png().toBuffer();
    if (input.contentType.includes('webp')) return pipeline.webp().toBuffer();
    return pipeline.jpeg({ mozjpeg: true }).toBuffer();
  }

  async thumbnail(input: { bytes: Buffer }): Promise<Buffer> {
    return sharp(input.bytes, { failOn: 'error' })
      .rotate()
      .resize({ width: THUMBNAIL_PX, height: THUMBNAIL_PX, fit: 'inside' })
      .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
      .toBuffer();
  }
}
