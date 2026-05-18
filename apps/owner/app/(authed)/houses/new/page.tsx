import Link from 'next/link';

import { Button } from '@repo/ui';

import { HouseForm } from '../_components/house-form';

export const metadata = { title: 'New house' };

export default function NewHousePage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/houses">← Back to houses</Link>
        </Button>
        <h1 className="text-2xl font-semibold">New house</h1>
      </div>
      <HouseForm />
    </main>
  );
}
