import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createContact,
  deleteContact,
  enrollCampaign,
  importContacts,
  listCampaigns,
  listContacts,
  patchContact,
} from '../api';
import type { ContactImportItem, ImportResult } from '../api';
import Modal from '../components/Modal';
import StageBadge from '../components/StageBadge';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import type { Stage } from '../types';
import { STAGES } from '../types';
import { formatDate } from '../utils/date';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Contacts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [csvData, setCsvData] = useState<{ filename: string; rawText: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { stage, search, page }],
    queryFn: () => listContacts({ stage, search, page }),
  });

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: listCampaigns,
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteContact(id),
    onSuccess: (_d, id) => {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const unsubscribe = useMutation({
    mutationFn: (id: number) => patchContact(id, { unsubscribed: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  const resubscribe = useMutation({
    mutationFn: (id: number) => patchContact(id, { unsubscribed: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts'] }),
  });

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChecked =
    !!data?.items?.length && data.items.every((c) => selected.has(c.id));
  const toggleAll = () => {
    if (!data?.items) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        data.items.forEach((c) => next.delete(c.id));
      } else {
        data.items.forEach((c) => next.add(c.id));
      }
      return next;
    });
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      setCsvData({ filename: file.name, rawText: text });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your contact list</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
          >
            Import CSV
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
          >
            Add contact
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <select
          value={stage}
          onChange={(e) => {
            setStage(e.target.value as Stage | '');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search email or name"
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>

      {selected.size > 0 ? (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-indigo-800">{selected.size} selected</div>
          <div className="flex gap-2">
            <button
              onClick={() => setEnrollOpen(true)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
            >
              Enroll in campaign…
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading...
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No contacts found" description="Try adjusting filters or adding a contact." />
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-500">Stage</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-500">Source</th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-gray-500">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/contacts/${c.id}`)}
                >
                  <td
                    className="px-4 py-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(c.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {c.email}
                    {c.unsubscribed ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-rose-700">
                        Unsubscribed
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {c.first_name || c.last_name ? (
                      <div>
                        <span className="font-medium text-gray-900">
                          {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                        </span>
                        {c.business_name ? (
                          <div className="text-xs text-gray-500">{c.business_name}</div>
                        ) : null}
                      </div>
                    ) : c.name ? (
                      <div>
                        <span className="font-medium text-gray-900">{c.name}</span>
                        {c.business_name ? (
                          <div className="text-xs text-gray-500">{c.business_name}</div>
                        ) : null}
                      </div>
                    ) : c.business_name ? (
                      <div className="font-medium text-gray-900">{c.business_name}</div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StageBadge stage={c.stage} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{c.source || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(c.created_at)}
                  </td>
                  <td
                    className="px-4 py-3 text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!c.unsubscribed ? (
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Mark ${c.email} as unsubscribed? This stops all active campaigns for this contact.`,
                            )
                          ) {
                            unsubscribe.mutate(c.id);
                          }
                        }}
                        disabled={unsubscribe.isPending}
                        className="text-rose-600 hover:text-rose-800 text-sm font-medium disabled:opacity-50 mr-3"
                      >
                        Unsubscribe
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (
                            window.confirm(
                              `Re-subscribe ${c.email}? They'll be eligible for campaign sends again. Existing stopped enrollments won't auto-resume — re-enroll them separately if needed.`,
                            )
                          ) {
                            resubscribe.mutate(c.id);
                          }
                        }}
                        disabled={resubscribe.isPending}
                        className="text-emerald-700 hover:text-emerald-800 text-sm font-medium disabled:opacity-50 mr-3"
                      >
                        Re-subscribe
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${c.email}? This removes the contact and all their events/enrollments.`,
                          )
                        ) {
                          del.mutate(c.id);
                        }
                      }}
                      disabled={del.isPending}
                      className="text-rose-600 hover:text-rose-800 text-sm font-medium disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar
            page={page}
            setPage={setPage}
            shown={data.items.length}
            total={data.total}
            limit={50}
          />
        </div>
      )}

      <AddContactModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['contacts'] })}
      />

      <ImportCSVModal
        csvData={csvData}
        onClose={() => setCsvData(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['contacts'] })}
      />

      <EnrollModal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        contactIds={Array.from(selected)}
        campaigns={(campaigns || []).map((c) => ({ id: c.id, name: c.name }))}
        onDone={() => {
          setEnrollOpen(false);
          setSelected(new Set());
        }}
      />
    </div>
  );
}

function PaginationBar({
  page,
  setPage,
  shown,
  total,
  limit,
}: {
  page: number;
  setPage: (p: number) => void;
  shown: number;
  total: number;
  limit: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const [jumpVal, setJumpVal] = useState<string>('');

  const commitJump = () => {
    const n = parseInt(jumpVal, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(1, Math.min(totalPages, n));
    setPage(clamped);
    setJumpVal('');
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
      <div>
        Showing {shown} of {total}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50"
        >
          Prev
        </button>
        <span className="px-2 py-1">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50"
        >
          Next
        </button>
        <div className="flex items-center gap-1 ml-2 border-l border-gray-200 pl-3">
          <span className="text-xs text-gray-500">Go to</span>
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpVal}
            placeholder={String(page)}
            onChange={(e) => setJumpVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitJump();
            }}
            className="w-16 px-2 py-1 border border-gray-300 rounded-md text-sm"
          />
          <button
            onClick={commitJump}
            disabled={!jumpVal}
            className="px-2 py-1 border border-gray-300 rounded-md text-xs disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </div>
    </div>
  );
}

function AddContactModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
    setBusinessName('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const mut = useMutation({
    mutationFn: () =>
      createContact({
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        business_name: businessName.trim() || undefined,
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      onSaved();
      handleClose();
    },
    onError: (err: unknown) => {
      let msg = 'Failed to add contact';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: unknown } } }).response;
        const detail = r?.data?.detail;
        if (typeof detail === 'string') msg = detail;
        else if (Array.isArray(detail) && detail.length > 0) {
          const first = detail[0] as { msg?: string; loc?: unknown[] };
          msg = `${first.loc?.join('.') || 'field'}: ${first.msg || 'invalid'}`;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    },
  });

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add Contact"
      footer={
        <>
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => email.trim() && mut.mutate()}
            disabled={!email.trim() || mut.isPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
          >
            {mut.isPending ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-rose-500">*</span>
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. alex@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="e.g. Morgan"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Acme Corp"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        {error ? (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded text-sm">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

interface ParsedPreviewRow {
  email: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  valid: boolean;
  reason?: string;
}

function ImportCSVModal({
  csvData,
  onClose,
  onSaved,
}: {
  csvData: { filename: string; rawText: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!csvData) {
      return { rows: [], hasHeader: false, validContacts: [], skippedPreviewCount: 0 };
    }

    const lines = csvData.rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return { rows: [], hasHeader: false, validContacts: [], skippedPreviewCount: 0 };
    }

    const parseRow = (line: string): string[] => {
      const row: string[] = [];
      let insideQuotes = false;
      let entry = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') {
            entry += '"';
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (char === ',' && !insideQuotes) {
          row.push(entry.trim());
          entry = '';
        } else {
          entry += char;
        }
      }
      row.push(entry.trim());
      return row;
    };

    const headers = parseRow(lines[0]).map((h) =>
      h.toLowerCase().replace(/[\s_-]+/g, ''),
    );

    const emailIdx = headers.findIndex((h) => h === 'email');
    const firstNameIdx = headers.findIndex(
      (h) => h === 'firstname' || h === 'first',
    );
    const lastNameIdx = headers.findIndex(
      (h) => h === 'lastname' || h === 'last',
    );
    const businessNameIdx = headers.findIndex(
      (h) =>
        h === 'businessname' ||
        h === 'business' ||
        h === 'company' ||
        h === 'companyname',
    );

    if (emailIdx === -1) {
      return { rows: [], hasHeader: false, validContacts: [], skippedPreviewCount: 0 };
    }

    const rows: ParsedPreviewRow[] = [];
    const validContacts: ContactImportItem[] = [];
    const seenEmails = new Set<string>();
    let skippedPreviewCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length === 0 || cols.every((c) => !c)) continue;

      const email = cols[emailIdx]?.trim() || '';
      const first_name = firstNameIdx !== -1 ? cols[firstNameIdx]?.trim() || undefined : undefined;
      const last_name = lastNameIdx !== -1 ? cols[lastNameIdx]?.trim() || undefined : undefined;
      const business_name = businessNameIdx !== -1 ? cols[businessNameIdx]?.trim() || undefined : undefined;

      if (!email) {
        rows.push({ email: '—', first_name, last_name, business_name, valid: false, reason: 'Missing email' });
        skippedPreviewCount++;
        continue;
      }

      const emailLower = email.toLowerCase();
      if (!EMAIL_REGEX.test(emailLower)) {
        rows.push({ email, first_name, last_name, business_name, valid: false, reason: 'Invalid email' });
        skippedPreviewCount++;
        continue;
      }

      if (seenEmails.has(emailLower)) {
        rows.push({ email, first_name, last_name, business_name, valid: false, reason: 'Duplicate in file' });
        skippedPreviewCount++;
        continue;
      }

      seenEmails.add(emailLower);
      rows.push({ email, first_name, last_name, business_name, valid: true });
      validContacts.push({ email: emailLower, first_name, last_name, business_name });
    }

    return { rows, hasHeader: true, validContacts, skippedPreviewCount };
  }, [csvData]);

  const importMut = useMutation({
    mutationFn: () => importContacts(parsed.validContacts),
    onSuccess: (data) => {
      setResult(data);
      onSaved();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Import failed');
    },
  });

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  if (!csvData) return null;

  return (
    <Modal
      open={true}
      onClose={handleClose}
      title={result ? 'Import Completed' : 'Preview CSV Import'}
      footer={
        result ? (
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => importMut.mutate()}
              disabled={parsed.validContacts.length === 0 || importMut.isPending}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60"
            >
              {importMut.isPending
                ? 'Importing...'
                : `Import ${parsed.validContacts.length} Contact${parsed.validContacts.length === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4 py-2">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-sm">
            <div className="font-semibold text-base mb-1">Import finished!</div>
            <ul className="list-disc list-inside space-y-1 mt-2 text-sm">
              <li>
                <strong>{result.imported}</strong> contact{result.imported === 1 ? '' : 's'} successfully imported.
              </li>
              <li>
                <strong>{result.skipped + parsed.skippedPreviewCount}</strong> contact{result.skipped + parsed.skippedPreviewCount === 1 ? '' : 's'} skipped (already existed in database, duplicates, or invalid).
              </li>
            </ul>
          </div>
        </div>
      ) : !parsed.hasHeader ? (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded text-sm">
          Could not find an "email" header in <strong>{csvData.filename}</strong>. The CSV must have an <code>email</code> column.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              File: <strong>{csvData.filename}</strong> ({parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'})
            </span>
            <div className="flex gap-2">
              <span className="text-emerald-700 font-medium">
                {parsed.validContacts.length} valid
              </span>
              {parsed.skippedPreviewCount > 0 ? (
                <span className="text-amber-700 font-medium">
                  {parsed.skippedPreviewCount} skipped
                </span>
              ) : null}
            </div>
          </div>

          <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Email</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">First Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Last Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Business Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parsed.rows.map((r, i) => (
                  <tr key={i} className={r.valid ? 'hover:bg-gray-50' : 'bg-rose-50/50'}>
                    <td className="px-3 py-2 font-mono text-gray-900">{r.email}</td>
                    <td className="px-3 py-2 text-gray-700">{r.first_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{r.last_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{r.business_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.valid ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                          Ready
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-800" title={r.reason}>
                          {r.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error ? (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded text-sm">
              {error}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function EnrollModal({
  open,
  onClose,
  contactIds,
  campaigns,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  contactIds: number[];
  campaigns: { id: number; name: string }[];
  onDone: () => void;
}) {
  const [campaignId, setCampaignId] = useState<number | ''>('');
  const mut = useMutation({
    mutationFn: () => enrollCampaign(Number(campaignId), { contact_ids: contactIds }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enroll in campaign"
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => campaignId && mut.mutate()}
            disabled={!campaignId || mut.isPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
          >
            Enroll {contactIds.length}
          </button>
        </>
      }
    >
      <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
      <select
        value={campaignId}
        onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : '')}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
      >
        <option value="">Select campaign</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Modal>
  );
}
