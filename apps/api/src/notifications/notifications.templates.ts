import {
  type Locale,
  NotificationTopic,
  defaultLocale,
  type NotificationTopic as Topic,
} from '@repo/shared';

/**
 * Per-topic renderer. Each builds:
 *   - `title`: shown in-app + as the email Subject + the push payload title
 *   - `body`: plain-text summary for the in-app inbox + push payload body
 *   - `emailHtml` / `emailText`: full email content for the mailer
 *
 * Phase 11.5 — templates take a {@link Locale} so the title/body render
 * in the recipient's language. The dispatch path picks up `User.locale`
 * via the gate's findUnique; the send worker re-reads it from the
 * included user row so a stale `Notification.title` (rendered before
 * the user flipped locale) is re-rendered for the email at send time.
 *
 * Renderers must be defensive against missing fields in `data` —
 * caller-side typing is `Record<string, unknown>` and templates fall
 * back to a placeholder rather than throwing. The notifications worker
 * logs + retries on throw, so a bad template shows up as a stuck
 * delivery in the inbox.
 */
export interface RenderedNotification {
  title: string;
  body: string;
  emailHtml: string;
  emailText: string;
}

export type NotificationData = Record<string, unknown>;

export type NotificationRenderer = (data: NotificationData) => RenderedNotification;

function s(data: NotificationData, key: string, fallback: string): string {
  const v = data[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

function money(
  data: NotificationData,
  amountKey: string,
  currencyKey: string,
  fallback: string,
): string {
  const amount = data[amountKey];
  const currency = data[currencyKey];
  if (typeof amount !== 'number' || typeof currency !== 'string') return fallback;
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

// ---- EN renderers --------------------------------------------------

const enRenderers: Record<Topic, NotificationRenderer> = {
  [NotificationTopic.BILL_ISSUED]: (data) => {
    const amount = money(data, 'amount', 'currency', '(unknown amount)');
    const dueDate = s(data, 'dueDate', '(unknown)');
    const period = s(data, 'period', '(unknown)');
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
    const amount = money(data, 'amount', 'currency', '(unknown amount)');
    const provider = s(data, 'provider', '(unknown)').toLowerCase();
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
    const amount = money(data, 'amount', 'currency', '(unknown amount)');
    const provider = s(data, 'provider', '(unknown)').toLowerCase();
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
    const ticketTitle = s(data, 'ticketTitle', '(unknown)');
    const tenantName = s(data, 'tenantName', '(unknown)');
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
    const ticketTitle = s(data, 'ticketTitle', '(unknown)');
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
    const partnerName = s(data, 'partnerName', '(unknown)');
    const finalAmount = money(data, 'finalAmount', 'currency', '(unknown amount)');
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
    const amount = money(data, 'amount', 'currency', '(unknown amount)');
    const reference = s(data, 'reference', '(unknown)');
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

// ---- VI renderers --------------------------------------------------

const viRenderers: Record<Topic, NotificationRenderer> = {
  [NotificationTopic.BILL_ISSUED]: (data) => {
    const amount = money(data, 'amount', 'currency', '(không xác định)');
    const dueDate = s(data, 'dueDate', '(không xác định)');
    const period = s(data, 'period', '(không xác định)');
    const title = `Tiền thuê kỳ ${period} đến hạn ${dueDate}`;
    const body = `Đã phát hành hóa đơn mới ${amount}. Hạn ${dueDate}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Chủ nhà vừa phát hành hóa đơn mới cho kỳ ${escape(period)}.</p>
         <p><strong>${escape(amount)}</strong> · hạn ${escape(dueDate)}</p>
         <p>Hãy thanh toán từ trang hóa đơn của bạn; chúng tôi sẽ đánh dấu đã thanh toán khi nhà cung cấp xác nhận.</p>`,
      ),
      emailText: `${body}\n\nHãy thanh toán từ trang hóa đơn của bạn; chúng tôi sẽ đánh dấu đã thanh toán khi nhà cung cấp xác nhận.`,
    };
  },

  [NotificationTopic.BILL_PAID]: (data) => {
    const amount = money(data, 'amount', 'currency', '(không xác định)');
    const provider = s(data, 'provider', '(không xác định)').toLowerCase();
    const title = `Đã nhận thanh toán: ${amount}`;
    const body = `Thanh toán ${amount} qua ${provider} của bạn đã hoàn tất.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Thanh toán <strong>${escape(amount)}</strong> qua <strong>${escape(provider)}</strong> của bạn đã hoàn tất.</p>
         <p>Hóa đơn đã được đánh dấu thanh toán. Không cần làm thêm gì.</p>`,
      ),
      emailText: `${body}\n\nHóa đơn đã được đánh dấu thanh toán. Không cần làm thêm gì.`,
    };
  },

  [NotificationTopic.BILL_REFUNDED]: (data) => {
    const amount = money(data, 'amount', 'currency', '(không xác định)');
    const provider = s(data, 'provider', '(không xác định)').toLowerCase();
    const title = `Đã hoàn tiền: ${amount}`;
    const body = `Chủ nhà đã hoàn ${amount} qua ${provider}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Chủ nhà đã hoàn <strong>${escape(amount)}</strong> qua ${escape(provider)}.</p>
         <p>Khoản tiền sẽ vào tài khoản của bạn trong vài ngày làm việc.</p>`,
      ),
      emailText: `${body}\n\nKhoản tiền sẽ vào tài khoản của bạn trong vài ngày làm việc.`,
    };
  },

  [NotificationTopic.TICKET_OPENED]: (data) => {
    const ticketTitle = s(data, 'ticketTitle', '(không xác định)');
    const tenantName = s(data, 'tenantName', '(không xác định)');
    const title = `Yêu cầu mới từ ${tenantName}: ${ticketTitle}`;
    const body = `${tenantName} vừa mở một yêu cầu: ${ticketTitle}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p><strong>${escape(tenantName)}</strong> vừa mở một yêu cầu:</p>
         <p style="background:#f1f5f9;padding:12px;border-radius:6px;font-style:italic;">${escape(ticketTitle)}</p>
         <p>Hãy tiếp nhận từ trang yêu cầu khi bạn đã xem qua.</p>`,
      ),
      emailText: `${body}\n\nHãy tiếp nhận từ trang yêu cầu khi bạn đã xem qua.`,
    };
  },

  [NotificationTopic.TICKET_RESOLVED]: (data) => {
    const ticketTitle = s(data, 'ticketTitle', '(không xác định)');
    const title = `Yêu cầu của bạn đã được giải quyết: ${ticketTitle}`;
    const body = `Yêu cầu "${ticketTitle}" của bạn đã được đánh dấu giải quyết.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Yêu cầu <strong>${escape(ticketTitle)}</strong> của bạn đã được đánh dấu giải quyết.</p>
         <p>Nếu vấn đề chưa thực sự được khắc phục, hãy mở lại yêu cầu từ ứng dụng người thuê.</p>`,
      ),
      emailText: `${body}\n\nNếu vấn đề chưa thực sự được khắc phục, hãy mở lại yêu cầu từ ứng dụng người thuê.`,
    };
  },

  [NotificationTopic.JOB_COMPLETED]: (data) => {
    const partnerName = s(data, 'partnerName', '(không xác định)');
    const finalAmount = money(data, 'finalAmount', 'currency', '(không xác định)');
    const title = `${partnerName} đã hoàn thành công việc của bạn`;
    const body = `${partnerName} đã đánh dấu công việc hoàn thành (số tiền cuối ${finalAmount}).`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p><strong>${escape(partnerName)}</strong> vừa đánh dấu công việc hoàn thành.</p>
         <p>Số tiền cuối: <strong>${escape(finalAmount)}</strong>.</p>
         <p>Hãy đánh giá đối tác từ trang chi tiết công việc để giúp người khác tìm được nhà cung cấp đáng tin.</p>`,
      ),
      emailText: `${body}\n\nHãy đánh giá đối tác từ trang chi tiết công việc.`,
    };
  },

  [NotificationTopic.PAYOUT_DISBURSED]: (data) => {
    const amount = money(data, 'amount', 'currency', '(không xác định)');
    const reference = s(data, 'reference', '(không xác định)');
    const title = `Đã chuyển khoản thanh toán: ${amount}`;
    const body = `Khoản thanh toán ${amount} của bạn vừa rời khỏi nền tảng. Mã tham chiếu ${reference}.`;
    return {
      title,
      body,
      emailHtml: shell(
        title,
        `<p>Khoản thanh toán <strong>${escape(amount)}</strong> của bạn vừa rời khỏi nền tảng.</p>
         <p>Mã tham chiếu: <code>${escape(reference)}</code></p>
         <p>Hãy đối chiếu với sao kê ngân hàng; liên hệ với chúng tôi nếu sau vài ngày làm việc tiền chưa về.</p>`,
      ),
      emailText: `${body}\n\nHãy đối chiếu mã tham chiếu với sao kê ngân hàng.`,
    };
  },
};

const renderersByLocale: Record<Locale, Record<Topic, NotificationRenderer>> = {
  en: enRenderers,
  vi: viRenderers,
};

/**
 * Render a notification topic in the recipient's locale.
 *
 * `locale` defaults to {@link defaultLocale} (Phase 11.1 — `'vi'`) so
 * a caller that forgets to pass one still produces a coherent body
 * instead of crashing.
 */
export function renderNotification(
  topic: Topic,
  data: NotificationData,
  locale: Locale = defaultLocale,
): RenderedNotification {
  const table = renderersByLocale[locale] ?? renderersByLocale[defaultLocale];
  const renderer = table[topic];
  return renderer(data);
}
