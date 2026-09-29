export type TourStatus =
  | "PRE_ROUTE"
  | "POST_ROUTE"
  | "IN_ROUTE"
  | "NOT_STARTED"
  | "FINISHED"
  | "CLOSED"
  | "CANCELED"
  | string;

export interface TourVehicle {
  displayId: string;
  licensePlate: string;
}

export interface TourEstimatedTimeOfArrival {
  timestamp: string;
}

export interface TourDocumentPendencies {
  totalAmount: number;
  volumeHectoliters: number;
  volumePackages: number;
}

export interface TourVisitsAmount {
  concluded: number;
  finalStatus: number;
  inTreatment: number;
  postponed: number;
  rescheduled: number;
  total: number;
  unfulfilled: number;
  waitingModulation: number;
}

export interface BeesTourSummary {
  id: string;

  externalId: string;
  displayId: string;

  driverId: string;
  driverName: string;

  vehicle: TourVehicle;

  hasKeyAccount: boolean;
  overnight: boolean;

  status: TourStatus;

  estimatedTimeOfArrival?: TourEstimatedTimeOfArrival;

  estimatedRouteDuration?: number;

  documentPendencies?: TourDocumentPendencies;

  lastUpdateTimestamp?: string;

  visitsAmount: TourVisitsAmount;

  radiusAdherencePercentage?: number;

  firstTripId?: string;

  actualTimeInRouteHours?: number;

  actualStartTimestamp?: string;

  enterRadiusTimestamp?: string;

  deliveryStartedTimestamp?: string;

  closeTourAction?: string;

  searchTerms: string[];

  criticalRouteDuration?: number;

  almostCriticalRouteDuration?: number;
}

export interface BeesToursSummariesResponse {
  content: BeesTourSummary[];

  /*
   * Caso descubramos depois que a API retorna paginação,
   * adicionamos aqui:
   *
   * totalElements?: number;
   * totalPages?: number;
   * number?: number;
   * size?: number;
   */
}
