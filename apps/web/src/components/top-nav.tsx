'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, Settings } from 'lucide-react';
import type { Project } from '@novabase/types';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const sectionLabels: Record<string, string> = {
  projects: 'Projects',
  database: 'Database',
  sql: 'SQL Editor',
  auth: 'Authentication',
  providers: 'Providers',
  users: 'Users',
  'url-configuration': 'URL Configuration',
  storage: 'Storage',
  api: 'API',
  realtime: 'Realtime',
  settings: 'Settings',
  members: 'Members',
};

interface TopNavProps {
  projects: Project[];
}

export function TopNav({ projects }: TopNavProps) {
  const pathname = usePathname();
  const params = useParams<{ slug: string; projectSlug?: string }>();
  const currentProject = projects.find(
    (project) => project.slug === params.projectSlug,
  );
  const section = pathname.split('/').filter(Boolean).at(-1) ?? 'projects';
  const sectionLabel = sectionLabels[section] ?? section;
  const organizationHref = `/organizations/${params.slug}/projects`;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/organizations">Organizations</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {params.projectSlug || section === 'projects' ? (
              <BreadcrumbLink asChild>
                <Link href={organizationHref}>{params.slug}</Link>
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage>{params.slug}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {params.projectSlug && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2 font-normal">
                      {currentProject?.name ?? params.projectSlug}
                      <ChevronsUpDown className="text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {projects.map((project) => (
                      <DropdownMenuItem key={project.id} asChild>
                        <Link
                          href={`/organizations/${params.slug}/${project.slug}/database`}
                          className="flex items-center justify-between"
                        >
                          {project.name}
                          {project.slug === params.projectSlug && <Check />}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                    {projects.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem asChild>
                      <Link href={organizationHref}>All projects</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </BreadcrumbItem>
            </>
          )}
          {section !== 'projects' && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{sectionLabel}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <Button asChild variant="outline" size="sm">
        <Link href={`/organizations/${params.slug}/settings/members`}>
          <Settings />
          Organization settings
        </Link>
      </Button>
    </header>
  );
}
