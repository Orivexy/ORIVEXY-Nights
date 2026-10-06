export const STORAGE_KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/i;

export function assertKey(key: string) {
  if (!STORAGE_KEY_RE.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
}

const CONTENT_TYPES: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", webm: "video/webm" };

/** Content type from the key's extension; null for anything ORIVEXY NIGHTS never stores. */
export const contentTypeFor = (key: string): string | null => CONTENT_TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? null;
