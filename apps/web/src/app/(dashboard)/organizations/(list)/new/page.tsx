import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { CreateOrgForm } from '@/features/organization/create-org-form';

export default function NewOrganizationPage() {
  return (
    <div>
      <Link
        href="/organizations"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back to organizations
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-medium">New organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organizations group projects and team members.
        </p>
      </div>

      <CreateOrgForm />
    </div>
  );
}
