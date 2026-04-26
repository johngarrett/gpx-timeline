export interface TrackPoint {
  lat: number;
  lon: number;
}

export interface ActivityFile {
  filename: string;
  startTime: Date | null;
  endTime: Date | null;
  activityType: string;
  fileSizeBytes: number;
  trackPoints: TrackPoint[];
}
