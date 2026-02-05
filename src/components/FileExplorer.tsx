import { useState, useEffect } from 'react';
import { api, Item } from '../lib/api';
import { 
  Folder, FileText, Image as ImgIcon, Music, Video, ArrowLeft, 
  UploadCloud, Plus, Grid, List as ListIcon, Search, LogOut
} from 'lucide-react';
import toast from 'react-hot-toast';

const Icon = ({ type, className }: { type: string, className?: string }) => {
  if (type === 'folder') return <Folder className={`text-blue-500 fill-blue-50 ${className}`} />;
  if (type.startsWith('image')) return <ImgIcon className={`text-purple-500 ${className}`} />;
  if (type.startsWith('video')) return <Video className={`text-red-500 ${className}`} />;
  return <FileText className={`text-slate-400 ${className}`} />;
};

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function FileExplorer() {
  const [path, setPath] = useState<Item[]>([{ id: 'root', name: '我的云盘', type: 'folder', size: 0, t: 0 }]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  
  const curr = path[path.length - 1];

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.list(curr.id);
      const dirs = Object.entries(d.folders || {}).map(([k, v]) => ({ id: v, name: k, type: 'folder', t: d.updatedAt }));
      const files = Object.entries(d.files || {}).map(([k, v]: any) => ({ ...v, name: k }));
      setItems([...dirs, ...files]);
    } catch { toast.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [curr]);

  const handleUpload = async (e: any) => {
    if (!e.target.files.length) return;
    const t = toast.loading('上传中...');
    await api.upload(Array.from(e.target.files), curr.id);
    toast.dismiss(t);
    toast.success('上传完成');
    load();
  };

  const handleMkdir = async () => {
    const n = prompt('文件夹名称');
    if (n) { await api.mkdir(curr.id, n); load(); }
  };

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">C</div>
          <span className="text-xl font-bold">CloudDrive</span>
        </div>
        <label className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-200 transition-all mb-6">
          <UploadCloud className="w-5 h-5" />
          <span>上传文件</span>
          <input type="file" multiple className="hidden" onChange={handleUpload} />
        </label>
        <div className="flex-1">
          <div className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg flex items-center gap-3 font-medium">
            <Folder className="w-5 h-5" /> 全部文件
          </div>
        </div>
        <div className="pt-6 border-t text-xs text-slate-400">
          <p>已使用 KV 存储</p>
          <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div className="h-full bg-blue-500 w-1/4"></div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <div className="flex items-center gap-2">
            {path.length > 1 && (
              <button onClick={() => setPath(path.slice(0, -1))} className="p-2 hover:bg-slate-100 rounded-full">
                <ArrowLeft className="w-5 h-5 text-slate-500" />
              </button>
            )}
            <div className="flex items-center text-sm font-medium text-slate-600">
              {path.map((p, i) => (
                <div key={p.id} className="flex items-center">
                  {i > 0 && <span className="mx-2 text-slate-300">/</span>}
                  <button onClick={() => setPath(path.slice(0, i + 1))} className="hover:text-blue-600 truncate max-w-[150px]">
                    {p.name}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索..." className="pl-9 pr-4 py-2 bg-slate-100 rounded-full text-sm outline-none focus:ring-2 focus:ring-blue-200 w-48" />
            </div>
            <div className="h-6 w-px bg-slate-200 mx-1" />
            <button onClick={() => setView('grid')} className={`p-2 rounded-lg ${view === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}><Grid className="w-5 h-5" /></button>
            <button onClick={() => setView('list')} className={`p-2 rounded-lg ${view === 'list' ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}><ListIcon className="w-5 h-5" /></button>
            <button onClick={handleMkdir} className="p-2 bg-slate-100 rounded-lg text-slate-600 hover:bg-slate-200"><Plus className="w-5 h-5" /></button>
            <button onClick={() => { localStorage.removeItem('token'); location.reload(); }} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {[...Array(12)].map((_, i) => <div key={i} className="aspect-[4/5] rounded-2xl shimmer"></div>)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Folder className="w-16 h-16 mb-4 text-slate-200" />
              <p>暂无文件</p>
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-20">
              {filtered.map(i => (
                <div key={i.name} onClick={() => i.type === 'folder' ? setPath([...path, i]) : window.open(api.url(i.id))} className="group bg-white p-3 rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer aspect-[4/5] flex flex-col">
                  <div className="flex-1 bg-slate-50 rounded-xl flex items-center justify-center mb-3 overflow-hidden">
                    {i.type.startsWith('image') ? <img src={api.url(i.id)} className="w-full h-full object-cover" loading="lazy" /> : <Icon type={i.type} className="w-12 h-12" />}
                  </div>
                  <div className="px-1 text-center">
                    <div className="text-sm font-medium text-slate-700 truncate">{i.name}</div>
                    <div className="text-xs text-slate-400 mt-1">{i.type === 'folder' ? '-' : formatSize(i.size)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {filtered.map(i => (
                <div key={i.name} onClick={() => i.type === 'folder' ? setPath([...path, i]) : window.open(api.url(i.id))} className="flex items-center p-4 border-b border-slate-100 hover:bg-slate-50 cursor-pointer last:border-0">
                  <Icon type={i.type} className="w-5 h-5 mr-4" />
                  <span className="flex-1 text-sm font-medium text-slate-700 truncate">{i.name}</span>
                  <span className="text-xs text-slate-400 w-24 text-right">{i.type === 'folder' ? '-' : formatSize(i.size)}</span>
                  <span className="text-xs text-slate-400 w-32 text-right hidden sm:block">{new Date(i.t).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}