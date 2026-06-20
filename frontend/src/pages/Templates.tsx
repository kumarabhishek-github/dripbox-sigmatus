import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  listContacts,
  listTemplates,
  previewTemplate,
  updateTemplate,
} from '../api';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import type { Template, TemplateFormat } from '../types';

export default function Templates() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: listTemplates,
  });

  const { data: contacts } = useQuery({
    queryKey: ['contacts', { page: 1, search: '', stage: '' }],
    queryFn: () => listContacts({ page: 1 }),
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contactId, setContactId] = useState<number | ''>('');
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const activeId =
    selectedId !== null ? selectedId : templates && templates[0] ? templates[0].id : null;
  const activeTemplate = useMemo(
    () => templates?.find((t) => t.id === activeId) ?? null,
    [templates, activeId],
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['template-preview', activeId, contactId, activeTemplate?.body, activeTemplate?.format],
    queryFn: () =>
      previewTemplate(
        activeId as number,
        contactId === '' ? undefined : Number(contactId),
      ),
    enabled: activeId !== null,
  });

  const del = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
  });

  const dup = useMutation({
    mutationFn: (vars: { id: number; name: string }) =>
      duplicateTemplate(vars.id, { name: vars.name }),
    onSuccess: (t) => {
      invalidate();
      setSelectedId(t.id);
    },
    onError: (err: unknown) => {
      let msg = 'Duplicate failed';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: unknown } } }).response;
        const detail = r?.data?.detail;
        if (typeof detail === 'string') msg = detail;
      }
      window.alert(msg);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Author HTML or plaintext emails</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
        >
          New template
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner /> Loading...
        </div>
      ) : !templates || templates.length === 0 ? (
        <EmptyState title="No templates yet" description="Create one to start sending." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">
              Templates
            </div>
            <ul>
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                      activeId === t.id ? 'bg-indigo-50' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-gray-900">{t.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 uppercase text-[10px] tracking-wide">
                        {t.format}
                      </span>
                      <span className="truncate">
                        {t.body ? 'Authored in app' : t.file_path || '—'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-semibold text-gray-900">Preview</div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-gray-600">Contact:</label>
                <select
                  value={contactId}
                  onChange={(e) =>
                    setContactId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">No contact</option>
                  {(contacts?.items || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.email}
                    </option>
                  ))}
                </select>
                {activeTemplate ? (
                  <>
                    <button
                      onClick={() => setEditOpen(true)}
                      className="px-2 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        const suggested = `${activeTemplate.name} (copy)`;
                        const name = window.prompt(
                          'New template name:',
                          suggested,
                        );
                        if (name && name.trim()) {
                          dup.mutate({ id: activeTemplate.id, name: name.trim() });
                        }
                      }}
                      disabled={dup.isPending}
                      className="px-2 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Delete template "${activeTemplate.name}"?`)) {
                          del.mutate(activeTemplate.id);
                        }
                      }}
                      className="px-2 py-1 text-xs font-medium text-rose-700 bg-white border border-rose-200 rounded-md hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {activeId === null ? (
              <div className="p-6 text-sm text-gray-500">Select a template.</div>
            ) : previewLoading ? (
              <div className="p-6 flex items-center gap-2 text-sm text-gray-500">
                <Spinner /> Rendering preview...
              </div>
            ) : preview ? (
              <div>
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Subject
                  </div>
                  <div className="text-sm font-medium text-gray-900 mt-0.5">
                    {preview.subject}
                  </div>
                </div>
                {preview.format === 'plaintext' ? (
                  <pre className="p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono" style={{ maxHeight: 600, overflow: 'auto' }}>
                    {preview.html}
                  </pre>
                ) : (
                  <iframe
                    title="template-preview"
                    srcDoc={preview.html}
                    className="w-full"
                    style={{ height: 600, border: 0 }}
                  />
                )}
              </div>
            ) : (
              <div className="p-6 text-sm text-rose-600">Failed to render preview.</div>
            )}
          </div>
        </div>
      )}

      <TemplateEditorModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(t) => {
          invalidate();
          setSelectedId(t.id);
        }}
      />
      <TemplateEditorModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        template={activeTemplate}
        onSaved={() => invalidate()}
      />
    </div>
  );
}

function TemplateEditorModal({
  open,
  onClose,
  onSaved,
  template,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (t: Template) => void;
  template?: Template | null;
}) {
  const isEdit = !!template;
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [format, setFormat] = useState<TemplateFormat>('html');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setSubject(template.subject_template);
      setFormat(template.format);
      setBody(template.body || '');
    } else {
      setName('');
      setSubject('');
      setFormat('html');
      setBody('');
    }
    setError(null);
  }, [open, template]);

  const fileBackedNoBody = isEdit && !!template?.file_path && !template?.body;

  const mut = useMutation({
    mutationFn: async () => {
      setError(null);
      if (isEdit && template) {
        return updateTemplate(template.id, {
          name: name.trim(),
          subject_template: subject.trim(),
          body,
          format,
        });
      }
      return createTemplate({
        name: name.trim(),
        subject_template: subject.trim(),
        body,
        format,
      });
    },
    onSuccess: (t) => {
      onSaved(t);
      onClose();
    },
    onError: (err: unknown) => {
      let msg = 'Save failed';
      if (err && typeof err === 'object' && 'response' in err) {
        const r = (err as { response?: { data?: { detail?: unknown } } }).response;
        const detail = r?.data?.detail;
        if (typeof detail === 'string') msg = detail;
      }
      setError(msg);
    },
  });

  const valid = name.trim() && subject.trim() && body.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit template' : 'New template'}
      footer={
        <>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => valid && mut.mutate()}
            disabled={!valid || mut.isPending}
            className="px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60"
          >
            {mut.isPending ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {fileBackedNoBody ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2 rounded text-xs">
            This template's body lives on disk ({template?.file_path}). Saving a body here will override the file.
          </div>
        ) : null}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Hi {{ name }}"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">Use <code>{'{{ name }}'}</code>, <code>{'{{ email }}'}</code>, or custom fields.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={format === 'html'}
                onChange={() => setFormat('html')}
              />
              HTML
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={format === 'plaintext'}
                onChange={() => setFormat('plaintext')}
              />
              Plaintext
            </label>
          </div>
          {format === 'plaintext' ? (
            <p className="text-xs text-gray-500 mt-1">
              Plaintext can't render a 1x1 pixel; opens are tracked via a footer "View this email online" link.
            </p>
          ) : null}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            placeholder={
              format === 'plaintext'
                ? 'Hi {{ name }},\n\nThanks for signing up...\n'
                : '<p>Hi {{ name }},</p>\n<p>...</p>'
            }
          />
        </div>
        {error ? <div className="text-xs text-rose-700">{error}</div> : null}
      </div>
    </Modal>
  );
}
