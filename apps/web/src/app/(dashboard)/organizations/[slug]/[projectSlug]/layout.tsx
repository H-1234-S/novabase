import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { retrieveMyOrganizationsFromApi } from '@/features/organization/organization-helpers.server';
import { retrieveTokenFromCookie } from '@/server-utils/utils';

async function getCurrentUser() {
  const token = await retrieveTokenFromCookie();
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString(),
  );

  return { email: payload.email as string, name: null };
}

export default async function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [orgs, user] = await Promise.all([
    retrieveMyOrganizationsFromApi(),
    getCurrentUser(),
  ]);

  return (
    <SidebarProvider className="min-h-0 flex-1">
      <AppSidebar orgs={orgs} user={user} />
      <SidebarInset className="min-h-0 flex-1 overflow-hidden">
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
