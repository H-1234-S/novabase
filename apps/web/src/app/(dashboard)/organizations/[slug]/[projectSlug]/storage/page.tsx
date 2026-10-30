import {
  retrieveBucketsFromApi,
  retrieveObjectsFromApi,
} from '@/features/storage/storage-helpers.server';
import { StorageClient } from '@/features/storage/storage-client';

export default async function StoragePage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  const buckets = await retrieveBucketsFromApi(slug, projectSlug);
  // 服务端预取第一个桶内 objects 数据
  const initialObjects = buckets[0]
    ? await retrieveObjectsFromApi(slug, projectSlug, buckets[0].id)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <StorageClient
        orgSlug={slug}
        projectSlug={projectSlug}
        initialBuckets={buckets}
        initialObjects={initialObjects}
      />
    </div>
  );
}
