import { apiRequest } from '../../shared/api/apiClient.js';
export const sshApi = {
  status: () => apiRequest('/api/ssh/status'),
  configure: payload => apiRequest('/api/ssh/server', { method: 'PATCH', body: payload }),
  credential: () => apiRequest('/api/ssh/credentials', { method: 'POST' }),
  revoke: () => apiRequest('/api/ssh/credentials', { method: 'DELETE' }),
  probe: payload => apiRequest('/api/ssh/remote/probe', { method: 'POST', body: payload }),
  connect: payload => apiRequest('/api/ssh/remote/connections', { method: 'POST', body: payload }),
  list: () => apiRequest('/api/ssh/remote'),
  files: (id, path) => apiRequest(`/api/ssh/remote/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`),
  disconnect: id => apiRequest(`/api/ssh/remote/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  transfer: payload => apiRequest('/api/ssh/remote/transfers', { method: 'POST', body: payload }),
  cancel: id => apiRequest(`/api/ssh/remote/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' })
};
