import axios from 'axios';
import type {
  Campaign,
  CampaignDetail,
  CampaignStats,
  CampaignStep,
  Contact,
  ContactTimeline,
  DashboardStats,
  EmailStatus,
  PaginatedContacts,
  RecipientStage,
  Stage,
  Template,
  TemplatePreview,
} from './types';

// Empty baseURL = same-origin relative paths. In dev, Vite's /api + /t
// proxy forwards to localhost:8000. In prod, the SPA and API are served
// from the same host so relative paths just work.
const baseURL = import.meta.env.VITE_API_BASE || '';

export const http = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

// Health
export const getHealth = () => http.get('/api/health').then((r) => r.data);

// Dashboard
export const getDashboard = () =>
  http.get<DashboardStats>('/api/stats/dashboard').then((r) => r.data);

// Contacts
export interface ContactListParams {
  stage?: Stage | '';
  search?: string;
  source?: string | '';
  page?: number;
  limit?: number;
  not_enrolled_in?: number;
}

export const listContacts = (params: ContactListParams) =>
  http
    .get<PaginatedContacts>('/api/contacts', {
      params: {
        stage: params.stage || undefined,
        search: params.search || undefined,
        source: params.source || undefined,
        not_enrolled_in: params.not_enrolled_in || undefined,
        page: params.page || 1,
        limit: params.limit || undefined,
      },
    })
    .then((r) => r.data);

export const listSources = () =>
  http.get<string[]>('/api/contacts/sources').then((r) => r.data);

export const createContact = (body: {
  email: string;
  name?: string;
  custom_fields?: Record<string, unknown>;
}) => http.post<Contact>('/api/contacts', body).then((r) => r.data);

export const getContact = (id: number) =>
  http.get<Contact>(`/api/contacts/${id}`).then((r) => r.data);

export const patchContact = (
  id: number,
  body: {
    stage?: Stage;
    registered_at?: string | null;
    unsubscribed?: boolean;
    name?: string;
    source?: string;
  },
) => http.patch<Contact>(`/api/contacts/${id}`, body).then((r) => r.data);

export const getContactTimeline = (id: number) =>
  http.get<ContactTimeline>(`/api/contacts/${id}/timeline`).then((r) => r.data);

export const deleteContact = (id: number) =>
  http.delete(`/api/contacts/${id}`).then((r) => r.data);

// Templates
export const listTemplates = () =>
  http.get<Template[]>('/api/templates').then((r) => r.data);

export const createTemplate = (body: {
  name: string;
  subject_template: string;
  body?: string;
  format?: 'html' | 'plaintext';
  file_path?: string;
}) => http.post<Template>('/api/templates', body).then((r) => r.data);

export const updateTemplate = (
  id: number,
  body: {
    name?: string;
    subject_template?: string;
    body?: string;
    format?: 'html' | 'plaintext';
  },
) => http.patch<Template>(`/api/templates/${id}`, body).then((r) => r.data);

export const deleteTemplate = (id: number) =>
  http.delete(`/api/templates/${id}`).then((r) => r.data);

export const duplicateTemplate = (id: number, body: { name?: string }) =>
  http
    .post<Template>(`/api/templates/${id}/duplicate`, body)
    .then((r) => r.data);

export const previewTemplate = (id: number, contact_id?: number) =>
  http
    .get<TemplatePreview>(`/api/templates/${id}/preview`, {
      params: { contact_id },
    })
    .then((r) => r.data);

// Campaigns
export const listCampaigns = () =>
  http.get<Campaign[]>('/api/campaigns').then((r) => r.data);

export const createCampaign = (body: { name: string; thread_emails?: boolean }) =>
  http.post<Campaign>('/api/campaigns', body).then((r) => r.data);

export const getCampaign = (id: number) =>
  http.get<CampaignDetail>(`/api/campaigns/${id}`).then((r) => r.data);

export const patchCampaign = (
  id: number,
  body: { status?: string; name?: string; thread_emails?: boolean },
) => http.patch<Campaign>(`/api/campaigns/${id}`, body).then((r) => r.data);

export const putCampaignSteps = (id: number, steps: CampaignStep[]) =>
  http
    .put<CampaignDetail>(`/api/campaigns/${id}/steps`, { steps })
    .then((r) => r.data);

export const enrollCampaign = (
  id: number,
  body: {
    contact_ids?: number[];
    filter?: { stage?: Stage; source?: string };
  },
) => http.post(`/api/campaigns/${id}/enroll`, body).then((r) => r.data);

export const removeEnrollment = (campaignId: number, enrollmentId: number) =>
  http
    .delete<{ ok: boolean; deleted_sends: number }>(
      `/api/campaigns/${campaignId}/enrollments/${enrollmentId}`,
    )
    .then((r) => r.data);

export const duplicateCampaign = (
  id: number,
  body: { name?: string; copy_recipients?: boolean },
) =>
  http
    .post<CampaignDetail>(`/api/campaigns/${id}/duplicate`, body)
    .then((r) => r.data);

export const pauseCampaign = (id: number) =>
  http.post(`/api/campaigns/${id}/pause`).then((r) => r.data);

export const resumeCampaign = (id: number) =>
  http.post(`/api/campaigns/${id}/resume`).then((r) => r.data);

export const getCampaignStats = (id: number) =>
  http.get<CampaignStats>(`/api/campaigns/${id}/stats`).then((r) => r.data);

export interface UpcomingSend {
  send_id: number;
  send_at: string;
  step_order: number;
  template_name: string;
  contact_id: number;
  contact_email: string;
  contact_name: string | null;
}

export const getCampaignUpcoming = (id: number, limit = 20) =>
  http
    .get<UpcomingSend[]>(`/api/campaigns/${id}/upcoming`, { params: { limit } })
    .then((r) => r.data);

export interface Recipient {
  enrollment_id: number;
  contact_id: number;
  contact_email: string;
  contact_name: string | null;
  stage: RecipientStage;
  status: string;
  enrolled_at: string;
  sent_count: number;
  opens_unique: number;
  replies_unique: number;
  clicks_count: number;
  next_send_at: string | null;
  unsubscribed: boolean;
}

export const listRecipients = (
  campaignId: number,
  params: { stage?: RecipientStage | ''; clicked?: boolean } = {},
) =>
  http
    .get<Recipient[]>(`/api/campaigns/${campaignId}/recipients`, {
      params: {
        stage: params.stage || undefined,
        clicked: params.clicked === undefined ? undefined : params.clicked,
      },
    })
    .then((r) => r.data);

export interface RecipientTimelineEvent {
  id: number;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

export interface RecipientSend {
  send_id: number;
  step_order: number | null;
  template_name: string | null;
  status: string;
  send_at: string;
  sent_at: string | null;
  error: string | null;
  events: RecipientTimelineEvent[];
}

export interface RecipientTimeline {
  enrollment: {
    id: number;
    campaign_id: number;
    contact_id: number;
    contact_email: string;
    contact_name: string | null;
    stage: string;
    status: string;
    enrolled_at: string;
    stopped_reason: string | null;
  };
  sends: RecipientSend[];
  stage_events: { id: number; created_at: string; data: Record<string, unknown> }[];
}

export const getRecipientTimeline = (campaignId: number, enrollmentId: number) =>
  http
    .get<RecipientTimeline>(
      `/api/campaigns/${campaignId}/recipients/${enrollmentId}/timeline`,
    )
    .then((r) => r.data);

export const sendNow = (campaignId: number, sendId: number) =>
  http
    .post<{
      send_id: number;
      status: string;
      sent_at: string | null;
      error: string | null;
    }>(`/api/campaigns/${campaignId}/sends/${sendId}/send-now`)
    .then((r) => r.data);

export const sendAll = (campaignId: number) =>
  http
    .post<{ queued: number }>(`/api/campaigns/${campaignId}/sends/send-all`)
    .then((r) => r.data);

// Auth
export const getEmailStatus = () =>
  http.get<EmailStatus>('/api/auth/email/status').then((r) => r.data);

export const testEmailConnection = () =>
  http.post<EmailStatus>('/api/auth/email/test').then((r) => r.data);

export const sendTestEmail = (to: string) =>
  http
    .post<{ sent: boolean; to: string; message_id: string }>(
      '/api/auth/email/send-test',
      { to },
    )
    .then((r) => r.data);

// Settings
export const getSettings = () =>
  http.get<Record<string, unknown>>('/api/settings').then((r) => r.data);

export const putSettings = (body: Record<string, unknown>) =>
  http.put<Record<string, unknown>>('/api/settings', body).then((r) => r.data);
