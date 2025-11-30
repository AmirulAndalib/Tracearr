import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { StreamMap } from '@/components/map';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useLocationStats } from '@/hooks/queries';

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

  // Parse filters from URL
  const filters = useMemo(() => {
    const days = searchParams.get('days');
    const userId = searchParams.get('userId');
    const serverId = searchParams.get('serverId');
    const mediaType = searchParams.get('mediaType') as 'movie' | 'episode' | 'track' | null;

    return {
      days: days ? Number(days) : 30,
      userId: userId || undefined,
      serverId: serverId || undefined,
      mediaType: mediaType || undefined,
    };
  }, [searchParams]);

  // Fetch data - includes available filter options based on current filters
  const { data: locationData, isLoading: locationsLoading } = useLocationStats(filters);

  const locations = locationData?.data ?? [];
  const summary = locationData?.summary;
  const availableFilters = locationData?.availableFilters;

  // Dynamic filter options from the response
  const users = availableFilters?.users ?? [];
  const servers = availableFilters?.servers ?? [];
  const mediaTypes = availableFilters?.mediaTypes ?? [];

  // Get selected filter labels for display
  const selectedUser = users.find(u => u.id === filters.userId);
  const selectedServer = servers.find(s => s.id === filters.serverId);
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

  const hasFilters = filters.userId || filters.serverId || filters.mediaType || filters.days !== 30;

  // Build summary text
  const summaryContext = useMemo(() => {
    const parts: string[] = [];
    if (selectedUser) parts.push(selectedUser.username);
    if (selectedServer) parts.push(selectedServer.name);
    if (selectedMediaType) parts.push(selectedMediaType.label);
    return parts.join(' · ') || 'All activity';
  }, [selectedUser, selectedServer, selectedMediaType]);

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
          value={filters.userId ?? '_all'}
          onValueChange={(v) => setFilter('userId', v === '_all' ? null : v)}
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

        {/* Server filter */}
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
        />
      </div>
    </div>
  );
}
