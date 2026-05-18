'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>You are offline</CardTitle>
          <CardDescription>
            We could not reach the network. Some cached pages may still be available; otherwise
            check your connection and try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
