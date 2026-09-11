import { Megaphone } from "lucide-react";

import { getLocale, getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyAnnouncements } from "@/services/announcement.service";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
  const session = await getSession();
  const [announcements, locale, t] = await Promise.all([
    listMyAnnouncements(session),
    getLocale(),
    getTranslations("announcements"),
  ]);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-semibold">
          <Megaphone className="h-7 w-7 text-primary" />
          {t("title")}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      {announcements.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <Card key={a.id}>
              <CardContent className="space-y-1 pt-6">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      a.kind === "system"
                        ? "inline-flex shrink-0 items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                        : "inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                    }
                  >
                    {a.kind === "system" ? t("system") : a.source}
                  </span>
                  <h2 className="truncate text-base font-medium">{a.title}</h2>
                  <time
                    dateTime={a.publishedAt.toISOString()}
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                  >
                    {dateFormat.format(a.publishedAt)}
                  </time>
                </div>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
