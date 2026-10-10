import { redirect } from 'next/navigation';
import { retrieveMyOrganizationsFromApi } from '@/features/organization/organization-helpers.server';

export default async function SettingsPage() {
  const orgs = await retrieveMyOrganizationsFromApi();

  if (orgs.length === 0) {
    redirect('/organizations/new');
  }

  redirect(`/organizations/${orgs[0].slug}/settings/members`);
}
