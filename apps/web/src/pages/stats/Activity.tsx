import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PeriodSelector } from '@/components/ui/period-selector';
import {
  PlaysChart,
  PlatformChart,
  DayOfWeekChart,
  HourOfDayChart,
  QualityChart,
  ConcurrentChart,
} from '@/components/charts';
import {
  usePlaysStats,
  usePlaysByDayOfWeek,
  usePlaysByHourOfDay,
  usePlatformStats,
  useQualityStats,
  useConcurrentStats,
  type StatsPeriod,
} from '@/hooks/queries';
import { useServer } from '@/hooks/useServer';

export function StatsActivity() {
  const [period, setPeriod] = useState<StatsPeriod>('month');
  const { selectedServerId } = useServer();

  // Fetch all stats with the same period and server filter
  const plays = usePlaysStats(period, selectedServerId);
  const dayOfWeek = usePlaysByDayOfWeek(period, selectedServerId);
  const hourOfDay = usePlaysByHourOfDay(period, selectedServerId);
  const platforms = usePlatformStats(period, selectedServerId);
  const quality = useQualityStats(period, selectedServerId);
  const concurrent = useConcurrentStats(period, selectedServerId);

  // Transform data for charts
  const platformData = platforms.data?.map((p) => ({
    name: p.platform ?? 'Unknown',
    count: p.count,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Play trends, patterns, and streaming behavior
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Charts grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Plays Over Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Plays Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <PlaysChart data={plays.data} isLoading={plays.isLoading} height={250} period={period} />
          </CardContent>
        </Card>

        {/* Concurrent Streams */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Concurrent Streams</CardTitle>
          </CardHeader>
          <CardContent>
            <ConcurrentChart data={concurrent.data} isLoading={concurrent.isLoading} height={250} period={period} />
          </CardContent>
        </Card>

        {/* Day of Week */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Activity by Day of Week</CardTitle>
          </CardHeader>
          <CardContent>
            <DayOfWeekChart data={dayOfWeek.data} isLoading={dayOfWeek.isLoading} height={250} />
          </CardContent>
        </Card>

        {/* Hour of Day */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Activity by Hour of Day</CardTitle>
          </CardHeader>
          <CardContent>
            <HourOfDayChart data={hourOfDay.data} isLoading={hourOfDay.isLoading} height={250} />
          </CardContent>
        </Card>

        {/* Platforms */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Platforms</CardTitle>
          </CardHeader>
          <CardContent>
            <PlatformChart data={platformData} isLoading={platforms.isLoading} height={250} />
          </CardContent>
        </Card>

        {/* Stream Quality */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Stream Quality</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityChart data={quality.data} isLoading={quality.isLoading} height={250} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
