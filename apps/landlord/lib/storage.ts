// Server-only Supabase Storage client for file uploads (meter-reading photos
// today; reusable for future features like listing photos or documents). Uses
// the service-role key — never expose this client or its key to the browser.
// Domain errors are string-coded and mapped centrally in @repo/shared/errors.

import { createClient } from "@supabase/supabase-js";

const BUCKET = "meter-readings";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

function client() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  return createClient(supabaseUrl, serviceRoleKey);
}

/** Upload a meter-reading photo; returns its public URL. */
export async function uploadMeterReadingPhoto(
  organizationId: string,
  unitId: string,
  file: File,
): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("PHOTO_INVALID_TYPE");
  if (file.size > MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");

  const ext = file.type.split("/")[1] ?? "jpg";
  const path = `${organizationId}/${unitId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const supabase = client();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("PHOTO_UPLOAD_FAILED");

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Best-effort delete of a previously-uploaded meter-reading photo. */
export async function deleteMeterReadingPhoto(url: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  await client()
    .storage.from(BUCKET)
    .remove([path])
    .catch(() => {}); // non-fatal — an orphaned blob isn't worth failing the request over
}
