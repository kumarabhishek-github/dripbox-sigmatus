import type { Stage } from '../types';

const STAGE_STYLES: Record<Stage, string> = {
  new: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-100 text-blue-700',
  opened: 'bg-indigo-100 text-indigo-700',
  replied: 'bg-purple-100 text-purple-700',
  interested: 'bg-amber-100 text-amber-700',
  registered: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-rose-100 text-rose-700',
};

export default function StageBadge({ stage }: { stage: Stage }) {
  const cls = STAGE_STYLES[stage] || STAGE_STYLES.new;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {stage}
    </span>
  );
}
