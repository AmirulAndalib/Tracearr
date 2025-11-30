import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCardSkeleton, ListItemSkeleton } from '@/components/ui/skeleton';
import { SeverityBadge } from '@/components/violations/SeverityBadge';
import { PlaysChart } from '@/components/charts/PlaysChart';
import { StreamCard } from '@/components/map';
import { Activity, Play, Clock, AlertTriangle, User, Tv } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  useDashboardStats,
  usePlaysStats,
  useActiveSessions,
  useViolations,
} from '@/hooks/queries';

export function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: playsData, isLoading: playsLoading } = usePlaysStats('week');
  const { data: sessions } = useActiveSessions();
  const { data: violations, isLoading: violationsLoading } = useViolations({
    pageSize: 5,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsLoading ? (
          <>
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
            <StatsCardSkeleton />
          </>
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.activeStreams ?? 0}</div>
                <p className="text-xs text-muted-foreground">Currently streaming</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Today's Plays</CardTitle>
                <Play className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.todayPlays ?? 0}</div>
                <p className="text-xs text-muted-foreground">Streams started today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Watch Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.watchTimeHours ?? 0}h</div>
                <p className="text-xs text-muted-foreground">Total today</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Alerts</CardTitle>
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.alertsLast24h ?? 0}</div>
                <p className="text-xs text-muted-foreground">Last 24 hours</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stream Map</CardTitle>
          </CardHeader>
          <CardContent>
            <StreamCard sessions={sessions} height={256} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {!sessions || sessions.length === 0 ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
                <p className="text-muted-foreground">No active sessions</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-64 overflow-y-auto">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center gap-4">
                    <Link
                      to={`/users/${session.user.id}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-muted hover:opacity-80 transition-opacity"
                    >
                      {session.user.thumbUrl ? (
                        <img
                          src={session.user.thumbUrl}
                          alt={session.user.username}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <User className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/users/${session.user.id}`}
                        className="font-medium truncate hover:underline"
                      >
                        {session.user.username}
                      </Link>
                      <p className="text-sm text-muted-foreground truncate">
                        {session.mediaTitle}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Tv className="h-3 w-3" />
                      <span>{session.platform ?? 'Unknown'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plays This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <PlaysChart data={playsData} isLoading={playsLoading} height={192} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Violations</CardTitle>
          </CardHeader>
          <CardContent>
            {violationsLoading ? (
              <div className="space-y-3">
                <ListItemSkeleton />
                <ListItemSkeleton />
                <ListItemSkeleton />
              </div>
            ) : !violations?.data || violations.data.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed">
                <p className="text-muted-foreground">No violations</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-48 overflow-y-auto">
                {violations.data.map((violation) => (
                  <div key={violation.id} className="flex items-center gap-4">
                    <Link
                      to={`/users/${violation.userId}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-muted hover:opacity-80 transition-opacity"
                    >
                      {violation.user.thumbUrl ? (
                        <img
                          src={violation.user.thumbUrl}
                          alt={violation.user.username}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <User className="h-5 w-5 text-muted-foreground" />
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/users/${violation.userId}`}
                        className="font-medium truncate hover:underline"
                      >
                        {violation.user.username}
                      </Link>
                      <p className="text-sm text-muted-foreground truncate">
                        {violation.rule.name}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <SeverityBadge severity={violation.severity} />
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(violation.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
