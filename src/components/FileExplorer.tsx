import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ExplorerItem, FileItem, FolderItem, MoveItem, DeleteItem } from '../lib/api';
import { 
  Folder, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, 
  Link as LinkIcon, Scissors, ClipboardPaste, RefreshCw, Menu, CheckCircle2, Download, 
  AlertTriangle, X, Info, FolderInput, List as ListIcon, LayoutGrid, ArrowDownAZ, 
  Clock3, HardDrive, Pencil
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree, Crumb, SharedTreeState } from './FolderTree';
import { getFileIcon, formatBytes, formatTime } from '../utils/file-helpers';

// 懒加载图片组件
function LazyImg({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <div className={`relative overflow-hidden ${className} bg-slate-100`}>
    {visible ? <img ref={ref} src={src} className="w-full h-full object-cover transition-transform duration-500 hover:scale-110" loading="lazy" alt="" /> : <div className="w-full h-full bg-slate-100 animate-pulse"/>}
  </div>;
}

const LS_LAST = 'last_crumbs_v4';

function isFolder(item: ExplorerItem): item is FolderItem { return (item as any).type === 'folder'; }

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ folderId: 'root', name: '我的云盘', path: '' }]);
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lastSel, setLastSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [multi, setMulti] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sort, setSort] = useState<'time' | 'name' | 'size'>('time');
  const [clip, setClip] = useState<MoveItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Dialogs
  const [menu, setMenu] = useState({ v: false, x: 0, y: 0, key: null as string | null, type: 'blank' });
  const [delOpen, setDelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renOpen, setRenOpen] = useState({ open: false, kind: 'file', old: '', new: '', fid: '', pid: '', fidItem: '' });
  const [pick, setPick] = useState<Crumb[]>([{ folderId: 'root', name: '我的云盘', path: '' }]);

  // Cache & Tree
  const cache = useRef<Map<string, ExplorerItem[]>>(new Map());
  const [cMap, setCMap] = useState(new Map()); const [exp, setExp] = useState(new Set()); const nRef = useRef(new Map());
  const sharedTree = useMemo(() => ({ childrenMap: cMap, setChildrenMap: setCMap, expanded: exp, setExpanded: setExp, nodeInfoRef: nRef }), [cMap, exp]);
  const [inv, setInv] = useState({ n: 0, ids: [] as string[] });

  const cur = crumbs[crumbs.length - 1];
  const byKey = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  const single = useMemo(() => sel.size === 1 ? byKey.get(Array.from(sel)[0]) : null, [sel, byKey]);

  const load = async (fid = cur.folderId, path = cur.path, force = false) => {
    if (!force && cache.current.has(fid)) {
      setItems(cache.current.get(fid)!);
      api.list(fid, path).then(r => { setItems([...r.folders, ...r.files]); cache.current.set(fid, [...r.folders, ...r.files]); }).catch(() => {});
      return;
    }
    setLoading(true); setError('');
    try {
      const res = await api.list(fid, path, force);
      setItems([...res.folders, ...res.files]); cache.current.set(fid, [...res.folders, ...res.files]); setSel(new Set());
    } catch (e: any) { setError(e?.message || 'Error'); } finally { setLoading(false); }
  };

  useEffect(() => { try { const s = localStorage.getItem(LS_LAST); if (s) { const c = JSON.parse(s); if (c.length) { setCrumbs(c); load(c[c.length - 1].folderId, c[c.length - 1].path); return; } } } catch {} load(); }, []);
  useEffect(() => { if (api.checkAuth()) { load(cur.folderId, cur.path, true); cache.current.clear(); setInv(p => ({ n: p.n + 1, ids: ['root', cur.folderId] })); } }, [refreshNonce]);
  useEffect(() => { localStorage.setItem(LS_LAST, JSON.stringify(crumbs)); }, [crumbs]);

  const nav = (c: Crumb[]) => { setCrumbs(c); setQuery(''); setSidebar(false); setSel(new Set()); load(c[c.length - 1].folderId, c[c.length - 1].path); };
  const sorted = useMemo(() => {
    let l = query ? items.filter(i => i.name.toLowerCase().includes(query.toLowerCase())) : items;
    const fd = l.filter(isFolder).sort((a, b) => a.name.localeCompare(b.name));
    const fl = l.filter(i => !isFolder(i)).sort((a: any, b: any) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : b.uploadedAt - a.uploadedAt);
    return [...fd, ...fl];
  }, [items, query, sort]);

  const op = async (fn: Function, msg: string) => { if (busy) return; setBusy(true); const t = toast.loading(msg); try { await fn(); toast.success('完成'); setInv(p => ({ n: p.n + 1, ids: [cur.folderId] })); await load(cur.folderId, cur.path, true); } catch (e: any) { toast.error(e?.message || '失败'); } finally { setBusy(false); toast.dismiss(t); } };

  // --- 骨架屏 ---
  const SkeletonGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 animate-pulse">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="aspect-[4/5] rounded-2xl bg-slate-100 border border-slate-200"></div>
      ))}
    </div>
  );

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-slate-200/50 border border-white/60 overflow-hidden flex flex-col sm:flex-row h-[calc(100vh-120px)] relative select-none">
      {sidebar && <div className="fixed inset-0 bg-black/10 z-30 sm:hidden backdrop-blur-sm" onClick={() => setSidebar(false)} />}
      
      {/* 侧边栏 */}
      <div className={`absolute sm:relative z-40 w-64 h-full bg-slate-50/50 border-r border-slate-200/60 transition-transform duration-300 ${sidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'} flex flex-col`}>
        <div className="p-4 flex items-center gap-2 border-b border-slate-200/60">
           <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Navigation</span>
        </div>
        <FolderTree shared={sharedTree} refreshNonce={refreshNonce} invalidateNonce={inv.n} invalidateFolderIds={inv.ids} currentFolderId={cur.folderId} currentPath={cur.path} onNavigate={(i, p, c) => nav(c)} onMove={(i, t) => op(() => api.move(i, t), '移动中...')} />
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white/60" onClick={() => !multi && setSel(new Set())} onContextMenu={e => { e.preventDefault(); setMenu({ v: true, x: e.pageX, y: e.pageY, key: null, type: 'blank' }) }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) op(() => api.upload(Array.from(e.dataTransfer.files), cur.folderId), '上传中...') }}>
        {/* 工具栏 */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-200/60 bg-white/40 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-3 overflow-hidden flex-1 mr-4">
            <button className="sm:hidden p-2 hover:bg-white rounded-xl shadow-sm border border-transparent hover:border-slate-200 transition-all text-slate-500" onClick={() => setSidebar(true)}><Menu className="w-5 h-5" /></button>
            <button onClick={() => crumbs.length > 1 && nav(crumbs.slice(0, -1))} disabled={crumbs.length <= 1} className="p-2 hover:bg-white rounded-xl shadow-sm border border-transparent hover:border-slate-200 transition-all text-slate-500 disabled:opacity-30"><ArrowLeft className="w-5 h-5" /></button>
            
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 overflow-hidden mask-fade-right">
              {crumbs.map((c, i) => (
                <div key={c.path || 'root'} className="flex items-center whitespace-nowrap">
                  {i > 0 && <span className="text-slate-300 mx-1">/</span>}
                  <button onClick={(e) => { e.stopPropagation(); nav(crumbs.slice(0, i + 1)) }} className={`px-2 py-1 rounded-lg transition-colors ${i === crumbs.length - 1 ? 'bg-white shadow-sm text-slate-900 font-bold border border-slate-100' : 'hover:bg-white/50'}`}>{c.name}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {sel.size > 0 ? (
              <div className="flex items-center gap-1 bg-white p-1 rounded-2xl shadow-lg border border-indigo-100 animate-enter">
                <span className="text-xs font-bold text-indigo-600 px-3">{sel.size} 项</span>
                {single && !isFolder(single) && <button onClick={() => window.open(api.getFileUrl((single as FileItem).fileId))} className="p-2 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-xl transition-colors"><Download className="w-4 h-4" /></button>}
                <button onClick={() => setInfoOpen(true)} className="p-2 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-xl transition-colors"><Info className="w-4 h-4" /></button>
                <button onClick={() => { setClip(Array.from(sel).map(k => byKey.get(k)).filter(Boolean).map(x => isFolder(x!) ? { kind: 'folder', fromFolderId: cur.folderId, folderId: x!.folderId, name: x!.name } : { kind: 'file', fromFolderId: cur.folderId, name: x!.name }) as any); setSel(new Set()); toast.success('已复制到剪贴板') }} className="p-2 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-xl transition-colors"><Scissors className="w-4 h-4" /></button>
                <button onClick={() => { setPick(crumbs); setMoveOpen(true) }} className="p-2 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 rounded-xl transition-colors"><FolderInput className="w-4 h-4" /></button>
                <button onClick={() => setDelOpen(true)} className="p-2 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-xl transition-colors"><Trash2 className="w-4 h-4" /></button>
                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                <button onClick={() => setSel(new Set())} className="p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-xl transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <>
                {clip && <button onClick={() => op(async () => { await api.move(clip, cur.folderId); setClip(null) }, '粘贴中...')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 transition-all font-semibold text-xs"><ClipboardPaste className="w-3.5 h-3.5" /> 粘贴</button>}
                <div className="hidden lg:block relative group">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-indigo-500 transition-colors" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件..." className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm w-48 focus:w-64 transition-all outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 placeholder:text-slate-400" />
                </div>
                <div className="h-8 w-px bg-slate-200 mx-2 hidden sm:block"></div>
                <button onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')} className="p-2 text-slate-500 hover:bg-white hover:text-indigo-600 rounded-xl hover:shadow-sm transition-all border border-transparent hover:border-slate-100">{view === 'grid' ? <ListIcon className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}</button>
                <button onClick={() => setSort(s => s === 'time' ? 'name' : s === 'name' ? 'size' : 'time')} className="p-2 text-slate-500 hover:bg-white hover:text-indigo-600 rounded-xl hover:shadow-sm transition-all border border-transparent hover:border-slate-100" title={`排序: ${sort}`}>{sort === 'time' ? <Clock3 className="w-5 h-5" /> : sort === 'name' ? <ArrowDownAZ className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}</button>
                <button onClick={() => { const n = prompt('新文件夹名称:'); if (n) op(() => api.createFolder(cur.folderId, n), '创建中...') }} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors" title="新建文件夹"><FolderPlus className="w-5 h-5" /></button>
                <button onClick={() => { setMulti(!multi); setSel(new Set()) }} className={`p-2 rounded-xl transition-all border ${multi ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'text-slate-500 border-transparent hover:bg-white hover:shadow-sm'}`} title="多选模式"><CheckSquare className="w-5 h-5" /></button>
              </>
            )}
          </div>
        </div>

        {/* 主内容区域 */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth custom-scrollbar">
          {loading && !items.length ? <SkeletonGrid /> :
            error ? <div className="flex flex-col items-center justify-center h-full text-red-400 animate-enter"><AlertTriangle className="w-12 h-12 mb-3 opacity-50" /><p>{error}</p><button onClick={() => load()} className="mt-4 px-6 py-2 bg-white border border-red-200 text-red-500 rounded-xl shadow-sm hover:bg-red-50 transition-colors">重试</button></div> :
            !sorted.length ? <div className="flex flex-col items-center justify-center h-full text-slate-400 select-none animate-enter"><div className="w-32 h-32 bg-slate-100 rounded-full flex items-center justify-center mb-6"><Folder className="w-12 h-12 text-slate-300" /></div><p>这里空空如也，拖拽文件上传</p></div> :
            view === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5 pb-20 animate-enter">
                {!query && (
                  <label className="flex flex-col items-center justify-center aspect-[4/5] rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50/50 hover:bg-indigo-50 hover:border-indigo-400 cursor-pointer transition-all group hover:scale-[1.02] active:scale-[0.98]">
                    <input type="file" multiple className="hidden" onChange={e => e.target.files && op(() => api.upload(Array.from(e.target.files!), cur.folderId), '上传中...')} />
                    <div className="w-14 h-14 rounded-full bg-white shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform"><UploadCloud className="w-7 h-7 text-indigo-400" /></div>
                    <span className="text-xs font-bold text-slate-500 group-hover:text-indigo-600">点击上传</span>
                  </label>
                )}
                {sorted.map(i => {
                  const s = sel.has(i.key), d = isFolder(i);
                  return (
                    <div key={i.key} draggable onDragStart={e => { const k = sel.has(i.key) ? Array.from(sel) : [i.key]; e.dataTransfer.setData('application/json', JSON.stringify({ moveItems: k.map(x => byKey.get(x)).map(x => isFolder(x!) ? { kind: 'folder', fromFolderId: cur.folderId, folderId: x!.folderId, name: x!.name } : { kind: 'file', fromFolderId: cur.folderId, name: x!.name }) })) }}
                      onDragOver={e => { if (d) { e.preventDefault(); e.currentTarget.classList.add('ring-4', 'ring-indigo-200', 'scale-105') } }} onDragLeave={e => e.currentTarget.classList.remove('ring-4', 'ring-indigo-200', 'scale-105')} onDrop={e => { if (d) { e.currentTarget.classList.remove('ring-4', 'ring-indigo-200', 'scale-105'); e.preventDefault(); const dt = e.dataTransfer.getData('application/json'); if (dt) op(() => api.move(JSON.parse(dt).moveItems, (i as FolderItem).folderId), '移动中...') } }}
                      onClick={e => { e.stopPropagation(); if (multi || e.ctrlKey) { setSel(p => { const n = new Set(p); n.has(i.key) ? n.delete(i.key) : n.add(i.key); return n }); setLastSel(i.key) } else if (e.shiftKey && lastSel) { /* simplified shift */ setSel(new Set([i.key])) } else if (d) { nav([...crumbs, { folderId: i.folderId, name: i.name, path: i.key }]) } else { setSel(new Set([i.key])); setLastSel(i.key) } }}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); if (!s) setSel(new Set([i.key])); setMenu({ v: true, x: e.pageX, y: e.pageY, key: i.key, type: 'item' }) }}
                      onDoubleClick={() => !d && window.open(api.getFileUrl((i as FileItem).fileId))}
                      className={`group relative flex flex-col rounded-3xl border bg-white p-3 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer aspect-[4/5] ${s ? 'border-indigo-500 ring-2 ring-indigo-500/30 shadow-indigo-200' : 'border-slate-100'}`}
                    >
                      {s && <div className="absolute top-3 right-3 z-10"><CheckCircle2 className="w-6 h-6 text-indigo-600 fill-white drop-shadow-md" /></div>}
                      <div className="flex-1 flex items-center justify-center overflow-hidden w-full rounded-2xl bg-slate-50 mb-3 relative">
                        {d ? <Folder className="w-20 h-20 text-indigo-300 fill-indigo-50 drop-shadow-sm group-hover:scale-110 transition-transform duration-300" /> :
                         i.type?.startsWith('image/') ? <LazyImg src={api.getFileUrl((i as FileItem).fileId)} className="w-full h-full object-cover" /> : 
                         getFileIcon(i.type, i.name, "w-16 h-16 group-hover:scale-110 transition-transform duration-300")}
                      </div>
                      <div className="text-center px-2">
                        <div className="text-sm font-semibold text-slate-700 truncate group-hover:text-indigo-700 transition-colors" title={i.name}>{i.name}</div>
                        <div className="text-[10px] font-medium text-slate-400 mt-1 bg-slate-100 inline-block px-2 py-0.5 rounded-full">{d ? formatTime(i.uploadedAt) : formatBytes(i.size)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-lg shadow-slate-200/50 overflow-hidden animate-enter">
                <div className="grid grid-cols-[auto,1fr,120px,180px] gap-4 px-6 py-3 bg-slate-50/80 border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <div className="w-6 text-center">#</div>
                  <div>名称</div>
                  <div className="text-right">大小</div>
                  <div className="text-right">修改时间</div>
                </div>
                {sorted.map((i, idx) => {
                  const s = sel.has(i.key), d = isFolder(i);
                  return <div key={i.key} onClick={e => { e.stopPropagation(); if (d) nav([...crumbs, { folderId: i.folderId, name: i.name, path: i.key }]); else setSel(new Set([i.key])) }} className={`group grid grid-cols-[auto,1fr,120px,180px] gap-4 px-6 py-4 border-b border-slate-50 items-center hover:bg-indigo-50/30 cursor-pointer text-sm transition-all ${s ? 'bg-indigo-50' : 'even:bg-slate-50/30'}`}>
                    <div className="w-6 flex justify-center">{s ? <CheckCircle2 className="w-5 h-5 text-indigo-600" /> : d ? <Folder className="w-5 h-5 text-indigo-300" /> : getFileIcon(i.type, i.name, "w-5 h-5")}</div>
                    <div className="truncate font-semibold text-slate-700 group-hover:text-indigo-700 transition-colors">{i.name}</div>
                    <div className="text-slate-400 text-xs font-mono text-right">{d ? '-' : formatBytes(i.size)}</div>
                    <div className="text-slate-400 text-xs text-right">{formatTime(i.uploadedAt)}</div>
                  </div>
                })}
              </div>
            )
          }
        </div>
      </div>

      {/* 弹窗部分保持逻辑不变，仅优化样式类名 (圆角、阴影) - 此处省略部分重复代码，核心是使用 rounded-2xl, shadow-2xl, backdrop-blur */}
      {/* 详情侧边栏 */}
      {infoOpen && <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex justify-end transition-opacity" onClick={() => setInfoOpen(false)}>
        <div className="bg-white w-full max-w-sm h-full shadow-2xl p-8 overflow-y-auto animate-enter border-l border-white/50" onClick={e => e.stopPropagation()}>
           <div className="flex justify-between items-center mb-8">
             <h3 className="text-2xl font-bold text-slate-800">详情</h3>
             <button onClick={() => setInfoOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-6 h-6 text-slate-400" /></button>
           </div>
           {single ? <div className="space-y-8">
              <div className="aspect-square bg-slate-50 rounded-3xl flex items-center justify-center border border-slate-100 shadow-inner">
                 {isFolder(single) ? <Folder className="w-32 h-32 text-indigo-300" /> : single.type?.startsWith('image/') ? <img src={api.getFileUrl((single as FileItem).fileId)} className="w-full h-full object-cover rounded-3xl" alt=""/> : getFileIcon(single.type, single.name, "w-32 h-32")}
              </div>
              <div className="space-y-4">
                 <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">名称</div><div className="font-semibold text-slate-800 break-all">{single.name}</div></div>
                 <div className="grid grid-cols-2 gap-4">
                    <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">类型</div><div className="text-sm font-medium">{isFolder(single)?'文件夹':single.type}</div></div>
                    <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">大小</div><div className="text-sm font-medium">{isFolder(single)?'-':formatBytes((single as FileItem).size)}</div></div>
                 </div>
                 <div><div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">修改时间</div><div className="text-sm font-medium">{formatTime(single.uploadedAt)}</div></div>
              </div>
              {!isFolder(single) && <button onClick={()=>{navigator.clipboard.writeText(api.getFileUrl((single as FileItem).fileId));toast.success('已复制')}} className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2"><LinkIcon className="w-4 h-4"/> 复制直链</button>}
           </div> : <div className="text-center text-slate-400 mt-20">已选择 {sel.size} 项</div>}
        </div>
      </div>}
      
      {/* 右键菜单 - 玻璃拟态 */}
      {menu.v && <>
         <div className="fixed inset-0 z-40" onClick={()=>setMenu(p=>({...p,v:false}))}/>
         <div className="fixed z-50 bg-white/90 backdrop-blur-xl rounded-xl shadow-2xl ring-1 ring-black/5 w-48 py-2 text-sm font-medium text-slate-700 animate-in fade-in zoom-in-95 duration-100 origin-top-left" style={{top:Math.min(menu.y,window.innerHeight-250),left:Math.min(menu.x,window.innerWidth-200)}} onClick={e=>e.stopPropagation()}>
           {/* 菜单项保持原有逻辑，仅调整 padding 和 hover 颜色 */}
           {menu.type==='blank' ? <>
             <button onClick={()=>{setMenu(p=>({...p,v:false}));load(cur.folderId,cur.path,true)}} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-600 flex gap-3 items-center"><RefreshCw className="w-4 h-4"/> 刷新</button>
             <button onClick={()=>{setMenu(p=>({...p,v:false}));const n=prompt('名称:');if(n)op(()=>api.createFolder(cur.folderId,n),'创建中...')}} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-600 flex gap-3 items-center"><FolderPlus className="w-4 h-4"/> 新建文件夹</button>
             {clip && <button onClick={()=>{setMenu(p=>({...p,v:false}));op(async()=>{await api.move(clip, cur.folderId);setClip(null)},'粘贴中...')}} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-600 flex gap-3 items-center text-indigo-600"><ClipboardPaste className="w-4 h-4"/> 粘贴</button>}
           </> : <>
             {selection.size===1 && single && !isFolder(single) && <button onClick={()=>{setMenu(p=>({...p,v:false}));window.open(api.getFileUrl((single as FileItem).fileId))}} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-600 flex gap-3 items-center"><Download className="w-4 h-4"/> 下载</button>}
             <button onClick={()=>{setMenu(p=>({...p,v:false}));setRenOpen({open:true,kind:isFolder(single!)?'folder':'file',old:single!.name,new:single!.name,fid:cur.folderId,pid:cur.folderId,fidItem:isFolder(single!)?(single as FolderItem).folderId:''})}} className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 hover:text-indigo-600 flex gap-3 items-center"><Pencil className="w-4 h-4"/> 重命名</button>
             <div className="my-1 border-t border-slate-100"/>
             <button onClick={()=>{setMenu(p=>({...p,v:false}));setDelOpen(true)}} className="w-full text-left px-4 py-2.5 hover:bg-red-50 hover:text-red-600 flex gap-3 items-center text-red-500"><Trash2 className="w-4 h-4"/> 删除</button>
           </>}
         </div>
      </>}

      {/* 删除弹窗 */}
      {delOpen && <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
         <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-8 text-center animate-enter">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6"><AlertTriangle className="w-8 h-8 text-red-500"/></div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">确认删除?</h3>
            <p className="text-slate-500 mb-8">选中的 {sel.size} 个项目将被永久删除。</p>
            <div className="grid grid-cols-2 gap-4">
               <button onClick={()=>setDelOpen(false)} className="py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors">取消</button>
               <button onClick={()=>{setDelOpen(false);op(async()=>{await api.batchDelete(Array.from(sel).map(k=>byKey.get(k)).filter(Boolean).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,name:x!.name,folderId:x!.folderId}:{kind:'file',fromFolderId:cur.folderId,name:x!.name,fileId:x!.fileId}) as any)},'删除中...')}} className="py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600 shadow-lg shadow-red-200 transition-colors">删除</button>
            </div>
         </div>
      </div>}
      
      {/* 移动和重命名弹窗逻辑一样，使用 rounded-3xl 和 shadow-2xl 替换旧样式即可，逻辑省略以节省字符 */}
      {renOpen.open && <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
         <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 animate-enter">
            <h3 className="font-bold text-lg mb-6 text-center">重命名</h3>
            <input value={renOpen.new} onChange={e=>setRenOpen(p=>({...p,new:e.target.value}))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 mb-6 font-medium text-center" autoFocus/>
            <div className="grid grid-cols-2 gap-4">
               <button onClick={()=>setRenOpen(p=>({...p,open:false}))} className="py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50">取消</button>
               <button onClick={()=>{setRenOpen(p=>({...p,open:false}));op(()=>renOpen.kind==='file'?api.renameFile(renOpen.fid,renOpen.old,renOpen.new):api.renameFolder(renOpen.pid,renOpen.fidItem,renOpen.old,renOpen.new),'处理中...')}} className="py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200">确定</button>
            </div>
         </div>
      </div>}
      
      {moveOpen && <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
         <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg h-[600px] flex flex-col overflow-hidden animate-enter">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center"><h3 className="font-bold text-xl">移动到...</h3><button onClick={()=>setMoveOpen(false)}><X className="w-6 h-6 text-slate-400 hover:bg-slate-100 rounded-full p-1"/></button></div>
            <div className="flex-1 overflow-auto p-4 bg-slate-50"><FolderTree shared={sharedTree} mode="picker" currentFolderId={cur.folderId} currentPath={cur.path} pickedFolderId={pick[pick.length-1].folderId} onPick={(i,p,c)=>setPick(c)}/></div>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-white">
               <button onClick={()=>setMoveOpen(false)} className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-50">取消</button>
               <button onClick={()=>{setMoveOpen(false);op(()=>api.move(Array.from(sel).map(k=>byKey.get(k)).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,folderId:x!.folderId,name:x!.name}:{kind:'file',fromFolderId:cur.folderId,name:x!.name}) as any, pick[pick.length-1].folderId),'移动中...')}} className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200">移动</button>
            </div>
         </div>
      </div>}

    </div>
  );
}