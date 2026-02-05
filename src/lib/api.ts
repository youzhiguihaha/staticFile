export interface Item { id: string; name: string; type: string; size: number; t: number; }

export const api = {
  get token() { return localStorage.getItem('token'); },
  async req(url: string, opts: any = {}) {
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${this.token}`, ...opts.headers } });
    if (res.status === 401) { localStorage.removeItem('token'); window.location.reload(); }
    if (!res.ok) throw new Error('请求失败');
    return res.json();
  },
  async login(password: string) {
    const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    if (!res.ok) return false;
    const { token } = await res.json();
    localStorage.setItem('token', token);
    return true;
  },
  async list(fid: string) { return this.req(`/api/list?fid=${fid}&t=${Date.now()}`); },
  async mkdir(parentId: string, name: string) { return this.req('/api/mkdir', { method: 'POST', body: JSON.stringify({ parentId, name }) }); },
  async upload(files: File[], folderId: string) {
    const fd = new FormData();
    fd.append('folderId', folderId);
    files.forEach(f => fd.append('file', f));
    await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${this.token}` }, body: fd });
  },
  url(id: string) { return `/file/${id}`; }
};