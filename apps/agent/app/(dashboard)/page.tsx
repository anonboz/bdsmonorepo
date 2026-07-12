import { ClipboardList } from "lucide-react";
import Link from "next/link";

import { getSession } from "@/lib/session";
import { listApplications } from "@/services/application.service";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const session = await getSession();
  const { total } = await listApplications(session, { take: 1 });

  const tiles = [
    { title: "Applications", value: total, hint: "in this organization" },
    { title: "Approval rate", value: "—", hint: "wire up in M3" },
    { title: "Screening (30d)", value: "—", hint: "wire up in M3" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Welcome back, {session.name || "agent"}</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening in your pipeline.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.title}>
            <CardHeader className="pb-2">
              <CardDescription>{t.title}</CardDescription>
              <CardTitle className="text-3xl">{t.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{t.hint}</CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ClipboardList className="h-5 w-5 text-primary" />
            Applications
          </CardTitle>
          <CardDescription>
            Review and process rental applications for your listings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/applications" className={buttonVariants()}>
            Open applications
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
