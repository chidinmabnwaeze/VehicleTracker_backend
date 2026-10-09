import { env } from "./env";
import { ApiError } from "../utils/ApiError";
import type { Position } from "../utils/geo";

const DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic";

export interface PlannedRoute {
  geometry: { type: "LineString"; coordinates: Position[] };
  distanceMeters: number;
  // durationSeconds reflects live traffic, typicalDurationSeconds the usual time
  durationSeconds: number;
  typicalDurationSeconds?: number;
}

interface DirectionsResponse {
  code?: string;
  message?: string;
  routes?: Array<{
    geometry: PlannedRoute["geometry"];
    distance: number;
    duration: number;
    duration_typical?: number;
  }>;
}

if (!env.mapboxToken) {
  console.warn(
    "[mapbox] MAPBOX_ACCESS_TOKEN not set - trips use a straight-line route and traffic detection is off",
  );
}

export const isConfigured = (): boolean => Boolean(env.mapboxToken);

const GEOCODE_URL = "https://api.mapbox.com/search/geocode/v6";

export interface GeocodedPlace {
  name: string;
  address: string;
  // State or region the place is in
  region?: string;
  coordinates: Position;
}

interface GeocodeResponse {
  message?: string;
  features?: Array<{
    geometry: { coordinates: Position };
    properties: {
      name?: string;
      full_address?: string;
      place_formatted?: string;
      context?: { region?: { name?: string } };
    };
  }>;
}

async function geocodeRequest(path: string): Promise<GeocodedPlace | null> {
  let body: GeocodeResponse;
  try {
    const response = await fetch(
      `${GEOCODE_URL}/${path}&limit=1&access_token=${env.mapboxToken}`,
      { signal: AbortSignal.timeout(8000) },
    );
    body = (await response.json()) as GeocodeResponse;
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  } catch (err) {
    throw new ApiError(502, `Could not look up the address with Mapbox: ${(err as Error).message}`);
  }

  const feature = body.features?.[0];
  if (!feature) return null;
  const { name, full_address, place_formatted, context } = feature.properties;
  return {
    name: name || full_address || "",
    address: full_address || [name, place_formatted].filter(Boolean).join(", "),
    region: context?.region?.name,
    coordinates: feature.geometry.coordinates,
  };
}

// Turns a typed address into coordinates. Returns null when nothing matches.
export const geocode = (query: string): Promise<GeocodedPlace | null> =>
  geocodeRequest(`forward?q=${encodeURIComponent(query)}&country=${env.geocodeCountry}`);

// Names the place at a coordinate. Returns null when nothing is there.
export const reverseGeocode = ([lng, lat]: Position): Promise<GeocodedPlace | null> =>
  geocodeRequest(`reverse?longitude=${lng}&latitude=${lat}`);

// Returns null when Mapbox finds no drivable route
export async function getRoute(from: Position, to: Position): Promise<PlannedRoute | null> {
  const url =
    `${DIRECTIONS_URL}/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?geometries=geojson&overview=full&access_token=${env.mapboxToken}`;

  let body: DirectionsResponse;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    body = (await response.json()) as DirectionsResponse;
    if (!response.ok && body.code !== "NoRoute") {
      throw new Error(body.message || `HTTP ${response.status}`);
    }
  } catch (err) {
    throw new ApiError(502, `Could not get a route from Mapbox: ${(err as Error).message}`);
  }

  const route = body.routes?.[0];
  if (!route) return null;

  return {
    geometry: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    typicalDurationSeconds: route.duration_typical,
  };
}
