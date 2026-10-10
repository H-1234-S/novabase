import { ProjectAuthShell } from '@/features/project-auth/components/project-auth-shell';

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;

  return (
    <div className="-mx-6 -mt-6 -mb-6 flex h-[calc(100svh-3rem)] min-h-0 flex-col overflow-hidden">
      <ProjectAuthShell orgSlug={slug} projectSlug={projectSlug}>
        {children}
      </ProjectAuthShell>
    </div>
  );
}
