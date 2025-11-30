import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LocationStats } from '@tracearr/shared';
import { cn } from '@/lib/utils';
import { MapPin, User } from 'lucide-react';
import { format } from 'date-fns';

// Build image URL - handles both full URLs (Plex) and relative paths (Jellyfin)
function getImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // For relative paths, we'd need serverId - for now just use the URL directly
  // User thumbs from Plex are typically full URLs
  return url;
}

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as { _getIconUrl?: () => void })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom styles for dark theme and zoom control positioning
const mapStyles = `
  .leaflet-popup-content-wrapper {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    padding: 0;
  }
  .leaflet-popup-content {
    margin: 0 !important;
    min-width: 180px;
    max-width: 260px;
    line-height: 1.3 !important;
  }
  .leaflet-popup-content p {
    margin: 0 !important;
  }
  .leaflet-popup-tip {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-top: none;
    border-right: none;
  }
  .leaflet-popup-close-button {
    color: hsl(var(--muted-foreground)) !important;
    font-size: 16px !important;
    top: 8px !important;
    right: 8px !important;
    width: 18px !important;
    height: 18px !important;
    line-height: 18px !important;
  }
  .leaflet-popup-close-button:hover {
    color: hsl(var(--foreground)) !important;
  }
  .leaflet-control-zoom {
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 0.5rem !important;
    overflow: hidden;
  }
  .leaflet-control-zoom a {
    background: hsl(var(--card)) !important;
    color: hsl(var(--foreground)) !important;
    border-bottom: 1px solid hsl(var(--border)) !important;
  }
  .leaflet-control-zoom a:hover {
    background: hsl(var(--muted)) !important;
  }
  .leaflet-control-zoom a:last-child {
    border-bottom: none !important;
  }
`;

interface StreamMapProps {
  locations: LocationStats[];
  className?: string;
  isLoading?: boolean;
}

// Calculate marker radius based on count (min 6, max 30)
function getMarkerRadius(count: number, maxCount: number): number {
  if (maxCount === 0) return 8;
  const normalized = count / maxCount;
  return Math.max(6, Math.min(30, 6 + normalized * 24));
}

// Component to fit bounds when data changes
function MapBoundsUpdater({ locations }: { locations: LocationStats[] }) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = locations
      .filter((l) => l.lat && l.lon)
      .map((l) => [l.lat, l.lon]);

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
    } else {
      // Default view when no data
      map.setView([20, 0], 2);
    }
  }, [locations, map]);

  return null;
}

export function StreamMap({ locations, className, isLoading }: StreamMapProps) {
  // Calculate max count for marker sizing
  const maxCount = useMemo(
    () => Math.max(...locations.map((l) => l.count), 1),
    [locations]
  );

  const hasData = locations.length > 0;

  return (
    <div className={cn('relative h-full w-full', className)}>
      <style>{mapStyles}</style>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        className="h-full w-full"
        scrollWheelZoom={true}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <ZoomControl position="bottomright" />

        <MapBoundsUpdater locations={locations} />

        {/* Location markers */}
        {locations.map((location, idx) => {
          if (!location.lat || !location.lon) return null;

          const radius = getMarkerRadius(location.count, maxCount);
          const locationKey = `${location.city}-${location.country}-${location.lat}-${location.lon}-${idx}`;

          return (
            <CircleMarker
              key={locationKey}
              center={[location.lat, location.lon]}
              radius={radius}
              pathOptions={{
                fillColor: '#06b6d4', // cyan-500
                fillOpacity: 0.7,
                color: '#22d3ee', // cyan-400
                weight: 2,
              }}
              eventHandlers={{
                click: (e) => {
                  // Open popup at marker center, not click position
                  e.target.openPopup(e.target.getLatLng());
                },
              }}
            >
              <Popup>
                <div className="p-2.5 text-foreground text-sm">
                  {/* Location header */}
                  <div className="flex items-center gap-1.5 pr-5">
                    <MapPin className="h-3.5 w-3.5 text-cyan-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <span className="font-semibold">{location.city || 'Unknown City'}</span>
                      <span className="text-muted-foreground text-xs ml-1">
                        {[location.region, location.country].filter(Boolean).join(', ') || 'Unknown'}
                      </span>
                    </div>
                  </div>

                  {/* Core stats with vertical divider */}
                  <div className="mt-2 flex items-center justify-center gap-3 border-t border-border pt-2">
                    <div className="text-center px-2">
                      <span className="text-base font-semibold tabular-nums">{location.count}</span>
                      <span className="text-[10px] text-muted-foreground ml-1">streams</span>
                    </div>
                    {location.deviceCount !== undefined && location.deviceCount > 0 && (
                      <>
                        <div className="h-4 w-px bg-border" />
                        <div className="text-center px-2">
                          <span className="text-base font-semibold tabular-nums">{location.deviceCount}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">devices</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Users at this location - clickable with avatars */}
                  {location.users && location.users.length > 0 && (
                    <div className="mt-2 border-t border-border pt-2">
                      <div className="flex flex-wrap gap-1">
                        {location.users.map((user) => {
                          const avatarUrl = getImageUrl(user.thumbUrl);
                          return (
                            <Link
                              key={user.id}
                              to={`/users/${user.id}`}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 hover:bg-muted transition-colors"
                            >
                              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted overflow-hidden flex-shrink-0">
                                {avatarUrl ? (
                                  <img src={avatarUrl} alt={user.username} className="h-4 w-4 object-cover" />
                                ) : (
                                  <User className="h-2.5 w-2.5 text-muted-foreground" />
                                )}
                              </div>
                              <span className="text-xs">{user.username}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Time span */}
                  {(location.firstActivity || location.lastActivity) && (
                    <div className="mt-2 pt-1.5 border-t border-border text-[10px] text-muted-foreground text-center">
                      {location.firstActivity && location.lastActivity ? (
                        <span>
                          {format(new Date(location.firstActivity), 'MMM d')} — {format(new Date(location.lastActivity), 'MMM d, yyyy')}
                        </span>
                      ) : location.lastActivity ? (
                        <span>Last active {format(new Date(location.lastActivity), 'MMM d, yyyy')}</span>
                      ) : null}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading map data...
          </div>
        </div>
      )}

      {/* No data message */}
      {!isLoading && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <p className="text-sm text-muted-foreground">No location data for current filters</p>
        </div>
      )}
    </div>
  );
}
