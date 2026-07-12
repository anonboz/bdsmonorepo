import { FileText, Receipt, Wrench } from "lucide-react";
import Link from "next/link";

import { getSession } from "@/lib/session";
import { listMyLeases } from "@/services/lease.service";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function TenantHome() {
  const session = await getSession();
  const { total } = await listMyLeases(session);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Welcome, {session.name || "tenant"}</h1>
        <p className="text-muted-foreground">Everything about your rental in one place.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            My leases
          </CardTitle>
          <CardDescription>
            You are on {total} lease{total === 1 ? "" : "s"}. Review terms, rent and status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/my-leases" className={buttonVariants()}>
            View my leases
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Receipt className="h-5 w-5 text-primary" />
              My bills
            </CardTitle>
            <CardDescription>Track rent invoices and payment history.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/my-bills" className={buttonVariants({ variant: "outline" })}>
              View my bills
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5 text-primary" />
              Requests
            </CardTitle>
            <CardDescription>Raise and follow up on maintenance requests.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/my-tickets" className={buttonVariants({ variant: "outline" })}>
              View requests
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
