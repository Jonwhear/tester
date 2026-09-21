/**
 * Turning an image file into something a question bank can carry.
 *
 * Bank files are meant to be single, portable JSON documents that can be
 * emailed or committed, so an attached image is embedded as a data URL rather
 * than referenced from disk — a relative path would break the moment the file
 * moved.
 *
 * That makes size the thing to manage: a phone photo of a slide is several
 * megabytes, and a few dozen of those make a bank unusable. Images are
 * therefore downscaled to a sane maximum and re-encoded before embedding,
 * unless they are already small.
 */

export const DEFAULT_MAX_WIDTH = 1400;
export const DEFAULT_MAX_HEIGHT = 1400;
/** Below this, re-encoding usually costs more bytes than it saves. */
export const REENCODE_THRESHOLD_BYTES = 120 * 1024;

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  /** Bytes of the embedded data URL payload. */
  bytes: number;
  originalBytes: number;
  resized: boolean;
  type: string;
}

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImageError('Could not read the image file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ImageError('That file could not be decoded as an image.'));
    image.src = src;
  });
}

/** Approximate decoded byte length of a data URL's payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return dataUrl.length;
  const payload = dataUrl.slice(comma + 1);
  if (!dataUrl.slice(0, comma).includes(';base64')) return payload.length;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

export interface PrepareImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  /** JPEG/WebP quality, 0-1. Ignored for PNG and SVG. */
  quality?: number;
}

/**
 * Read an image file and return an embeddable data URL.
 *
 * SVG is passed through untouched — it is already compact and vector, and
 * rasterizing it would lose that. It is embedded as a data URL and rendered
 * inside an `<img>`, which does not execute script.
 */
export async function prepareImage(
  file: File,
  options: PrepareImageOptions = {},
): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new ImageError(`"${file.name}" is not an image file.`);
  }

  const originalBytes = file.size;
  const original = await readAsDataUrl(file);

  if (file.type === 'image/svg+xml') {
    return {
      dataUrl: original,
      width: 0,
      height: 0,
      bytes: dataUrlBytes(original),
      originalBytes,
      resized: false,
      type: file.type,
    };
  }

  const image = await loadImage(original);
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;

  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  const needsResize = scale < 1;

  if (!needsResize && originalBytes <= REENCODE_THRESHOLD_BYTES) {
    return {
      dataUrl: original,
      width: image.width,
      height: image.height,
      bytes: dataUrlBytes(original),
      originalBytes,
      resized: false,
      type: file.type,
    };
  }

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ImageError('This browser could not process the image.');
  context.drawImage(image, 0, 0, width, height);

  // PNG keeps transparency; everything else re-encodes to JPEG, which is far
  // smaller for photographs and scans.
  const targetType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const encoded = canvas.toDataURL(targetType, options.quality ?? 0.82);

  // Never let "optimization" make the file bigger.
  const chosen = dataUrlBytes(encoded) < dataUrlBytes(original) ? encoded : original;

  return {
    dataUrl: chosen,
    width,
    height,
    bytes: dataUrlBytes(chosen),
    originalBytes,
    resized: needsResize && chosen === encoded,
    type: chosen === encoded ? targetType : file.type,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
