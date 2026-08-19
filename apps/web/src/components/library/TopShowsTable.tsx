import { Tv, Zap } from 'lucide-react';
import type { TopShowsResponse } from '@tracearr/shared';
import type { Server } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ServerBadge } from '@/components/server';
import { EmptyState } from '@/components/library';
import {
  SortableTableHead,
  nextSortOrder,
  type SortOrder,
} from '@/components/ui/sortable-table-head';

type ShowSortBy = 'plays' | 'watch_hours' | 'viewers' | 'completion_rate' | 'binge_score';

interface TopShowsTableProps {
  data: TopShowsResponse | undefined;
  isLoading?: boolean;
  page: number;
  onPageChange: (page: number) => void;
  sortBy: ShowSortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: ShowSortBy, sortOrder: SortOrder) => void;
  selectedServers?: Server[];
  isMultiServer?: boolean;
}

/**
 * Get binge score badge based on score thresholds.
 */
function getBingeScoreBadge(score: number) {
  if (score >= 80) return <Badge variant="danger">Highly Addictive</Badge>;
  if (score >= 60) return <Badge variant="warning">Addictive</Badge>;
  if (score >= 40) return <Badge variant="secondary">Bingeable</Badge>;
  return <Badge variant="outline">Casual Watch</Badge>;
}

/**
 * Get completion rate badge based on percentage.
 */
function getCompletionBadge(rate: number) {
  if (rate >= 80) return <Badge variant="success">{rate.toFixed(0)}%</Badge>;
  if (rate >= 50) return <Badge variant="secondary">{rate.toFixed(0)}%</Badge>;
  if (rate >= 20) return <Badge variant="warning">{rate.toFixed(0)}%</Badge>;
  return <Badge variant="outline">{rate.toFixed(0)}%</Badge>;
}

/**
 * Table component for displaying top TV shows by engagement metrics.
 * Server-side sortable by episode views, watch hours, viewers, completion rate, and binge score.
 * In multi-server mode renders per-title color dots for each server that owns the show.
 */
export function TopShowsTable({
  data,
  isLoading,
  page,
  onPageChange,
  sortBy,
  sortOrder,
  onSortChange,
  selectedServers = [],
  isMultiServer = false,
}: TopShowsTableProps) {
  const handleSort = (field: ShowSortBy) => {
    onSortChange(field, nextSortOrder(field, sortBy, sortOrder, 'desc'));
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="text-muted-foreground">Loading TV shows...</div>
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <EmptyState
        icon={Zap}
        title="No TV show watch data"
        description="TV show watch statistics will appear here once episodes have been played."
      />
    );
  }

  const totalPages = Math.ceil(data.pagination.total / data.pagination.pageSize);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[30%]">Show</TableHead>
            <SortableTableHead
              field="plays"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Episodes
            </SortableTableHead>
            <SortableTableHead
              field="watch_hours"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Watch Hours
            </SortableTableHead>
            <SortableTableHead
              field="viewers"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Viewers
            </SortableTableHead>
            <SortableTableHead
              field="completion_rate"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Completion
            </SortableTableHead>
            <SortableTableHead
              field="binge_score"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Binge Score
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.showTitle}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1 bg-blue-500/10 text-blue-500">
                    <Tv className="h-3 w-3" />
                    TV
                  </Badge>
                  <div>
                    <span className="font-medium">{item.showTitle}</span>
                    {item.year && <span className="text-muted-foreground ml-1">({item.year})</span>}
                  </div>
                  {isMultiServer && item.serverIds && item.serverIds.length > 0 && (
                    <div className="flex items-center gap-0.5">
                      {item.serverIds.map((sid) => {
                        const server = selectedServers.find((s) => s.id === sid);
                        if (!server) return null;
                        return <ServerBadge key={sid} server={server} variant="compact" />;
                      })}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-medium">{item.totalEpisodeViews}</TableCell>
              <TableCell>{item.totalWatchHours.toFixed(1)}</TableCell>
              <TableCell>{item.uniqueViewers}</TableCell>
              <TableCell>{getCompletionBadge(item.avgCompletionRate)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.bingeScore.toFixed(0)}</span>
                  {getBingeScoreBadge(item.bingeScore)}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <span className="text-muted-foreground text-sm">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
