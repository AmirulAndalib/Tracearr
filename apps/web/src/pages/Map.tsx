import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { StreamMap, type MapViewMode } from '@/components/map';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X, Flame, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocationStats } from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

const TIME_RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'All time' },
] as const;

const MEDIA_TYPES = [
  { value: 'movie', label: 'Movies' },
  { value: 'episode', label: 'TV' },
  { value: 'track', label: 'Music' },
] as const;

export function Map() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<MapViewMode>('heatmap');
  const { selectedServerId } = useServer();

  // Parse filters from URL, use selected server from context
  const filters = useMemo(() => {
    const days = searchParams.get('days');
    const serverUserId = searchParams.get('serverUserId');
    const mediaType = searchParams.get('mediaType') as 'movie' | 'episode' | 'track' | null;

    return {
      days: days ? Number(days) : 30,
      serverUserId: serverUserId || undefined,
      serverId: selectedServerId || undefined,
      mediaType: mediaType || undefined,
    };
  }, [searchParams, selectedServerId]);

  // Fetch data - includes available filter options based on current filters
  const { data: locationData, isLoading: locationsLoading } = useLocationStats(filters);

  const locations = locationData?.data ?? [];
  const summary = locationData?.summary;
  const availableFilters = locationData?.availableFilters;

  // Dynamic filter options from the response
  const users = availableFilters?.users ?? [];
  // const servers = availableFilters?.servers ?? []; // Server selection moved to sidebar
  const mediaTypes = availableFilters?.mediaTypes ?? [];

  // Get selected filter labels for display
  const selectedUser = users.find(u => u.id === filters.serverUserId);
  // const selectedServer = servers.find(s => s.id === filters.serverId); // Server selection moved to sidebar
  const selectedMediaType = MEDIA_TYPES.find(m => m.value === filters.mediaType);

  // Filter MEDIA_TYPES to only show available options
  const availableMediaTypeOptions = MEDIA_TYPES.filter(m => mediaTypes.includes(m.value));

  // Update a single filter
  const setFilter = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    setSearchParams(params);
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  // Server is always set from context, so don't include it in hasFilters check
  const hasFilters = filters.serverUserId || filters.mediaType || filters.days !== 30;

  // Build summary text (server selection is now in sidebar, not shown here)
  const summaryContext = useMemo(() => {
    const parts: string[] = [];
    if (selectedUser) parts.push(selectedUser.username);
    // Server shown in sidebar, not in summary
    if (selectedMediaType) parts.push(selectedMediaType.label);
    return parts.join(' · ') || 'All activity';
  }, [selectedUser, selectedMediaType]);

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col">
      {/* Filter bar */}
      <div className="relative z-[1000] flex items-center gap-3 border-b bg-card/50 px-4 py-2 backdrop-blur">
        {/* Time range */}
        <Select
          value={String(filters.days)}
          onValueChange={(v) => setFilter('days', v === '30' ? null : v)}
        >
          <SelectTrigger className="w-[100px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[1001]">
            {TIME_RANGES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="h-4 w-px bg-border" />

        {/* User filter */}
        <Select
          value={filters.serverUserId ?? '_all'}
          onValueChange={(v) => setFilter('serverUserId', v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="All users" />
          </SelectTrigger>
          <SelectContent className="z-[1001]">
            <SelectItem value="_all">All users</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Server filter - moved to sidebar ServerSelector
        <Select
          value={filters.serverId ?? '_all'}
          onValueChange={(v) => setFilter('serverId', v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="All servers" />
          </SelectTrigger>
          <SelectContent className="z-[1001]">
            <SelectItem value="_all">All servers</SelectItem>
            {servers.map((server) => (
              <SelectItem key={server.id} value={server.id}>
                {server.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        */}

        {/* Media type filter */}
        <Select
          value={filters.mediaType ?? '_all'}
          onValueChange={(v) => setFilter('mediaType', v === '_all' ? null : v)}
        >
          <SelectTrigger className="w-[100px] h-8 text-sm">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent className="z-[1001]">
            <SelectItem value="_all">All types</SelectItem>
            {availableMediaTypeOptions.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        <div className="h-4 w-px bg-border" />

        {/* View mode toggle */}
        <div className="flex h-8 rounded-md border bg-muted/50 p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('heatmap')}
            className={cn(
              'h-7 px-2.5 gap-1.5 text-xs rounded-sm',
              viewMode === 'heatmap'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
            )}
          >
            <Flame className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Heatmap</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('circles')}
            className={cn(
              'h-7 px-2.5 gap-1.5 text-xs rounded-sm',
              viewMode === 'circles'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-transparent'
            )}
          >
            <CircleDot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Circles</span>
          </Button>
        </div>

        {/* Summary stats - right side */}
        <div className="ml-auto flex items-center gap-4 text-sm">
          <div className="text-muted-foreground">
            {summaryContext}
          </div>
          <div className="flex items-center gap-3">
            <div>
              <span className="font-semibold tabular-nums">{summary?.totalStreams ?? 0}</span>
              <span className="ml-1 text-muted-foreground">streams</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="font-semibold tabular-nums">{summary?.uniqueLocations ?? 0}</span>
              <span className="ml-1 text-muted-foreground">locations</span>
            </div>
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="relative flex-1">
        <StreamMap
          locations={locations}
          isLoading={locationsLoading}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
