export type Stage =
  | 'new'
  | 'contacted'
  | 'opened'
  | 'replied'
  | 'interested'
  | 'registered'
  | 'lost';

export const STAGES: Stage[] = [
  'new',
  'contacted',
  'opened',
  'replied',
  'interested',
  'registered',
  'lost',
];

export type RecipientStage = 'pending' | 'sent' | 'opened' | 'replied';

export const RECIPIENT_STAGES: RecipientStage[] = [
  'pending',
  'sent',
  'opened',
  'replied',
];

export interface Contact {
  id: number;
  email: string;
  name: string | null;
  stage: Stage;
  source: string | null;
  custom_fields: Record<string, unknown> | null;
  registered_at: string | null;
  unsubscribed: boolean;
  created_at: string;
  updated_at?: string | null;
}

export type TemplateFormat = 'html' | 'plaintext';

export interface Template {
  id: number;
  name: string;
  file_path: string;
  subject_template: string;
  body?: string | null;
  format: TemplateFormat;
  created_at?: string;
}

export interface CampaignStep {
  id?: number;
  order: number;
  template_id: number;
  day_offset: number;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface CampaignSummary {
  sent?: number;
  recipients?: number;
  open_rate?: number;
  click_rate?: number;
  reply_rate?: number;
  registered_rate?: number;
}

export interface Campaign {
  id: number;
  name: string;
  status: CampaignStatus;
  thread_emails?: boolean;
  created_at?: string;
  summary?: CampaignSummary;
}

export interface CampaignDetail extends Campaign {
  steps: CampaignStep[];
}

export interface CampaignStepStats {
  order: number;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
}

export interface CampaignStats {
  sent: number;
  recipients: number;
  opens: number;
  unique_opens: number;
  clicks: number;
  unique_clicks: number;
  replies: number;
  unique_replies: number;
  enrolled: number;
  registered: number;
  unsubscribed: number;
  rates: {
    open: number;
    click: number;
    reply: number;
    registered: number;
    unsubscribed: number;
  };
  by_step: CampaignStepStats[];
}

export interface DashboardStats {
  stage_counts: Record<Stage, number>;
  sends_today: number;
  opens_7d: number;
  clicks_7d: number;
  replies_7d: number;
  upcoming_queue_count: number;
}

export type EventType =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'
  | 'stage_change';

export interface TimelineEvent {
  id: number;
  contact_id: number;
  campaign_id?: number | null;
  step_order?: number | null;
  type: EventType;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

export interface Enrollment {
  id: number;
  campaign_id: number;
  campaign_name?: string;
  contact_id: number;
  status: string;
  current_step?: number;
  enrolled_at: string;
}

export interface ContactTimeline {
  events: TimelineEvent[];
  enrollments: Enrollment[];
}

export interface PaginatedContacts {
  items: Contact[];
  total: number;
}

export interface TemplatePreview {
  subject: string;
  html: string;
  format: TemplateFormat;
}

export type EmailStatus = {
  smtp_ok: boolean;
  imap_ok: boolean;
  error: string | null;
  sender_email: string;
};

export interface Settings {
  // Credentials
  smtp_host?: string;
  smtp_port?: number | string;
  smtp_username?: string;
  smtp_password?: string;
  smtp_use_tls?: boolean;
  imap_host?: string;
  imap_port?: number | string;
  imap_username?: string;
  imap_password?: string;
  sender_email?: string;
  sender_name?: string;
  smtp_password_set?: boolean;
  imap_password_set?: boolean;
  // App settings
  base_url?: string;
  daily_send_cap?: number | string;
  unsubscribe_keyword?: string;
  [key: string]: unknown;
}
