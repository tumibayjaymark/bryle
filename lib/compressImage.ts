/**
 * compressImage.ts
 *
 * Compresses an image File in the browser using <canvas>, iteratively
 * lowering JPEG quality (and, if needed, dimensions) until the result
 * is under `targetKB`. Runs entirely client-side, so you save on
 * storage/bandwidth before the file ever reaches Supabase.
 */

export interface CompressResult {
  file: File;
  originalKB: number;
  compressedKB: number;
}

interface CompressOptions {
  /** Target max size in kilobytes. Default 200KB. */
  targetKB?: number;
  /** Largest allowed width/height in px. Default 1600. */
  maxDimension?: number;
  /** Starting JPEG quality (0-1). Default 0.8. */
  startQuality?: number;
}

export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const { targetKB = 200, maxDimension = 1600, startQuality = 0.8 } = options;

  const originalKB = file.size / 1024;

  // Non-image files or already-tiny files: skip compression.
  if (!file.type.startsWith("image/") || originalKB <= targetKB) {
    return { file, originalKB, compressedKB: originalKB };
  }

  const bitmap = await createImageBitmap(file);

  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = startQuality;
  let blob = await canvasToBlob(canvas, quality);

  // Step 1: reduce quality in steps until under target or quality floor hit.
  while (blob.size / 1024 > targetKB && quality > 0.35) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }

  // Step 2: if still too big, shrink dimensions and retry once.
  if (blob.size / 1024 > targetKB) {
    const scale = 0.75;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    quality = 0.7;
    blob = await canvasToBlob(canvas, quality);
    while (blob.size / 1024 > targetKB && quality > 0.35) {
      quality -= 0.1;
      blob = await canvasToBlob(canvas, quality);
    }
  }

  const compressedFile = new File(
    [blob],
    renameToJpg(file.name),
    { type: "image/jpeg" }
  );

  return {
    file: compressedFile,
    originalKB,
    compressedKB: compressedFile.size / 1024,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    );
  });
}

function renameToJpg(name: string): string {
  return name.replace(/\.[^/.]+$/, "") + ".jpg";
}