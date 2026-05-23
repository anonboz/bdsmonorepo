import { DeleteAccountCard } from './_components/delete-account-card';

export const metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">Manage your account settings.</p>
      </header>
      <DeleteAccountCard />
    </main>
  );
}
