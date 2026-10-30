import { TopNav } from '@/components/top-nav';
import { retrieveProjectsFromApi } from '@/features/projects/project-helpers.server';

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const projects = await retrieveProjectsFromApi(slug);

  return (
    <>
      <TopNav projects={projects} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </>
  );
}
