import { useSyncExternalStore } from 'react';
import { UploadQueue } from './UploadQueue.jsx';
import { subscribeDownloads, getDownloads, clearDownloads, cancelDownload } from '../downloadTransfers.js';

export function DownloadQueue() {
  const downloads = useSyncExternalStore(subscribeDownloads, getDownloads);
  return <UploadQueue uploads={downloads} direction="download" onCancel={cancelDownload}
    onCancelAll={() => downloads.forEach(item => cancelDownload(item.id))} onClearCompleted={clearDownloads} />;
}
