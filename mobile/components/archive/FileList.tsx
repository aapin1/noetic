import React from 'react';
import { useRouter } from 'expo-router';
import { FileRow } from '@/components/archive/FileRow';
import type { CaptureSummary } from '@/types/api';

export function FileList({ entries }: { entries: CaptureSummary[] }) {
  const router = useRouter();

  return (
    <>
      {entries.map((item) => (
        <FileRow key={item.id} item={item} onPress={() => router.push(`/insight/${item.id}` as never)} />
      ))}
    </>
  );
}
