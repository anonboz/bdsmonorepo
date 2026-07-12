import { Building2, Users } from "lucide-react";
import Link from "next/link";

import { getSession, requireAdmin } from "@/lib/session";
import { listOrganizations, listUsers } from "@/services/admin.service";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const session = await getSession();
  requireAdmin(session);

  const [{ total: orgTotal }, { total: userTotal }] = await Promise.all([
    listOrganizations(session, { take: 1 }),
    listUsers(session, { take: 1 }),
  ]);

  const tiles = [
    { title: "Organizations", value: orgTotal, hint: "across the whole platform" },
    { title: "Users", value: userTotal, hint: "every account, all orgs" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Platform overview</h1>
        <p className="text-muted-foreground">
          Global console — {session.name || "admin"}. Metrics span every organization.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-primary" />
              Organizations
            </CardTitle>
            <CardDescription>Browse every org registered on the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className={buttonVariants()}>
              View organizations
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Users
            </CardTitle>
            <CardDescription>Search and inspect user accounts across orgs.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/users" className={buttonVariants()}>
              View users
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
