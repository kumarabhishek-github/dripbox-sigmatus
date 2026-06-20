import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  getEmailStatus,
  getSettings,
  putSettings,
  sendTestEmail,
  testEmailConnection,
} from '../api';
import Spinner from '../components/Spinner';
import type { EmailStatus, Settings as SettingsType } from '../types';

const APP_SETTING_FIELDS: {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
}[] = [
  { key: 'base_url', label: 'Base URL', placeholder: 'http://localhost:8000' },
  { key: 'daily_send_cap', label: 'Daily send cap', type: 'number' },
  { key: 'unsubscribe_keyword', label: 'Unsubscribe keyword' },
];

interface SchedField {
  key: string;
  label: string;
  type: 'number' | 'text' | 'bool';
  placeholder?: string;
  hint?: string;
}

const SCHED_FIELDS: SchedField[] = [
  {
    key: 'send_window_enabled',
    label: 'Restrict sends to a window',
    type: 'bool',
    hint: 'When off, sends fire as soon as scheduled (no business-hours window).',
  },
  {
    key: 'send_timezone',
    label: 'Timezone',
    type: 'text',
    placeholder: 'Asia/Kolkata',
    hint: 'IANA timezone name.',
  },
  {
    key: 'send_hour_start',
    label: 'Send window start (hour, 0-23)',
    type: 'number',
    placeholder: '9',
  },
  {
    key: 'send_hour_end',
    label: 'Send window end (hour, exclusive)',
    type: 'number',
    placeholder: '18',
    hint: 'Set start=9 and end=10 to blast everything between 9–10am with jitter.',
  },
  {
    key: 'send_weekdays_only',
    label: 'Weekdays only',
    type: 'bool',
  },
  {
    key: 'send_at_jitter_minutes',
    label: 'Per-send jitter (± minutes)',
    type: 'number',
    placeholder: '30',
    hint: 'Random offset applied to each scheduled send time so they don\'t fire on round minutes.',
  },
];

interface CredField {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
}

const SMTP_FIELDS: CredField[] = [
  { key: 'smtp_host', label: 'SMTP host', placeholder: 'smtp.gmail.com' },
  { key: 'smtp_port', label: 'SMTP port', type: 'number', placeholder: '587' },
  { key: 'smtp_username', label: 'SMTP username' },
  { key: 'smtp_password', label: 'SMTP password', type: 'password' },
];

const IMAP_FIELDS: CredField[] = [
  { key: 'imap_host', label: 'IMAP host', placeholder: 'imap.gmail.com' },
  { key: 'imap_port', label: 'IMAP port', type: 'number', placeholder: '993' },
  {
    key: 'imap_username',
    label: 'IMAP username',
    placeholder: 'defaults to SMTP username',
  },
  { key: 'imap_password', label: 'IMAP password', type: 'password' },
];

const FROM_FIELDS: CredField[] = [
  { key: 'sender_email', label: 'Sender email' },
  { key: 'sender_name', label: 'Sender name' },
];

const ALL_CRED_KEYS = [
  ...SMTP_FIELDS.map((f) => f.key),
  'smtp_use_tls',
  ...IMAP_FIELDS.map((f) => f.key),
  ...FROM_FIELDS.map((f) => f.key),
];

function StatusPill({ ok }: { ok: boolean }) {
  const cls = ok
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-rose-100 text-rose-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {ok ? 'Connected' : 'Not connected'}
    </span>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  });

  const settings = data as SettingsType | undefined;

  const { data: emailStatus } = useQuery({
    queryKey: ['email-status'],
    queryFn: getEmailStatus,
    refetchInterval: 30000,
  });

  const [values, setValues] = useState<Record<string, string>>({});
  const [useTls, setUseTls] = useState<boolean>(true);
  const [schedValues, setSchedValues] = useState<Record<string, string | boolean>>({});
  const [schedSavedMsg, setSchedSavedMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [credSavedMsg, setCredSavedMsg] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<EmailStatus | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [sendTestTo, setSendTestTo] = useState<string>('');
  const [sendTestMsg, setSendTestMsg] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (settings) {
      const next: Record<string, string> = {};
      for (const f of APP_SETTING_FIELDS) {
        const v = settings[f.key];
        next[f.key] = v === undefined || v === null ? '' : String(v);
      }
      for (const key of ALL_CRED_KEYS) {
        if (key === 'smtp_use_tls') continue;
        const v = settings[key];
        next[key] = v === undefined || v === null ? '' : String(v);
      }
      setValues(next);
      setUseTls(
        settings.smtp_use_tls === undefined ? true : Boolean(settings.smtp_use_tls),
      );
      const sched: Record<string, string | boolean> = {};
      for (const f of SCHED_FIELDS) {
        const v = settings[f.key];
        if (f.type === 'bool') {
          sched[f.key] = v === undefined || v === null ? '' : Boolean(v);
        } else {
          sched[f.key] = v === undefined || v === null ? '' : String(v);
        }
      }
      setSchedValues(sched);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const f of APP_SETTING_FIELDS) {
        const raw = values[f.key];
        if (raw === '' || raw === undefined) continue;
        payload[f.key] = f.type === 'number' ? Number(raw) : raw;
      }
      return putSettings(payload);
    },
    onSuccess: () => {
      setSavedMsg('Saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => setSavedMsg(null), 2000);
    },
    onError: () => setSavedMsg('Save failed'),
  });

  const saveCreds = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      const numberKeys = new Set(['smtp_port', 'imap_port']);
      for (const key of ALL_CRED_KEYS) {
        if (key === 'smtp_use_tls') continue;
        const raw = values[key];
        if (raw === undefined) continue;
        if (numberKeys.has(key)) {
          if (raw === '') continue;
          payload[key] = Number(raw);
        } else {
          payload[key] = raw;
        }
      }
      payload.smtp_use_tls = useTls;
      return putSettings(payload);
    },
    onSuccess: () => {
      setCredSavedMsg('Saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['email-status'] });
      setTimeout(() => setCredSavedMsg(null), 2000);
    },
    onError: () => setCredSavedMsg('Save failed'),
  });

  const saveSched = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const f of SCHED_FIELDS) {
        const raw = schedValues[f.key];
        if (f.type === 'bool') {
          payload[f.key] = raw === '' ? false : Boolean(raw);
        } else if (f.type === 'number') {
          if (raw === '' || raw === undefined) continue;
          payload[f.key] = Number(raw);
        } else {
          if (raw === '' || raw === undefined) continue;
          payload[f.key] = raw;
        }
      }
      return putSettings(payload);
    },
    onSuccess: () => {
      setSchedSavedMsg('Saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => setSchedSavedMsg(null), 2000);
    },
    onError: () => setSchedSavedMsg('Save failed'),
  });

  const testConn = useMutation({
    mutationFn: testEmailConnection,
    onMutate: () => {
      setTestResult(null);
      setTestError(null);
    },
    onSuccess: (res) => {
      setTestResult(res);
      queryClient.invalidateQueries({ queryKey: ['email-status'] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Connection test failed';
      setTestError(message);
    },
  });

  const sendTest = useMutation({
    mutationFn: (to: string) => sendTestEmail(to),
    onMutate: () => setSendTestMsg(null),
    onSuccess: (res) => {
      setSendTestMsg({ kind: 'ok', text: `Sent to ${res.to}. Check the inbox.` });
    },
    onError: (err: unknown) => {
      let text = 'Send failed';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: string } } }).response;
        if (r?.data?.detail) text = r.data.detail;
      } else if (err instanceof Error) {
        text = err.message;
      }
      setSendTestMsg({ kind: 'err', text });
    },
  });

  const credBusy = saveCreds.isPending || testConn.isPending || sendTest.isPending;

  const renderField = (f: CredField) => {
    const isPassword = f.type === 'password';
    const setKey = f.key === 'smtp_password'
      ? settings?.smtp_password_set
      : f.key === 'imap_password'
        ? settings?.imap_password_set
        : false;
    const placeholder = isPassword
      ? setKey
        ? '(saved)'
        : ''
      : f.placeholder;
    return (
      <div key={f.key}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {f.label}
        </label>
        <input
          type={f.type || 'text'}
          value={values[f.key] ?? ''}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
          }
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure the app</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Email connection</h2>
        {emailStatus ? (
          <>
            <div className="border border-gray-200 rounded-md divide-y divide-gray-200">
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">SMTP (sending)</span>
                <StatusPill ok={emailStatus.smtp_ok} />
              </div>
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">IMAP (replies)</span>
                <StatusPill ok={emailStatus.imap_ok} />
              </div>
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">Sending as</span>
                <span className="text-gray-900 font-medium">
                  {emailStatus.sender_email}
                </span>
              </div>
            </div>
            {emailStatus.error ? (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded text-sm mt-3">
                {emailStatus.error}
              </div>
            ) : null}
            <p className="text-xs text-gray-500 mt-3">
              Update credentials below and click Save, then Test connection.
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner /> Checking connection...
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Email credentials</h2>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner /> Loading...
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                SMTP
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {SMTP_FIELDS.map(renderField)}
                <div className="col-span-2 flex items-center gap-2">
                  <input
                    id="smtp_use_tls"
                    type="checkbox"
                    checked={useTls}
                    onChange={(e) => setUseTls(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label
                    htmlFor="smtp_use_tls"
                    className="text-sm font-medium text-gray-700"
                  >
                    Use TLS
                  </label>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                IMAP
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {IMAP_FIELDS.map(renderField)}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                From
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {FROM_FIELDS.map(renderField)}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveCreds.mutate()}
                disabled={credBusy}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60"
              >
                {saveCreds.isPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => testConn.mutate()}
                disabled={credBusy}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-60"
              >
                {testConn.isPending ? 'Testing...' : 'Test connection'}
              </button>
              {credSavedMsg ? (
                <span className="text-sm text-gray-600">{credSavedMsg}</span>
              ) : null}
            </div>

            {testResult ? (
              <div
                className={`p-3 rounded text-sm border ${
                  testResult.smtp_ok && testResult.imap_ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {testResult.smtp_ok && testResult.imap_ok
                  ? `✓ SMTP + IMAP connected (sending as ${testResult.sender_email})`
                  : testResult.error ||
                    `SMTP ${testResult.smtp_ok ? 'OK' : 'failed'}, IMAP ${
                      testResult.imap_ok ? 'OK' : 'failed'
                    }`}
              </div>
            ) : null}
            {testError ? (
              <div className="p-3 rounded text-sm border bg-rose-50 border-rose-200 text-rose-700">
                {testError}
              </div>
            ) : null}

            <div className="border-t border-gray-200 pt-4 mt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Send a test email
              </h3>
              <div className="flex items-center gap-3">
                <input
                  type="email"
                  value={sendTestTo}
                  onChange={(e) => setSendTestTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  onClick={() => sendTest.mutate(sendTestTo)}
                  disabled={credBusy || !sendTestTo}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60"
                >
                  {sendTest.isPending ? 'Sending...' : 'Send test email'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Sends a one-off email using current SMTP credentials. Skips tracking and campaign logic.
              </p>
              {sendTestMsg ? (
                <div
                  className={`p-3 rounded text-sm border mt-3 ${
                    sendTestMsg.kind === 'ok'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {sendTestMsg.text}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Sending schedule</h2>
        <p className="text-xs text-gray-500 mb-4">
          Controls when scheduled emails actually go out. Narrow the window (e.g. 9–10) to blast everything in a high-deliverability hour; jitter is auto-applied so sends spread across the window.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner /> Loading...
          </div>
        ) : (
          <div className="space-y-4">
            {SCHED_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {f.label}
                </label>
                {f.type === 'bool' ? (
                  <div className="flex items-center gap-2">
                    <input
                      id={`sched-${f.key}`}
                      type="checkbox"
                      checked={Boolean(schedValues[f.key])}
                      onChange={(e) =>
                        setSchedValues((prev) => ({ ...prev, [f.key]: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor={`sched-${f.key}`} className="text-sm text-gray-700">
                      Enabled
                    </label>
                  </div>
                ) : (
                  <input
                    type={f.type}
                    value={(schedValues[f.key] as string) ?? ''}
                    onChange={(e) =>
                      setSchedValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                )}
                {f.hint ? (
                  <p className="text-xs text-gray-500 mt-1">{f.hint}</p>
                ) : null}
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => saveSched.mutate()}
                disabled={saveSched.isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60"
              >
                {saveSched.isPending ? 'Saving...' : 'Save'}
              </button>
              {schedSavedMsg ? (
                <span className="text-sm text-gray-600">{schedSavedMsg}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Configuration</h2>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Spinner /> Loading...
          </div>
        ) : (
          <div className="space-y-4">
            {APP_SETTING_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {f.label}
                </label>
                <input
                  type={f.type || 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                  }
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60"
              >
                Save
              </button>
              {savedMsg ? (
                <span className="text-sm text-gray-600">{savedMsg}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
