import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-gray-300 p-10 text-center">
      <div className="text-base font-medium text-gray-900">{title}</div>
      {description ? (
        <div className="mt-1 text-sm text-gray-500">{description}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
