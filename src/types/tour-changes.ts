export interface TourFieldChange {
  field: string;

  previous: unknown;
  current: unknown;
}

export interface TourChangeSummary {
  id: string;
  externalId: string;
  displayId: string;

  driverId: string;
  driverName: string;

  vehicle: {
    displayId: string;
    licensePlate: string;
  };

  status: string;

  lastUpdateTimestamp?: string;

  documentPendencies?: {
    totalAmount?: number;
    volumeHectoliters?: number;
    volumePackages?: number;
  };

  visitsAmount: {
    concluded: number;
    finalStatus: number;
    inTreatment: number;
    postponed: number;
    rescheduled: number;
    total: number;
    unfulfilled: number;
    waitingModulation: number;
  };

  radiusAdherencePercentage?: number;

  changes: TourFieldChange[];
}

export interface ToursChangesFile {
  metadata: {
    generatedAt: string;

    previousSnapshotId?: string;
    currentSnapshotId?: string;

    previousUpdatedAt?: string;
    currentUpdatedAt?: string;

    totalPrevious: number;
    totalCurrent: number;

    changedTours: number;
  };

  content: TourChangeSummary[];
}
