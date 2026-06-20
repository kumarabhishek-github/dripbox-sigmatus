import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '../api';
import StatCard from '../components/StatCard';
import StageBadge from '../components/StageBadge';
import Spinner from '../components/Spinner';
import { STAGES } from '../types';

export default function Dashboard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your email campaigns</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading dashboard...
        </div>
      ) : isError || !data ? (
        <div className="text-sm text-rose-600">Failed to load dashboard.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Sends Today" value={data.sends_today ?? 0} />
            <StatCard label="Opens (7d)" value={data.opens_7d ?? 0} />
            <StatCard label="Clicks (7d)" value={data.clicks_7d ?? 0} />
            <StatCard label="Replies (7d)" value={data.replies_7d ?? 0} />
            <StatCard label="Upcoming Queue" value={data.upcoming_queue_count ?? 0} />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-sm font-semibold text-gray-900 mb-4">
              Stage breakdown
            </div>
            <div className="flex flex-wrap gap-3">
              {STAGES.map((stage) => (
                <div
                  key={stage}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-3 py-2"
                >
                  <StageBadge stage={stage} />
                  <span className="text-sm font-medium text-gray-900">
                    {data.stage_counts?.[stage] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
