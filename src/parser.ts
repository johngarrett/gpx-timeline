import { inflate } from 'pako';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { ActivityFile, TrackPoint } from './types.js';

const MAX_TRACK_POINTS = 500;

export async function parseGpx(file: File): Promise<ActivityFile> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');

  if (doc.querySelector('parsererror')) return errorResult(file);

  const trk = doc.querySelector('trk');
  const activityType = trk?.querySelector('type')?.textContent?.trim().toLowerCase() ?? 'unknown';

  const trkpts = doc.querySelectorAll('trkpt');
  const raw: TrackPoint[] = [];
  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '');
    const lon = parseFloat(pt.getAttribute('lon') ?? '');
    if (!isNaN(lat) && !isNaN(lon)) raw.push({ lat, lon });
  }

  const timeNodes = doc.querySelectorAll('trkpt > time');
  const startTime = timeNodes.length > 0 ? parseIso(timeNodes[0].textContent) : null;
  const endTime   = timeNodes.length > 0 ? parseIso(timeNodes[timeNodes.length - 1].textContent) : null;

  return {
    filename: file.name,
    startTime,
    endTime,
    activityType,
    fileSizeBytes: file.size,
    trackPoints: subsample(raw, MAX_TRACK_POINTS),
  };
}

export async function parseFit(file: File): Promise<ActivityFile> {
  const compressed = new Uint8Array(await file.arrayBuffer());
  const decompressed = inflate(compressed);
  const fitBuffer = decompressed.buffer.slice(
    decompressed.byteOffset,
    decompressed.byteOffset + decompressed.byteLength,
  );

  const { messages, errors } = new Decoder(Stream.fromArrayBuffer(fitBuffer)).read();

  if (errors?.length && !messages?.sessionMesgs?.length) return errorResult(file);

  const session = messages?.sessionMesgs?.[0];
  const startTime: Date | null = session?.startTime instanceof Date ? session.startTime : null;
  const endTime: Date | null   = session?.timestamp instanceof Date ? session.timestamp : null;
  const activityType           = typeof session?.sport === 'string' ? session.sport.toLowerCase() : 'unknown';

  const raw: TrackPoint[] = [];
  for (const rec of messages?.recordMesgs ?? []) {
    const lat = rec.positionLat;
    const lon = rec.positionLong;
    if (lat == null || lon == null) continue;
    // SDK returns degrees when applyScaleAndOffset is true (default).
    // Guard against raw semicircles just in case (|val| > 360).
    raw.push({
      lat: Math.abs(lat) > 360 ? lat * (180 / 2147483648) : lat,
      lon: Math.abs(lon) > 360 ? lon * (180 / 2147483648) : lon,
    });
  }

  return {
    filename: file.name,
    startTime,
    endTime,
    activityType,
    fileSizeBytes: file.size,
    trackPoints: subsample(raw, MAX_TRACK_POINTS),
  };
}

function subsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

function parseIso(text: string | null | undefined): Date | null {
  if (!text) return null;
  const d = new Date(text.trim());
  return isNaN(d.getTime()) ? null : d;
}

function errorResult(file: File): ActivityFile {
  return {
    filename: file.name,
    startTime: null,
    endTime: null,
    activityType: 'parse error',
    fileSizeBytes: file.size,
    trackPoints: [],
  };
}
