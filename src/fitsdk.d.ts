declare module '@garmin/fitsdk' {
  export class Stream {
    static fromArrayBuffer(buffer: ArrayBuffer): Stream;
    static fromByteArray(data: number[]): Stream;
  }

  export interface FitMessages {
    sessionMesgs?: Array<{
      startTime?: Date;
      timestamp?: Date;
      sport?: string;
      [key: string]: unknown;
    }>;
    recordMesgs?: Array<{
      positionLat?: number;
      positionLong?: number;
      timestamp?: Date;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }

  export class Decoder {
    constructor(stream: Stream);
    read(options?: {
      expandSubFields?: boolean;
      expandComponents?: boolean;
      applyScaleAndOffset?: boolean;
      convertTypesToStrings?: boolean;
      convertDateTimesToDates?: boolean;
      includeUnknownData?: boolean;
      mergeHeartRates?: boolean;
    }): { messages: FitMessages; errors: Error[] };
  }
}
