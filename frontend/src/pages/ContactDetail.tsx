import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { getContact, getContactTimeline, patchContact } from '../api';
import StageBadge from '../components/StageBadge';
import Spinner from '../components/Spinner';
import type { EventType, Stage } from '../types';
import { STAGES } from '../types';
import { formatDateTime } from '../utils/date';

const EVENT_LABEL: Record<EventType, { label: string; dot: string }> = {
  sent: { label: 'Sent', dot: 'bg-blue-500' },
  opened: { label: 'Opened', dot: 'bg-indigo-500' },
  clicked: { label: 'Clicked', dot: 'bg-purple-500' },
  replied: { label: 'Replied', dot: 'bg-emerald-500' },
  bounced: { label: 'Failed', dot: 'bg-rose-600' },
  unsubscribed: { label: 'Unsubscribed', dot: 'bg-rose-500' },
  stage_change: { label: 'Stage change', dot: 'bg-amber-500' },
};

function ContactFieldsCard({
  contactId,
  initialName,
  initialSource,
}: {
  contactId: number;
  initialName: string;
  initialSource: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);
  const [source, setSource] = useState(initialSource);

  useEffect(() => {
    setName(initialName);
    setSource(initialSource);
  }, [initialName, initialSource]);

  const mut = useMutation({
    mutationFn: () =>
      patchContact(contactId, { name: name.trim(), source: source.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const dirty = name !== initialName || source !== initialSource;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">Details</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Source</label>
          <input
            type="text"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. website, import, referral"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => mut.mutate()}
          disabled={!dirty || mut.isPending}
          className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
        >
          {mut.isPending ? 'Saving...' : dirty ? 'Save' : 'Saved'}
        </button>
        {mut.isError ? (
          <span className="text-xs text-rose-700">Save failed.</span>
        ) : null}
      </div>
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const contactId = Number(id);
  const queryClient = useQueryClient();

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => getContact(contactId),
    enabled: Number.isFinite(contactId),
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: () => getContactTimeline(contactId),
    enabled: Number.isFinite(contactId),
  });

  const mut = useMutation({
    mutationFn: (stage: Stage) => patchContact(contactId, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contact-timeline', contactId] });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  if (isLoading || !contact) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner /> Loading contact...
      </div>
    );
  }

  const customFields = contact.custom_fields || {};

  const stageBtnClass = (s: Stage) => {
    const emphasized = s === 'interested' || s === 'registered' || s === 'lost';
    const base = 'px-3 py-1.5 rounded-md text-sm font-medium border';
    if (contact.stage === s) {
      return `${base} bg-indigo-600 text-white border-indigo-600`;
    }
    if (emphasized) {
      return `${base} bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100`;
    }
    return `${base} bg-white text-gray-700 border-gray-300 hover:bg-gray-50`;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">
              {contact.name || contact.email}
            </h1>
            <StageBadge stage={contact.stage} />
            {contact.unsubscribed ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-rose-100 text-rose-700">
                Unsubscribed
              </span>
            ) : null}
          </div>
          <div className="text-sm text-gray-500 mt-1">{contact.email}</div>
        </div>
      </div>

      <ContactFieldsCard
        contactId={contactId}
        initialName={contact.name || ''}
        initialSource={contact.source || ''}
      />

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Stage actions</h2>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => mut.mutate(s)}
              disabled={mut.isPending}
              className={stageBtnClass(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Custom fields</h2>
        {Object.keys(customFields).length === 0 ? (
          <div className="text-sm text-gray-500">No custom fields.</div>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(customFields).map(([k, v]) => (
              <div key={k} className="border border-gray-100 rounded-md p-3">
                <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Active enrollments</h2>
        {!timeline?.enrollments?.length ? (
          <div className="text-sm text-gray-500">None.</div>
        ) : (
          <ul className="space-y-2">
            {timeline.enrollments.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between border border-gray-100 rounded-md px-3 py-2 text-sm"
              >
                <span className="font-medium text-gray-900">
                  {e.campaign_name || `Campaign #${e.campaign_id}`}
                </span>
                <span className="text-gray-500">
                  {e.status}
                  {e.current_step !== undefined ? ` · step ${e.current_step}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h2>
        {!timeline?.events?.length ? (
          <div className="text-sm text-gray-500">No events yet.</div>
        ) : (
          <ol className="space-y-3">
            {timeline.events.map((ev) => {
              const info = EVENT_LABEL[ev.type] || {
                label: ev.type,
                dot: 'bg-gray-400',
              };
              return (
                <li key={ev.id} className="flex items-start gap-3">
                  <span
                    className={`mt-1 inline-block w-2 h-2 rounded-full ${info.dot}`}
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <div className="text-sm text-gray-900">
                      <span className="font-medium">{info.label}</span>
                      {ev.campaign_id ? (
                        <span className="text-gray-500"> · campaign #{ev.campaign_id}</span>
                      ) : null}
                      {ev.step_order !== undefined && ev.step_order !== null ? (
                        <span className="text-gray-500"> · step {ev.step_order}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDateTime(ev.created_at)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
