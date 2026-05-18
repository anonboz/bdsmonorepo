import Link from 'next/link';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { APP_NAME, APP_ROLE } from '../../lib/app-config.js';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            You're signed in, but this account doesn't have the {APP_ROLE} role required to use{' '}
            {APP_NAME}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Sign in with a different account</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
