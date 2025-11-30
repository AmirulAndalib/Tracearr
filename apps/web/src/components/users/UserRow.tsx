import { Link } from 'react-router';
import { User, Trophy, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserRowProps {
  userId: string;
  username: string;
  thumbUrl?: string | null;
  serverId?: string | null;
  trustScore: number;
  playCount: number;
  watchTimeHours: number;
  rank: number;
  className?: string;
  style?: React.CSSProperties;
}

function getAvatarUrl(serverId: string | null | undefined, thumbUrl: string | null | undefined, size = 40) {
  if (!thumbUrl) return null;
  if (thumbUrl.startsWith('http')) return thumbUrl;
  if (!serverId) return null;
  return `/api/v1/images/proxy?server=${serverId}&url=${encodeURIComponent(thumbUrl)}&width=${size}&height=${size}&fallback=avatar`;
}

function getTrustScoreColor(score: number) {
  if (score >= 80) return 'text-green-500';
  if (score >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

export function UserRow({
  userId,
  username,
  thumbUrl,
  serverId,
  trustScore,
  playCount,
  watchTimeHours,
  rank,
  className,
  style,
}: UserRowProps) {
  const avatarUrl = getAvatarUrl(serverId, thumbUrl);

  return (
    <Link
      to={`/users/${userId}`}
      className={cn(
        'group flex animate-slide-in-right items-center gap-4 rounded-lg border bg-card p-3 transition-all duration-200 hover:border-primary/50 hover:bg-accent hover:shadow-md',
        className
      )}
      style={style}
    >
      {/* Rank */}
      <div className="w-8 text-center text-lg font-bold text-muted-foreground">{rank}</div>

      {/* Avatar */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <User className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{username}</p>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-sm">
        <div className="text-right">
          <span className="font-semibold">{playCount}</span>
          <span className="ml-1 text-muted-foreground">plays</span>
        </div>
        <div className="w-16 text-right text-muted-foreground">{watchTimeHours}h</div>
        <div className={cn('flex w-20 items-center gap-1 text-right', getTrustScoreColor(trustScore))}>
          <Trophy className="h-3.5 w-3.5" />
          <span className="font-medium">{trustScore}%</span>
        </div>
      </div>

      {/* Arrow */}
      <ChevronRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
