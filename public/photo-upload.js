// Best-effort optimization only. Keep original files for previews, retries and
// session recovery; the server remains responsible for all image validation.
export async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || typeof createImageBitmap !== "function") return file;
  let bitmap, canvas;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) return file;
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    // Avoid a lossy re-encode when an image is already small.
    if (scale === 1) return file;
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    // Preserve transparent PNG/WebP pixels; JPEG camera images stay JPEG.
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, file.type, 0.8));
    if (!blob || blob.type !== file.type || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } catch {
    // Decode/encoding support varies by browser. Normal server validation still
    // reports unsupported or damaged files instead of losing the selection.
    return file;
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
