import type { ActivityFile } from './types.js';

const CONCURRENCY = 6;

interface BigDataCloudResponse {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as BigDataCloudResponse;
  return data.city || data.locality || data.principalSubdivision || '';
}

// Runs geocoding for all activities missing a city, with bounded concurrency.
// Calls onResult as each one completes so the UI can update live.
export async function geocodeActivities(
  activities: ActivityFile[],
  onResult: (activity: ActivityFile, city: string) => void,
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const pending = activities.filter(a => a.city === undefined && a.trackPoints.length > 0);
  if (pending.length === 0) return;

  const total = pending.length;
  let idx = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (idx < pending.length) {
      const activity = pending[idx++];
      const pt = activity.trackPoints[0];
      try {
        const city = await reverseGeocode(pt.lat, pt.lon);
        onResult(activity, city);
      } catch {
        onResult(activity, '');
      }
      onProgress(++done, total);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
