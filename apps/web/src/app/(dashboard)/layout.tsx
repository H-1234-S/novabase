import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { TopNav } from '@/components/top-nav';
import { retrieveTokenFromCookie } from '@/server-utils/utils';
import { retrieveMyOrganizationsFromApi } from '@/features/organization/organization-helpers.server';

async function getCurrentUser() {
  const token = await retrieveTokenFromCookie();

  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString(),
  );

  return { email: payload.email as string, name: null };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [orgs, user] = await Promise.all([
    retrieveMyOrganizationsFromApi(),
    getCurrentUser(),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar orgs={orgs} user={user} />
      <SidebarInset>
        <TopNav />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
