import { Film, BarChart3 } from 'lucide-react';
import type { TopMoviesResponse } from '@tracearr/shared';
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

type MovieSortBy = 'plays' | 'watch_hours' | 'viewers' | 'completion_rate';

interface TopMoviesTableProps {
  data: TopMoviesResponse | undefined;
  isLoading?: boolean;
  page: number;
  onPageChange: (page: number) => void;
  sortBy: MovieSortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: MovieSortBy, sortOrder: SortOrder) => void;
  selectedServers?: Server[];
  isMultiServer?: boolean;
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
 * Table component for displaying top movies by engagement metrics.
 * Server-side sortable by plays, watch hours, viewers, and completion rate.
 * In multi-server mode renders per-title color dots for each server that owns the title.
 */
export function TopMoviesTable({
  data,
  isLoading,
  page,
  onPageChange,
  sortBy,
  sortOrder,
  onSortChange,
  selectedServers = [],
  isMultiServer = false,
}: TopMoviesTableProps) {
  const handleSort = (field: MovieSortBy) => {
    onSortChange(field, nextSortOrder(field, sortBy, sortOrder, 'desc'));
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="text-muted-foreground">Loading movies...</div>
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No movie watch data"
        description="Movie watch statistics will appear here once content has been played."
      />
    );
  }

  const totalPages = Math.ceil(data.pagination.total / data.pagination.pageSize);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[40%]">Title</TableHead>
            <SortableTableHead
              field="plays"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
            >
              Plays
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((item) => (
            <TableRow key={item.ratingKey}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <Film className="h-3 w-3" />
                    Movie
                  </Badge>
                  <div>
                    <span className="font-medium">{item.title}</span>
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
              <TableCell className="font-medium">{item.totalPlays}</TableCell>
              <TableCell>{item.totalWatchHours.toFixed(1)}</TableCell>
              <TableCell>{item.uniqueViewers}</TableCell>
              <TableCell>{getCompletionBadge(item.completionRate)}</TableCell>
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
