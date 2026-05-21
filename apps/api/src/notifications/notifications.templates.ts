import { NotificationTopic, type NotificationTopic as Topic } from '@repo/shared';

/**
 * Per-topic renderer. Each builds:
 *   - `title`: shown in-app + as the email Subject
 *   - `body`: plain-text summary for the in-app inbox
 *   - `emailHtml` / `emailText`: full email content for the mailer
 *
 * Renderers must be defensive against missing fields in `data` —
 * caller-side typing is `Record<string, unknown>` and templates fall
 * back to `(unknown)` placeholders rather than throwing. The
 * notifications worker logs + retries on throw, so a bad template
 * shows up as a stuck delivery in the inbox.
 */
export interface RenderedNotification {
  title: string;
  body: string;
  emailHtml: string;
  emailText: string;
}

export type NotificationData = Record<string, unknown>;

export type NotificationRenderer = (data: NotificationData) => RenderedNotification;

function s(data: NotificationData, key: string): string {
  const v = data[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '(unknown)';
}

function money(data: NotificationData, amountKey: string, currencyKey: string): string {
  const amount = data[amountKey];
  const currency = data[currencyKey];
  if (typeof amount !== 'number' || typeof currency !== 'string') return '(unknown amount)';
  // Minor units; we render as-is with the currency suffix. The UI
  // formats; emails stay simple to render across clients.
  return `${amount.toLocaleString('en-US')} ${currency}`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;font-size:14px;line-height:1.5;color:#0f172a;">
    <h1 style="font-size:18px;margin:0 0 12px;">${escape(title)}</h1>
    ${body}
    <p style="font-size:12px;color:#64748b;margin:24px 0 0;">— bdsmonorepo</p>
  </div>
</body></html>`;
}

const renderers: Record<Topic, NotificationRenderer> = {
  [NotificationTopic.BILL_ISSUED]: (data) => {
    const amount = money(data, 'amount', 'currency');
    const dueDate = s(data, 'dueDate');
    const period = s(data, 'period');
    const title = `Your rent for ${period} is due ${dueDate}`;
    const body = `A new bill for ${amount} has been issued. Due ${dueDate}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Your landlord just issued a new bill for ${escape(period)}.</p>
         <p><strong>${escape(amount)}</strong> · due ${escape(dueDate)}</p>
         <p>Pay it from your bills page; we&apos;ll mark it paid once the provider confirms.</p>`,
      ),
      emailText: `${body}\n\nPay it from your bills page; we'll mark it paid once the provider confirms.`,
    };
  },

  [NotificationTopic.BILL_PAID]: (data) => {
    const amount = money(data, 'amount', 'currency');
    const provider = s(data, 'provider').toLowerCase();
    const title = `Payment received: ${amount}`;
    const body = `Your ${provider} payment of ${amount} cleared.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Your <strong>${escape(provider)}</strong> payment of <strong>${escape(amount)}</strong> cleared.</p>
         <p>The bill is now marked paid. No action needed.</p>`,
      ),
      emailText: `${body}\n\nThe bill is now marked paid. No action needed.`,
    };
  },

  [NotificationTopic.BILL_REFUNDED]: (data) => {
    const amount = money(data, 'amount', 'currency');
    const provider = s(data, 'provider').toLowerCase();
    const title = `Refund issued: ${amount}`;
    const body = `Your landlord refunded ${amount} via ${provider}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Your landlord refunded <strong>${escape(amount)}</strong> via ${escape(provider)}.</p>
         <p>It should appear in your account within a few business days.</p>`,
      ),
      emailText: `${body}\n\nIt should appear in your account within a few business days.`,
    };
  },

  [NotificationTopic.TICKET_OPENED]: (data) => {
    const ticketTitle = s(data, 'ticketTitle');
    const tenantName = s(data, 'tenantName');
    const title = `New ticket from ${tenantName}: ${ticketTitle}`;
    const body = `${tenantName} just opened a ticket: ${ticketTitle}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p><strong>${escape(tenantName)}</strong> just opened a ticket:</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-style:italic;">${escape(ticketTitle)}</p>
         <p>Acknowledge it from your tickets page when you&apos;ve got eyes on it.</p>`,
      ),
      emailText: `${body}\n\nAcknowledge it from your tickets page when you've got eyes on it.`,
    };
  },

  [NotificationTopic.TICKET_RESOLVED]: (data) => {
    const ticketTitle = s(data, 'ticketTitle');
    const title = `Your ticket has been resolved: ${ticketTitle}`;
    const body = `Your ticket "${ticketTitle}" is marked resolved.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Your ticket <strong>${escape(ticketTitle)}</strong> has been marked resolved.</p>
         <p>If the issue isn&apos;t actually fixed, reopen the ticket from your tenant app.</p>`,
      ),
      emailText: `${body}\n\nIf the issue isn't actually fixed, reopen the ticket from your tenant app.`,
    };
  },

  [NotificationTopic.JOB_COMPLETED]: (data) => {
    const partnerName = s(data, 'partnerName');
    const finalAmount = money(data, 'finalAmount', 'currency');
    const title = `${partnerName} completed your job`;
    const body = `${partnerName} marked the job complete (final amount ${finalAmount}).`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p><strong>${escape(partnerName)}</strong> just marked the job complete.</p>
         <p>Final amount: <strong>${escape(finalAmount)}</strong>.</p>
         <p>Rate the partner from the job detail page so others find proven providers.</p>`,
      ),
      emailText: `${body}\n\nRate the partner from the job detail page.`,
    };
  },

  [NotificationTopic.PAYOUT_DISBURSED]: (data) => {
    const amount = money(data, 'amount', 'currency');
    const reference = s(data, 'reference');
    const title = `Payout sent: ${amount}`;
    const body = `Your payout of ${amount} just left the platform. Reference ${reference}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Your payout of <strong>${escape(amount)}</strong> just left the platform.</p>
         <p>Reference: <code>${escape(reference)}</code></p>
         <p>Match it against your bank statement; reach out if it doesn&apos;t land within a couple of business days.</p>`,
      ),
      emailText: `${body}\n\nMatch the reference against your bank statement.`,
    };
  },
};

export function renderNotification(topic: Topic, data: NotificationData): RenderedNotification {
  const renderer = renderers[topic];
  return renderer(data);
}
