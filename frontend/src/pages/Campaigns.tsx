import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createCampaign,
  duplicateCampaign,
  getCampaignStats,
  listCampaigns,
} from '../api';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import type { Campaign } from '../types';

function CampaignRow({
  campaign,
  onOpen,
  onDuplicate,
}: {
  campaign: Campaign;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-stats', campaign.id],
    queryFn: () => getCampaignStats(campaign.id),
    enabled: !campaign.summary,
  });

  const sent = campaign.summary?.sent ?? data?.sent;
  const openRate = campaign.summary?.open_rate ?? data?.rates?.open;
  const clickRate = campaign.summary?.click_rate ?? data?.rates?.click;
  const replyRate = campaign.summary?.reply_rate ?? data?.rates?.reply;
  const regRate = campaign.summary?.registered_rate ?? data?.rates?.registered;

  const fmt = (v: number | undefined) =>
    v === undefined ? (isLoading ? '…' : '—') : `${(v * 100).toFixed(1)}%`;
  const num = (v: number | undefined) =>
    v === undefined ? (isLoading ? '…' : '—') : v;

  return (
    <tr
      className="hover:bg-gray-50 cursor-pointer border-t border-gray-100"
      onClick={onOpen}
    >
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{campaign.name}</td>
      <td className="px-4 py-3 text-sm">
        <StatusBadge status={campaign.status} />
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{num(sent)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{fmt(openRate)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{fmt(clickRate)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{fmt(replyRate)}</td>
      <td className="px-4 py-3 text-sm text-gray-700">{fmt(regRate)}</td>
      <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="text-gray-600 hover:text-gray-900 text-sm font-medium mr-3"
        >
          Duplicate
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
        >
          View
        </button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-emerald-100 text-emerald-700',
    paused: 'bg-amber-100 text-amber-700',
    archived: 'bg-gray-100 text-gray-500',
  };
  const cls = map[status] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default function Campaigns() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: listCampaigns });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [threadEmails, setThreadEmails] = useState(false);

  const [dupSource, setDupSource] = useState<Campaign | null>(null);
  const [dupName, setDupName] = useState('');
  const [dupCopyRecipients, setDupCopyRecipients] = useState(false);

  const create = useMutation({
    mutationFn: createCampaign,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setOpen(false);
      setName('');
      setThreadEmails(false);
      navigate(`/campaigns/${res.id}`);
    },
  });

  const duplicate = useMutation({
    mutationFn: (vars: { id: number; name: string; copy_recipients: boolean }) =>
      duplicateCampaign(vars.id, {
        name: vars.name,
        copy_recipients: vars.copy_recipients,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setDupSource(null);
      setDupName('');
      setDupCopyRecipients(false);
      navigate(`/campaigns/${res.id}`);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Campaigns</h1>
          <p className="text-sm text-gray-500 mt-1">Manage email campaigns</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          New Campaign
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading...
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Create your first campaign to get started."
          action={
            <button
              onClick={() => setOpen(true)}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
            >
              New Campaign
            </button>
          }
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Sent</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Open Rate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Click Rate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Reply Rate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Registered Rate</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  onOpen={() => navigate(`/campaigns/${c.id}`)}
                  onDuplicate={() => {
                    setDupSource(c);
                    setDupName(`${c.name} (copy)`);
                    setDupCopyRecipients(false);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Campaign"
        footer={
          <>
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => name.trim() && create.mutate({ name: name.trim(), thread_emails: threadEmails })}
              disabled={!name.trim() || create.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
            >
              Create
            </button>
          </>
        }
      >
        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Spring outreach"
        />
        <label className="flex items-start gap-2 mt-4 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={threadEmails}
            onChange={(e) => setThreadEmails(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            Thread emails
            <span className="block text-xs text-gray-500">
              Send follow-up steps as replies to the first email so the whole sequence stays in one conversation thread.
            </span>
          </span>
        </label>
      </Modal>

      <Modal
        open={!!dupSource}
        onClose={() => setDupSource(null)}
        title={dupSource ? `Duplicate "${dupSource.name}"` : 'Duplicate campaign'}
        footer={
          <>
            <button
              onClick={() => setDupSource(null)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (!dupSource || !dupName.trim()) return;
                duplicate.mutate({
                  id: dupSource.id,
                  name: dupName.trim(),
                  copy_recipients: dupCopyRecipients,
                });
              }}
              disabled={!dupSource || !dupName.trim() || duplicate.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
            >
              {duplicate.isPending ? 'Duplicating...' : 'Duplicate'}
            </button>
          </>
        }
      >
        <label className="block text-sm font-medium text-gray-700 mb-1">New campaign name</label>
        <input
          type="text"
          value={dupName}
          onChange={(e) => setDupName(e.target.value)}
          autoFocus
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          Steps (emails and day offsets) are always copied. The new campaign starts as a draft.
        </p>
        <label className="flex items-start gap-2 mt-4 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={dupCopyRecipients}
            onChange={(e) => setDupCopyRecipients(e.target.checked)}
            className="mt-0.5 rounded"
          />
          <span>
            Also copy recipients
            <span className="block text-xs text-gray-500">
              Enroll every contact currently in the source campaign into the new one. Unsubscribed contacts are skipped.
            </span>
          </span>
        </label>
      </Modal>
    </div>
  );
}
