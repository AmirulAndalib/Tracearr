import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { serverLocations } from '../db/schema.js';
import { geoipService, type GeoLocation } from './geoip.js';
import { lookupGeoIP } from './plexGeoip.js';
import { locationAt, placeLocal, type ServerLocation } from './serverLocationRanges.js';

export type SessionGeo = GeoLocation & { isLocal: boolean };

export function loadServerLocations(serverId: string): Promise<ServerLocation[]> {
  return db
    .select({
      effectiveFrom: serverLocations.effectiveFrom,
      lat: serverLocations.lat,
      lon: serverLocations.lon,
      city: serverLocations.city,
      region: serverLocations.region,
      country: serverLocations.country,
    })
    .from(serverLocations)
    .where(eq(serverLocations.serverId, serverId));
}

export async function resolveSessionGeo(
  ip: string,
  serverId: string,
  usePlexGeoip: boolean,
  at: Date = new Date()
): Promise<SessionGeo> {
  const geo = await lookupGeoIP(ip, usePlexGeoip);
  if (!geoipService.isPrivateIP(ip)) return { ...geo, isLocal: false };
  const location = locationAt(await loadServerLocations(serverId), at);
  return { ...placeLocal(geo, location), isLocal: true };
}

/** Pending entries written before is_local existed carry no flag; the IP decides, as it does at insert. */
export function withLocalFlag(geo: GeoLocation & { isLocal?: boolean }, ip: string): SessionGeo {
  return { ...geo, isLocal: geo.isLocal ?? geoipService.isPrivateIP(ip) };
}
