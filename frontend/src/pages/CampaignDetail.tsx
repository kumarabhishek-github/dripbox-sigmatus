import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  enrollCampaign,
  getCampaign,
  getCampaignStats,
  getCampaignUpcoming,
  getRecipientTimeline,
  listContacts,
  listRecipients,
  listSources,
  patchContact,
  removeEnrollment,
  sendAll,
  sendNow,
  listTemplates,
  pauseCampaign,
  patchCampaign,
  putCampaignSteps,
  resumeCampaign,
} from '../api';
import StatCard from '../components/StatCard';
import Spinner from '../components/Spinner';
import type { CampaignStep, RecipientStage, Stage } from '../types';
import { RECIPIENT_STAGES, STAGES } from '../types';
import { formatDateTime, parseServerDate } from '../utils/date';

function RecipientsSection({ campaignId }: { campaignId: number }) {
  const queryClient = useQueryClient();
  const [stageFilter, setStageFilter] = useState<RecipientStage | ''>('');
  const [clickedOnly, setClickedOnly] = useState(false);
  const { data: recipients, isLoading } = useQuery({
    queryKey: ['campaign-recipients', campaignId, stageFilter, clickedOnly],
    queryFn: () =>
      listRecipients(campaignId, {
        stage: stageFilter,
        clicked: clickedOnly ? true : undefined,
      }),
    enabled: Number.isFinite(campaignId),
    refetchInterval: 30000,
  });
  const [expanded, setExpanded] = useState<number | null>(null);

  const unsubscribe = useMutation({
    mutationFn: (contactId: number) =>
      patchContact(contactId, { unsubscribed: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-recipients', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-upcoming', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-stats', campaignId] });
    },
  });

  const remove = useMutation({
    mutationFn: (enrollmentId: number) => removeEnrollment(campaignId, enrollmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-recipients', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-upcoming', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-stats', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
  });

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-gray-900">Recipients</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Per-contact view of stage, sends, opens, and replies in this campaign.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as RecipientStage | '')}
            className="px-2 py-1 border border-gray-300 rounded-md text-xs"
          >
            <option value="">All stages</option>
            {RECIPIENT_STAGES.map((s) => (
              <option key={s} value={s}>
                Stage: {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={clickedOnly}
              onChange={(e) => setClickedOnly(e.target.checked)}
              className="rounded"
            />
            Clicked only
          </label>
          <span className="text-xs text-gray-500">{recipients?.length ?? 0} shown</span>
        </div>
      </div>
      {isLoading ? (
        <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading...
        </div>
      ) : !recipients || recipients.length === 0 ? (
        <div className="p-6 text-sm text-gray-500 text-center">
          No recipients yet. Use the panel above to enroll some.
        </div>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Recipient</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Stage</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Sent</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Opens</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Clicks</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Replies</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Next send</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => {
              const isOpen = expanded === r.enrollment_id;
              return (
                <Fragment key={r.enrollment_id}>
                  <tr
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : r.enrollment_id)}
                  >
                    <td className="px-4 py-2 text-gray-900">
                      {r.contact_name ? `${r.contact_name} <${r.contact_email}>` : r.contact_email}
                      {r.unsubscribed ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-rose-700">Unsubscribed</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{r.stage}</td>
                    <td className="px-4 py-2 text-gray-700">{r.sent_count}</td>
                    <td className="px-4 py-2 text-gray-700">{r.opens_unique}</td>
                    <td className="px-4 py-2 text-gray-700">{r.clicks_count}</td>
                    <td className="px-4 py-2 text-gray-700">{r.replies_unique}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {r.next_send_at ? relativeTime(r.next_send_at) : '—'}
                    </td>
                    <td
                      className="px-4 py-2 text-right text-sm whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!r.unsubscribed ? (
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                `Mark ${r.contact_email} as unsubscribed? This stops all active campaigns for this contact.`,
                              )
                            ) {
                              unsubscribe.mutate(r.contact_id);
                            }
                          }}
                          disabled={unsubscribe.isPending}
                          className="text-rose-600 hover:text-rose-800 font-medium disabled:opacity-50 mr-3"
                        >
                          Unsubscribe
                        </button>
                      ) : null}
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${r.contact_email} from this campaign?\n\nThis deletes the enrollment, its pending sends, and any engagement events tied to its sends. The contact itself is not deleted.`,
                            )
                          ) {
                            remove.mutate(r.enrollment_id);
                          }
                        }}
                        disabled={remove.isPending}
                        className="text-rose-600 hover:text-rose-800 font-medium disabled:opacity-50 mr-3"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => setExpanded(isOpen ? null : r.enrollment_id)}
                        className="text-indigo-600 hover:text-indigo-800"
                      >
                        {isOpen ? 'Hide' : 'View timeline'}
                      </button>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={8} className="bg-gray-50 px-4 py-3 border-t border-gray-100">
                        <RecipientTimeline campaignId={campaignId} enrollmentId={r.enrollment_id} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecipientTimeline({
  campaignId,
  enrollmentId,
}: {
  campaignId: number;
  enrollmentId: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['recipient-timeline', campaignId, enrollmentId],
    queryFn: () => getRecipientTimeline(campaignId, enrollmentId),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner /> Loading timeline...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-600">
        Enrolled {formatDateTime(data.enrollment.enrolled_at)}
        {data.enrollment.stopped_reason ? ` · stopped: ${data.enrollment.stopped_reason}` : ''}
      </div>
      {data.sends.length === 0 ? (
        <div className="text-sm text-gray-500">No sends scheduled for this enrollment.</div>
      ) : (
        <ol className="space-y-2">
          {data.sends.map((s) => (
            <li key={s.send_id} className="bg-white border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-medium text-gray-900">
                  Email {s.step_order ?? '?'} · {s.template_name ?? 'unknown template'}
                </div>
                <div className="text-xs">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] uppercase tracking-wide ${
                      s.status === 'sent'
                        ? 'bg-emerald-100 text-emerald-800'
                        : s.status === 'failed'
                          ? 'bg-rose-100 text-rose-800'
                          : s.status === 'skipped'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {s.sent_at ? (
                  <>Sent {formatDateTime(s.sent_at)}</>
                ) : (
                  <>Scheduled {formatDateTime(s.send_at)}</>
                )}
                {s.error ? <span className="text-rose-600 ml-2">· {s.error}</span> : null}
              </div>
              {s.events.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {s.events.map((e) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <span
                        className={`inline-block w-2 h-2 mt-1 rounded-full ${
                          e.type === 'opened'
                            ? 'bg-emerald-500'
                            : e.type === 'clicked'
                              ? 'bg-indigo-500'
                              : e.type === 'replied'
                                ? 'bg-amber-500'
                                : e.type === 'bounced'
                                  ? 'bg-rose-600'
                                  : e.type === 'unsubscribed'
                                    ? 'bg-rose-500'
                                    : 'bg-gray-400'
                        }`}
                      />
                      <span className="text-gray-700 uppercase tracking-wide text-[10px]">
                        {e.type === 'bounced' ? 'failed' : e.type}
                      </span>
                      <span className="text-gray-500">{formatDateTime(e.created_at)}</span>
                      {e.type === 'clicked' && typeof e.data.url === 'string' ? (
                        <span className="text-gray-500 truncate max-w-md">→ {e.data.url}</span>
                      ) : null}
                      {e.type === 'replied' && typeof e.data.snippet === 'string' ? (
                        <span className="text-gray-500 italic truncate max-w-md">"{e.data.snippet}"</span>
                      ) : null}
                      {e.type === 'bounced' && typeof e.data.subject === 'string' ? (
                        <span className="text-gray-500 italic truncate max-w-md">{e.data.subject}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EnrolledList({ campaignId }: { campaignId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-recipients', campaignId, '', false],
    queryFn: () => listRecipients(campaignId, {}),
    enabled: Number.isFinite(campaignId),
  });
  const [showAll, setShowAll] = useState(false);
  const items = data || [];
  const preview = showAll ? items : items.slice(0, 10);

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-md p-3 mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Spinner /> Loading enrolled contacts...
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 rounded-md p-3 mb-4 text-sm text-gray-500">
        No contacts enrolled in this campaign yet.
      </div>
    );
  }
  return (
    <div className="border border-gray-200 rounded-md mb-4 overflow-hidden">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 flex items-center justify-between">
        <span>Currently enrolled ({items.length})</span>
        {items.length > 10 ? (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            {showAll ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        ) : null}
      </div>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-gray-500">Email</th>
            <th className="px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-gray-500">Name</th>
            <th className="px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-gray-500">Stage</th>
            <th className="px-3 py-1.5 text-left text-[11px] uppercase tracking-wide text-gray-500">Sent</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((r) => (
            <tr key={r.enrollment_id} className="border-t border-gray-100">
              <td className="px-3 py-1.5 text-gray-900">{r.contact_email}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.contact_name || '—'}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.stage}</td>
              <td className="px-3 py-1.5 text-gray-700">{r.sent_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function pct(v: number | undefined) {
  return v === undefined || v === null ? '0.0%' : `${(v * 100).toFixed(1)}%`;
}

function relativeTime(iso: string): string {
  const d = parseServerDate(iso);
  if (!d) return '—';
  const target = d.getTime();
  const now = Date.now();
  const diffMs = target - now;
  const abs = Math.abs(diffMs);
  const past = diffMs < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return past ? 'just now' : 'in less than a minute';
  if (mins < 60) return past ? `${mins} min ago` : `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return past ? `${hours} hr ago` : `in ${hours} hr`;
  const days = Math.round(hours / 24);
  if (days < 30) return past ? `${days} day${days === 1 ? '' : 's'} ago` : `in ${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return past ? `${months} mo ago` : `in ${months} mo`;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = Number(id);
  const queryClient = useQueryClient();

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => getCampaign(campaignId),
    enabled: Number.isFinite(campaignId),
  });

  const { data: stats } = useQuery({
    queryKey: ['campaign-stats', campaignId],
    queryFn: () => getCampaignStats(campaignId),
    enabled: Number.isFinite(campaignId),
  });

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: listTemplates,
  });

  const { data: upcoming } = useQuery({
    queryKey: ['campaign-upcoming', campaignId],
    queryFn: () => getCampaignUpcoming(campaignId, 20),
    enabled: Number.isFinite(campaignId),
    refetchInterval: 30000,
  });

  const [sendNowMsg, setSendNowMsg] = useState<{
    id: number;
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  const [sendAllMsg, setSendAllMsg] = useState<string | null>(null);
  const sendAllMut = useMutation({
    mutationFn: () => sendAll(campaignId),
    onSuccess: (res) => {
      setSendAllMsg(
        res.queued > 0
          ? `Queued ${res.queued} send${res.queued === 1 ? '' : 's'}. They'll fire over the next few minutes with jitter between each.`
          : 'Nothing pending to send.',
      );
      invalidate();
    },
    onError: () => setSendAllMsg('Send all failed.'),
  });

  const sendNowMut = useMutation({
    mutationFn: (sendId: number) => sendNow(campaignId, sendId),
    onSuccess: (res) => {
      setSendNowMsg({
        id: res.send_id,
        kind: res.status === 'sent' ? 'ok' : 'err',
        text:
          res.status === 'sent'
            ? 'Sent.'
            : res.status === 'skipped'
              ? `Skipped: ${res.error || 'not eligible'}`
              : `Status: ${res.status}`,
      });
      invalidate();
    },
    onError: (err: unknown, sendId) => {
      let text = 'Send failed';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: string } } }).response;
        if (r?.data?.detail) text = r.data.detail;
      }
      setSendNowMsg({ id: sendId, kind: 'err', text });
    },
  });

  const [steps, setSteps] = useState<CampaignStep[]>([]);
  useEffect(() => {
    if (campaign?.steps) setSteps(campaign.steps);
  }, [campaign?.steps]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['campaign-stats', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['campaign-upcoming', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  };

  const saveSteps = useMutation({
    mutationFn: () =>
      putCampaignSteps(
        campaignId,
        steps.map((s, i) => ({ ...s, order: i + 1 })),
      ),
    onSuccess: invalidate,
  });

  const pause = useMutation({ mutationFn: () => pauseCampaign(campaignId), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: () => resumeCampaign(campaignId), onSuccess: invalidate });
  const activate = useMutation({
    mutationFn: () => patchCampaign(campaignId, { status: 'active' }),
    onSuccess: invalidate,
  });

  const [enrollStage, setEnrollStage] = useState<Stage | ''>('');
  const [enrollSource, setEnrollSource] = useState<string>('');
  const [enrollMsg, setEnrollMsg] = useState<string | null>(null);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(
    new Set(),
  );

  const { data: contactsPage } = useQuery({
    queryKey: [
      'contacts',
      { stage: enrollStage, source: enrollSource, page: 1, limit: 500, not_enrolled_in: campaignId },
    ],
    queryFn: () =>
      listContacts({
        stage: enrollStage,
        source: enrollSource,
        page: 1,
        limit: 500,
        not_enrolled_in: campaignId,
      }),
    enabled: Number.isFinite(campaignId),
  });

  const { data: sources } = useQuery({
    queryKey: ['contact-sources'],
    queryFn: listSources,
  });

  // Backend already excludes contacts enrolled in this campaign via not_enrolled_in.
  const eligibleContacts = contactsPage?.items || [];

  const toggleContact = (id: number) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enroll = useMutation({
    mutationFn: () => {
      if (selectedContactIds.size > 0) {
        return enrollCampaign(campaignId, {
          contact_ids: Array.from(selectedContactIds),
        });
      }
      // No manual selection → enroll EVERY contact matching the current filter,
      // not just the page we loaded. Backend filters by stage/source and
      // auto-excludes contacts already enrolled in this campaign.
      return enrollCampaign(campaignId, {
        filter: {
          stage: (enrollStage || undefined) as Stage | undefined,
          source: enrollSource || undefined,
        },
      });
    },
    onSuccess: (res) => {
      setEnrollMsg(`Enrolled: ${JSON.stringify(res)}`);
      invalidate();
    },
    onError: (err: unknown) => {
      let msg = 'Enroll failed';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: unknown } } }).response;
        const detail = r?.data?.detail;
        if (typeof detail === 'string') msg = `Enroll failed: ${detail}`;
      }
      setEnrollMsg(msg);
    },
  });

  const [activeTab, setActiveTab] = useState<
    'emails' | 'enroll' | 'upcoming' | 'recipients' | 'by-step'
  >('emails');

  if (isLoading || !campaign) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner /> Loading campaign...
      </div>
    );
  }

  const addStep = () => {
    const nextOrder = steps.length ? Math.max(...steps.map((s) => s.order)) + 1 : 1;
    const firstTpl = templates?.[0]?.id ?? 0;
    const defaultOffset = steps.length === 0 ? 0 : 3;
    setSteps([
      ...steps,
      { order: nextOrder, template_id: firstTpl, day_offset: defaultOffset },
    ]);
  };

  const updateStep = (idx: number, patch: Partial<CampaignStep>) => {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const noTemplates = !templates || templates.length === 0;
  const stepsDirty =
    JSON.stringify(steps) !== JSON.stringify(campaign?.steps ?? []);

  const sent = stats?.sent ?? 0;
  const recipients = stats?.recipients ?? 0;
  const opens = stats?.unique_opens ?? 0;
  const clicks = stats?.unique_clicks ?? 0;
  const replies = stats?.unique_replies ?? 0;
  const unsub = stats?.unsubscribed ?? 0;
  const enrolled = stats?.enrolled ?? 0;

  type TabKey = 'emails' | 'enroll' | 'upcoming' | 'recipients' | 'by-step';
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'emails', label: 'Emails in this campaign' },
    { key: 'enroll', label: 'Enroll contacts' },
    { key: 'upcoming', label: 'Upcoming sends' },
    { key: 'recipients', label: 'Recipients' },
    { key: 'by-step', label: 'By-step breakdown' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
            <span className="text-sm text-gray-500">#{campaign.id}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Status: {campaign.status}</p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === 'active' ? (
            <button
              onClick={() => pause.mutate()}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Pause
            </button>
          ) : campaign.status === 'paused' ? (
            <button
              onClick={() => resume.mutate()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={() => activate.mutate()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              Activate
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Sent" value={sent} />
        <StatCard label="Recipients" value={recipients} />
        <StatCard
          label="Open Rate"
          value={pct(stats?.rates?.open)}
          sub={`${opens} of ${recipients}`}
        />
        <StatCard
          label="Click Rate"
          value={pct(stats?.rates?.click)}
          sub={`${clicks} of ${recipients}`}
        />
        <StatCard
          label="Reply Rate"
          value={pct(stats?.rates?.reply)}
          sub={`${replies} of ${recipients}`}
        />
        <StatCard
          label="Unsubscribe Rate"
          value={pct(stats?.rates?.unsubscribed)}
          sub={`${unsub} of ${enrolled}`}
        />
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Campaign sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`whitespace-nowrap py-2 px-1 border-b-2 text-sm font-medium ${
                activeTab === t.key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'emails' ? (
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Emails in this campaign</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Each contact you enroll receives these emails in order, spaced by the days you set.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addStep}
              disabled={noTemplates}
              title={noTemplates ? 'Add a template first (Templates page)' : ''}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              + Add email
            </button>
            <button
              onClick={() => saveSteps.mutate()}
              disabled={saveSteps.isPending || !stepsDirty}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
            >
              {saveSteps.isPending ? 'Saving...' : stepsDirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
        {noTemplates ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-sm mt-4">
            No templates found. Go to <b>Templates</b> in the sidebar to add one, then come back to build your sequence.
          </div>
        ) : steps.length === 0 ? (
          <div className="border border-dashed border-gray-300 rounded-md p-6 text-center mt-4">
            <p className="text-sm text-gray-600 mb-3">
              This campaign has no emails yet.
            </p>
            <button
              onClick={addStep}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              + Add your first email
            </button>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {steps.map((step, i) => (
              <div
                key={i}
                className="border border-gray-200 rounded-md p-4 bg-gray-50"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Email {i + 1}
                  </div>
                  <button
                    onClick={() => removeStep(i)}
                    className="text-rose-600 text-xs hover:text-rose-800"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Template
                    </label>
                    <select
                      value={step.template_id}
                      onChange={(e) =>
                        updateStep(i, { template_id: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                    >
                      {(templates || []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Send {i === 0 ? 'after enrollment' : 'after previous email'}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={step.day_offset}
                        onChange={(e) =>
                          updateStep(i, { day_offset: Number(e.target.value) })
                        }
                        className="w-20 px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                      />
                      <span className="text-sm text-gray-600">
                        day{step.day_offset === 1 ? '' : 's'} later
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {stepsDirty ? (
              <div className="text-xs text-amber-700">
                Unsaved changes. Click <b>Save changes</b> to apply.
              </div>
            ) : null}
          </div>
        )}
      </div>

      ) : null}

      {activeTab === 'enroll' ? (
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Enroll contacts</h2>
        <p className="text-xs text-gray-500 mb-3">
          Adds contacts to this campaign. Sends only fire when the campaign status is <b>active</b> and at least one email is saved.
        </p>
        {steps.length === 0 || stepsDirty ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-sm mb-3">
            {steps.length === 0
              ? 'This campaign has no emails in its sequence yet. Scroll up to "Emails in this campaign" and add at least one before enrolling contacts.'
              : 'You have unsaved changes to the email sequence above. Click "Save changes" first.'}
          </div>
        ) : null}
        {campaign.status !== 'active' ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded text-sm mb-3">
            Campaign is <b>{campaign.status}</b>. Click <b>Activate</b> at the top so the scheduler picks up new sends.
          </div>
        ) : null}
        <EnrolledList campaignId={campaignId} />
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="text-xs text-gray-600">Filter:</label>
          <select
            value={enrollStage}
            onChange={(e) => {
              setEnrollStage(e.target.value as Stage | '');
              setSelectedContactIds(new Set());
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                Stage: {s}
              </option>
            ))}
          </select>
          <select
            value={enrollSource}
            onChange={(e) => {
              setEnrollSource(e.target.value);
              setSelectedContactIds(new Set());
            }}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All sources</option>
            {(sources || []).map((s) => (
              <option key={s} value={s}>
                Source: {s}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">
            {contactsPage ? `${contactsPage.total} eligible` : ''}
            {contactsPage && contactsPage.total > eligibleContacts.length
              ? ` (${eligibleContacts.length} shown — "Enroll all" enrolls every match)`
              : ''}
          </span>
        </div>

        <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto mb-3">
          {eligibleContacts.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              {(contactsPage?.items.length ?? 0) > 0
                ? 'Every contact matching this filter is already enrolled in this campaign.'
                : 'No contacts match. Add some on the Contacts page.'}
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left w-8">
                    <input
                      type="checkbox"
                      checked={
                        eligibleContacts.length > 0 &&
                        eligibleContacts.every((c) =>
                          selectedContactIds.has(c.id),
                        )
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedContactIds(
                            new Set(eligibleContacts.map((c) => c.id)),
                          );
                        } else {
                          setSelectedContactIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Email</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Stage</th>
                </tr>
              </thead>
              <tbody>
                {eligibleContacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleContact(c.id)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.has(c.id)}
                        onChange={() => toggleContact(c.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-900">{c.email}</td>
                    <td className="px-3 py-2 text-gray-700">{c.name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{c.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => enroll.mutate()}
            disabled={
              enroll.isPending ||
              steps.length === 0 ||
              stepsDirty ||
              (selectedContactIds.size === 0 &&
                eligibleContacts.length === 0 &&
                (!contactsPage || contactsPage.total === 0))
            }
            className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
          >
            {enroll.isPending
              ? 'Enrolling...'
              : selectedContactIds.size > 0
                ? `Enroll ${selectedContactIds.size} selected`
                : contactsPage && contactsPage.total > eligibleContacts.length
                  ? `Enroll all matching (${contactsPage.total})`
                  : `Enroll all ${eligibleContacts.length}`}
          </button>
          {selectedContactIds.size > 0 ? (
            <button
              onClick={() => setSelectedContactIds(new Set())}
              className="text-xs text-gray-600 hover:text-gray-900"
            >
              Clear selection
            </button>
          ) : null}
          {enrollMsg ? <span className="text-xs text-gray-500">{enrollMsg}</span> : null}
        </div>
      </div>

      ) : null}

      {activeTab === 'upcoming' ? (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Upcoming sends</div>
            <p className="text-xs text-gray-500 mt-0.5">
              The next emails this campaign will send, in order. Times reflect business-hours and jitter offsets.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{upcoming?.length ?? 0} queued</span>
            <button
              onClick={() => {
                if (!upcoming || upcoming.length === 0) return;
                if (
                  window.confirm(
                    `Send all ${upcoming.length} queued email${upcoming.length === 1 ? '' : 's'} now, spaced by jitter? Business-hours window will be bypassed.`,
                  )
                ) {
                  sendAllMut.mutate();
                }
              }}
              disabled={sendAllMut.isPending || !upcoming || upcoming.length === 0}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {sendAllMut.isPending ? 'Queuing...' : 'Send all'}
            </button>
          </div>
        </div>
        {sendAllMsg ? (
          <div className="px-5 py-2 text-xs text-emerald-700 bg-emerald-50 border-t border-emerald-100">
            {sendAllMsg}
          </div>
        ) : null}
        {!upcoming || upcoming.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">
            No upcoming sends. Enroll a contact above to schedule the first email.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Email #</th>
                <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Template</th>
                <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Recipient</th>
                <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">When</th>
                <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Scheduled time</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((u) => (
                <tr key={u.send_id} className="border-t border-gray-100">
                  <td className="px-4 py-2 text-gray-900">{u.step_order}</td>
                  <td className="px-4 py-2 text-gray-700">{u.template_name}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {u.contact_name ? `${u.contact_name} <${u.contact_email}>` : u.contact_email}
                  </td>
                  <td className="px-4 py-2 text-indigo-700 font-medium">{relativeTime(u.send_at)}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {formatDateTime(u.send_at)}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Send "${u.template_name}" to ${u.contact_email} right now?`,
                          )
                        ) {
                          sendNowMut.mutate(u.send_id);
                        }
                      }}
                      disabled={sendNowMut.isPending}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium disabled:opacity-50"
                    >
                      Send now
                    </button>
                    {sendNowMsg && sendNowMsg.id === u.send_id ? (
                      <div
                        className={`text-xs mt-1 ${
                          sendNowMsg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {sendNowMsg.text}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      ) : null}

      {activeTab === 'recipients' ? <RecipientsSection campaignId={campaignId} /> : null}

      {activeTab === 'by-step' ? (
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">
          By-step breakdown
        </div>
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Order</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Sent</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Opens</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Open Rate</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Clicks</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Click Rate</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Replies</th>
              <th className="px-4 py-2 text-left text-xs uppercase tracking-wide text-gray-500">Reply Rate</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.by_step || []).map((row) => (
              <tr key={row.order} className="border-t border-gray-100">
                <td className="px-4 py-2 text-sm text-gray-900">{row.order}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{row.sent}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{row.opens}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{pct(row.open_rate)}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{row.clicks ?? 0}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{pct(row.click_rate)}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{row.replies}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{pct(row.reply_rate)}</td>
              </tr>
            ))}
            {(!stats?.by_step || stats.by_step.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-3 text-sm text-gray-500 text-center">
                  No step data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}
