import { api } from './client';
import type { QueueStats } from './types';

export const processingApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('pdf', file);
    return api.upload<{ claimId: string; claimReference: string; status: string; message: string }>('/process/upload', formData);
  },
  queueStats: () => api.get<QueueStats>('/process/queue'),
  pipelineStatus: (id: string) => api.get<Record<string, unknown>>(`/process/pipeline/${id}`),
};
