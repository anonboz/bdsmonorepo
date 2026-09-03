// Server-only Supabase Storage client for file uploads (meter-reading photos,
// listing photos). Uses the service-role key — never expose this client or
// its key to the browser. Domain errors are string-coded and mapped centrally
// in @repo/shared/errors.

import { createClient } from "@supabase/supabase-js";

const METER_READING_BUCKET = "meter-readings";
const LISTING_PHOTO_BUCKET = "listing-photos";
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

async function uploadPhoto(bucket: string, pathPrefix: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("PHOTO_INVALID_TYPE");
  if (file.size > MAX_BYTES) throw new Error("PHOTO_TOO_LARGE");

  const ext = file.type.split("/")[1] ?? "jpg";
  const path = `${pathPrefix}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const supabase = client();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("PHOTO_UPLOAD_FAILED");

  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function deletePhoto(bucket: string, url: string): Promise<void> {
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  await client()
    .storage.from(bucket)
    .remove([path])
    .catch(() => {}); // non-fatal — an orphaned blob isn't worth failing the request over
}

/** Upload a meter-reading photo; returns its public URL. */
export function uploadMeterReadingPhoto(
  organizationId: string,
  unitId: string,
  file: File,
): Promise<string> {
  return uploadPhoto(METER_READING_BUCKET, `${organizationId}/${unitId}`, file);
}

/** Best-effort delete of a previously-uploaded meter-reading photo. */
export function deleteMeterReadingPhoto(url: string): Promise<void> {
  return deletePhoto(METER_READING_BUCKET, url);
}

/** Upload a listing photo; returns its public URL. */
export function uploadListingPhoto(
  organizationId: string,
  listingId: string,
  file: File,
): Promise<string> {
  return uploadPhoto(LISTING_PHOTO_BUCKET, `${organizationId}/${listingId}`, file);
}

/** Best-effort delete of a previously-uploaded listing photo. */
export function deleteListingPhoto(url: string): Promise<void> {
  return deletePhoto(LISTING_PHOTO_BUCKET, url);
}
