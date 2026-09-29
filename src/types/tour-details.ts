export interface TourDeviceInformation {
  batteryLevel?: number;
  gpsEnabled?: boolean;
  mobileNetworkLevel?: number;
}

export interface TourDriverDetails {
  phone?: string | null;
}

export interface TourEstimatedTimeOfArrival {
  timestamp: string;
}

export interface TourVisitTags {
  creditTeamException?: boolean;
  flexDelivery?: boolean;
  hasDeliveryDocument?: boolean;
  hasSalesDocument?: boolean;
  newAccount?: boolean;
  outOfRadius?: boolean;
  type?: string;
  unplannedSales?: boolean;
}

export interface TourVisitUpdate {
  timestamp: string;
  status: string;
}

export interface TourVisit {
  accountId: string;
  accountExternalId: string;
  accountName: string;

  accountGroupId?: string;

  status: string;

  volumePackagesSum?: number;
  totalPending?: number;

  expectedDeliveryTime?: number;
  actualDeliveryTime?: number;

  updatedAt?: string;

  arrivesAt?: string;
  arrivedAt?: string;

  enterRadiusTimestamp?: string;

  tags?: TourVisitTags;

  updates?: TourVisitUpdate[];
}

export interface TourTrip {
  id: string;

  externalId: string;
  displayId: string;

  status: string;

  actualTimeInRouteHours?: number;
  expectedTimeInRouteHours?: number;

  estimatedRouteDuration?: number;

  estimatedTimeOfArrival?: TourEstimatedTimeOfArrival;

  radiusAdherencePercentage?: number;

  actualStartTimestamp?: string;

  enterRadiusTimestamp?: string;

  deliveryStartedTimestamp?: string;

  lastUpdateTimestamp?: string;
  lastVisitUpdateTimestamp?: string;

  visits: TourVisit[];
}

export interface BeesTourDetailsResponse {
  id: string;

  externalId: string;
  displayId: string;

  deviceInformation?: TourDeviceInformation;

  driver?: TourDriverDetails;

  lastUpdateTimestamp?: string;

  trips: TourTrip[];
}