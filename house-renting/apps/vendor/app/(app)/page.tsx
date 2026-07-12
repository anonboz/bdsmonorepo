import { Wrench } from "lucide-react";
import Link from "next/link";

import { getSession } from "@/lib/session";
import { listWorkOrders } from "@/services/work-order.service";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function VendorHome() {
  const session = await getSession();
  const { total } = await listWorkOrders(session, { take: 1 });

  const tiles = [
    { title: "Open work orders", value: total, hint: "assigned to this organization" },
    { title: "Scheduled today", value: "—", hint: "wire up later" },
    { title: "Completed (30d)", value: "—", hint: "wire up later" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Welcome back, {session.name || "vendor"}</h1>
        <p className="text-muted-foreground">Here&apos;s what needs your attention today.</p>
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
            <Wrench className="h-5 w-5 text-primary" />
            Work orders
          </CardTitle>
          <CardDescription>Review and act on maintenance jobs assigned to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/work-orders" className={buttonVariants()}>
            Open work orders
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
