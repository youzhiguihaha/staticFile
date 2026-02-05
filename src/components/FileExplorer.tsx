import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ExplorerItem, FileItem, FolderItem, MoveItem, DeleteItem } from '../lib/api';
import { Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, Link as LinkIcon, Scissors, ClipboardPaste, RefreshCw, Menu, CheckCircle2, Download, AlertTriangle, X, Info, FolderInput, List as ListIcon, LayoutGrid, ArrowDownAZ, Clock3, HardDrive, Pencil, Image as ImageIcon, Film, Music } from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree, Crumb, SharedTreeState } from './FolderTree';

// 辅助函数
function isFolder(item: ExplorerItem): item is FolderItem { return (item as any).type === 'folder'; }
function formatBytes(b: number) { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB']; let i=0; while(b>=1024&&i<u.length-1){b/=1024;i++} return `${b.toFixed(1)} ${u[i]}`; }
function formatTime(ts?: number) { return ts ? new Date(ts).toLocaleString() : '-'; }

// 根据文件类型返回图标
function getFileIcon(t: string, cls: string) {
  if (t.startsWith('image/')) return <ImageIcon className={`${cls} text-purple-500`} />;
  if (t.startsWith('video/')) return <Film className={`${cls} text-red-500`} />;
  if (t.startsWith('audio/')) return <Music className={`${cls} text-yellow-500`} />;
  return <FileText className={`${cls} text-slate-400`} />;
}

// 懒加载图片组件 (节省带宽和 KV 读取 - 尽管现在走了 Cache，省点带宽也是好的)
function LazyImg({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null); 
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (!('IntersectionObserver' in window)) { setV(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); io.disconnect(); } });
    io.observe(el); return () => io.disconnect();
  }, []);
  return <img ref={ref} src={v ? src : ''} className={className} loading="lazy" />;
}

const LS_LAST = 'last_crumbs_v3';

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  // 状态管理
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lastKey, setLastKey] = useState<string|null>(null);
  const [search, setSearch] = useState('');
  const [sidebar, setSidebar] = useState(false);
  const [multi, setMulti] = useState(false);
  const [view, setView] = useState<'grid'|'list'>('grid');
  const [sort, setSort] = useState<'time'|'name'|'size'>('time');
  const [clip, setClip] = useState<MoveItem[]|null>(null);
  const [busy, setBusy] = useState(false); // 全局操作锁
  
  // 对话框状态
  const [menu, setMenu] = useState({ v:false, x:0, y:0, key:null as string|null, type:'blank' });
  const [delOpen, setDelOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renOpen, setRenOpen] = useState({ open:false, kind:'file', old:'', new:'', fid:'', pid:'', fidItem:'' });
  const [pick, setPick] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);

  // 缓存与树共享
  const cache = useRef<Map<string, ExplorerItem[]>>(new Map()); // 列表数据缓存
  const [cMap, setCMap] = useState(new Map()); 
  const [exp, setExp] = useState(new Set()); 
  const nRef = useRef(new Map());
  const sharedTree = useMemo(()=>({childrenMap:cMap, setChildrenMap:setCMap, expanded:exp, setExpanded:setExp, nodeInfoRef:nRef}),[cMap,exp]);
  const [inv, setInv] = useState({n:0, ids:[] as string[]}); // 树失效信号
  
  const cur = crumbs[crumbs.length - 1];
  const byKey = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  const single = useMemo(() => sel.size === 1 ? byKey.get(Array.from(sel)[0]) : null, [sel, byKey]);

  // 加载数据 (核心优化：内存缓存优先，force 参数控制穿透)
  const load = async (fid = cur.folderId, path = cur.path, force = false) => {
    if (!force && cache.current.has(fid)) {
      setItems(cache.current.get(fid)!);
      // 静默后台更新，不展示 loading
      api.list(fid, path).then(r => { 
        setItems([...r.folders, ...r.files]); 
        cache.current.set(fid, [...r.folders, ...r.files]); 
      }).catch(()=>{});
      return;
    }
    setLoading(true); setErr('');
    try {
      const res = await api.list(fid, path, force);
      setItems([...res.folders, ...res.files]); 
      cache.current.set(fid, [...res.folders, ...res.files]); 
      setSel(new Set());
    } catch (e: any) { 
      setErr(e?.message||'加载失败'); 
    } finally { 
      setLoading(false); 
    }
  };

  // 初始化与持久化
  useEffect(() => {
    try { const s = localStorage.getItem(LS_LAST); if(s) { const c = JSON.parse(s); if(c.length){ setCrumbs(c); load(c[c.length-1].folderId, c[c.length-1].path); return; } } } catch {}
    load();
  }, []);
  
  // 外部刷新触发
  useEffect(() => { 
    if (api.checkAuth()) { 
      load(cur.folderId, cur.path, true); 
      cache.current.clear(); // 清空所有缓存，强制最新
      setInv(p=>({n:p.n+1, ids:['root', cur.folderId]})); 
    } 
  }, [refreshNonce]);

  useEffect(() => { localStorage.setItem(LS_LAST, JSON.stringify(crumbs)); }, [crumbs]);

  const nav = (c: Crumb[]) => { 
    setCrumbs(c); setSearch(''); setSidebar(false); setSel(new Set()); 
    load(c[c.length-1].folderId, c[c.length-1].path); 
  };

  // 排序与过滤
  const sorted = useMemo(() => {
    let l = search ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())) : items;
    const fd = l.filter(isFolder).sort((a,b)=>a.name.localeCompare(b.name));
    const fl = l.filter(i=>!isFolder(i)).sort((a:any,b:any) => sort==='name'?a.name.localeCompare(b.name):sort==='size'?b.size-a.size:b.uploadedAt-a.uploadedAt);
    return [...fd, ...fl];
  }, [items, search, sort]);

  // 通用操作包装器 (自动处理 loading、错误提示、刷新)
  const doOp = async (fn: Function, msg: string) => {
    if(busy) return; 
    setBusy(true); 
    const t = toast.loading(msg);
    try { 
      await fn(); 
      toast.success('操作成功'); 
      setInv(p=>({n:p.n+1, ids:[cur.folderId]})); 
      await load(cur.folderId, cur.path, true); // 强制刷新
    }
    catch(e:any) { toast.error(e?.message||'操作失败'); } 
    finally { setBusy(false); toast.dismiss(t); }
  };

  return (
    <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col sm:flex-row h-[calc(100vh-140px)] relative select-none">
      {/* 侧边栏遮罩 */}
      {sidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setSidebar(false)} />}
      
      {/* 左侧目录树 */}
      <div className={`absolute sm:relative z-40 w-64 h-full bg-slate-50 border-r border-slate-200 transition-transform ${sidebar?'translate-x-0':'-translate-x-full sm:translate-x-0'} flex flex-col`}>
         <FolderTree 
            shared={sharedTree} 
            refreshNonce={refreshNonce} 
            invalidateNonce={inv.n} 
            invalidateFolderIds={inv.ids} 
            currentFolderId={cur.folderId} 
            currentPath={cur.path} 
            onNavigate={(i,p,c)=>nav(c)} 
            onMove={(i,t)=>doOp(()=>api.move(i,t),'移动中...')}
         />
      </div>

      {/* 主视图 */}
      <div className="flex-1 flex flex-col min-w-0 bg-white" onClick={()=>!multi&&setSel(new Set())} onContextMenu={e=>{e.preventDefault();setMenu({v:true,x:e.pageX,y:e.pageY,key:null,type:'blank'})}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files.length) doOp(()=>api.upload(Array.from(e.dataTransfer.files), cur.folderId),'正在上传，请稍候...')}}>
        
        {/* 工具栏 */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button className="sm:hidden p-2 text-slate-500" onClick={()=>setSidebar(true)}><Menu className="w-5 h-5"/></button>
            <button onClick={()=>crumbs.length>1&&nav(crumbs.slice(0,-1))} disabled={crumbs.length<=1} className="p-2 text-slate-500 disabled:opacity-30" title="返回上级"><ArrowLeft className="w-5 h-5"/></button>
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700 overflow-hidden mask-linear-fade">
               {crumbs.map((c, i) => <span key={c.path} onClick={(e)=>{e.stopPropagation();nav(crumbs.slice(0,i+1))}} className={`cursor-pointer hover:bg-slate-100 px-2 py-1 rounded ${i===crumbs.length-1?'text-black font-bold':''}`}>{i>0&&<span className="text-slate-300 mr-2">/</span>}{c.name}</span>)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {sel.size>0 ? (
               // 选中模式工具栏
               <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-lg animate-in fade-in">
                  <span className="text-xs font-bold mr-2">{sel.size} 项</span>
                  {single && !isFolder(single) && <button onClick={()=>window.open(api.getFileUrl((single as FileItem).fileId))} className="p-1.5 hover:bg-blue-100 rounded" title="下载"><Download className="w-4 h-4"/></button>}
                  <button onClick={()=>setInfoOpen(true)} className="p-1.5 hover:bg-blue-100 rounded" title="详情"><Info className="w-4 h-4"/></button>
                  <button onClick={()=>{setClip(Array.from(sel).map(k=>byKey.get(k)).filter(Boolean).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,folderId:x!.folderId,name:x!.name}:{kind:'file',fromFolderId:cur.folderId,name:x!.name}) as any);setSel(new Set());toast.success('已剪切到剪贴板')}} className="p-1.5 hover:bg-blue-100 rounded" title="剪切"><Scissors className="w-4 h-4"/></button>
                  <button onClick={()=>{setPick(crumbs);setMoveOpen(true)}} className="p-1.5 hover:bg-blue-100 rounded" title="移动到"><FolderInput className="w-4 h-4"/></button>
                  <button onClick={()=>{setDelOpen(true)}} className="p-1.5 hover:bg-red-100 text-red-600 rounded" title="删除"><Trash2 className="w-4 h-4"/></button>
                  <button onClick={()=>setSel(new Set())} className="p-1.5 hover:bg-blue-100 rounded" title="取消选择"><X className="w-4 h-4"/></button>
               </div>
            ) : (
               // 默认工具栏
               <>
                 {clip && <button onClick={()=>doOp(async()=>{await api.move(clip, cur.folderId);setClip(null)},'移动中...')} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs shadow hover:bg-blue-700"><ClipboardPaste className="w-3.5 h-3.5 inline mr-1"/>粘贴</button>}
                 <div className="hidden md:block relative"><Search className="w-4 h-4 text-slate-400 absolute left-2 top-2"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索..." className="pl-8 py-1.5 bg-slate-100 rounded text-xs w-32 focus:w-48 transition-all outline-none"/></div>
                 <button onClick={()=>setView(v=>v==='grid'?'list':'grid')} className="p-2 text-slate-600 hover:bg-slate-100 rounded">{view==='grid'?<ListIcon className="w-5 h-5"/>:<LayoutGrid className="w-5 h-5"/>}</button>
                 <button onClick={()=>setSort(s=>s==='time'?'name':s==='name'?'size':'time')} className="p-2 text-slate-600 hover:bg-slate-100 rounded" title="切换排序">{sort==='time'?<Clock3 className="w-5 h-5"/>:sort==='name'?<ArrowDownAZ className="w-5 h-5"/>:<HardDrive className="w-5 h-5"/>}</button>
                 <button onClick={()=>{const n=prompt('请输入文件夹名称:');if(n)doOp(()=>api.createFolder(cur.folderId,n),'创建中...')}} className="p-2 text-blue-600 hover:bg-blue-50 rounded" title="新建文件夹"><FolderPlus className="w-5 h-5"/></button>
                 <button onClick={()=>{setMulti(!multi);setSel(new Set())}} className={`p-2 rounded ${multi?'bg-blue-600 text-white':'text-slate-600 hover:bg-slate-100'}`} title="多选模式"><CheckSquare className="w-5 h-5"/></button>
               </>
            )}
          </div>
        </div>

        {/* 文件列表区域 */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
           {loading ? <div className="flex justify-center p-10"><RefreshCw className="w-8 h-8 text-slate-300 animate-spin"/></div> : 
            loadError ? <div className="text-center p-10 text-red-400">{loadError}</div> :
            !sorted.length ? <div className="text-center p-20 text-slate-400 flex flex-col items-center select-none"><Folder className="w-12 h-12 mb-2 text-slate-200"/>文件夹为空</div> :
            view === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-20">
                   {!search && <label className="flex flex-col items-center justify-center aspect-[4/5] rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-blue-50 cursor-pointer transition-colors"><input type="file" multiple className="hidden" onChange={e=>e.target.files&&doOp(()=>api.upload(Array.from(e.target.files!),cur.folderId),'上传中...')}/><UploadCloud className="w-8 h-8 text-slate-400 mb-2"/><span className="text-xs text-slate-500">点击上传</span></label>}
                   {sorted.map(i => {
                     const s = sel.has(i.key), d = isFolder(i);
                     return (
                       <div key={i.key} draggable 
                            onDragStart={e=>{const k=sel.has(i.key)?Array.from(sel):[i.key];e.dataTransfer.setData('application/json',JSON.stringify({moveItems:k.map(x=>byKey.get(x)).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,folderId:x!.folderId,name:x!.name}:{kind:'file',fromFolderId:cur.folderId,name:x!.name})}))}}
                            onDragOver={e=>{if(d){e.preventDefault();e.currentTarget.classList.add('ring-2','ring-blue-400')}}} 
                            onDragLeave={e=>e.currentTarget.classList.remove('ring-2','ring-blue-400')} 
                            onDrop={e=>{if(d){e.currentTarget.classList.remove('ring-2','ring-blue-400');e.preventDefault();const dt=e.dataTransfer.getData('application/json');if(dt)doOp(()=>api.move(JSON.parse(dt).moveItems,(i as FolderItem).folderId),'移动中...')}}}
                            onClick={e=>{e.stopPropagation();if(multi||e.ctrlKey){setSel(p=>{const n=new Set(p);n.has(i.key)?n.delete(i.key):n.add(i.key);return n});setLastKey(i.key)}else if(e.shiftKey&&lastKey){/* 简化 Shift 连选逻辑 */ setSel(new Set([i.key]))}else if(d){nav([...crumbs,{folderId:i.folderId,name:i.name,path:i.key}])}else{setSel(new Set([i.key]));setLastKey(i.key)}}}
                            onContextMenu={e=>{e.preventDefault();e.stopPropagation();if(!s)setSel(new Set([i.key]));setMenu({v:true,x:e.pageX,y:e.pageY,key:i.key,type:'item'})}}
                            onDoubleClick={()=>!d&&window.open(api.getFileUrl((i as FileItem).fileId))}
                            className={`relative flex flex-col rounded-xl border bg-white p-3 shadow-sm hover:shadow-md cursor-pointer aspect-[4/5] transition-all ${s?'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30':'border-slate-200'}`}>
                          {s&&<div className="absolute top-2 right-2 z-10"><CheckCircle2 className="w-5 h-5 text-blue-600 fill-white"/></div>}
                          <div className="flex-1 flex items-center justify-center overflow-hidden w-full rounded-lg bg-slate-50 mb-3">{d?<Folder className="w-16 h-16 text-blue-400 fill-blue-50"/>:i.type?.startsWith('image/')?<LazyImg src={api.getFileUrl((i as FileItem).fileId)} className="w-full h-full object-cover"/>:getFileIcon(i.type,"w-14 h-14")}</div>
                          <div className="text-center"><div className="text-sm font-medium text-slate-700 truncate" title={i.name}>{i.name}</div><div className="text-xs text-slate-400 mt-1">{d?formatTime(i.uploadedAt):formatBytes(i.size)}</div></div>
                       </div>
                     )})}
                </div>
            ) : (
               <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
                  {sorted.map(i => {
                     const s = sel.has(i.key), d = isFolder(i);
                     return <div key={i.key} onClick={e=>{e.stopPropagation();if(d)nav([...crumbs,{folderId:i.folderId,name:i.name,path:i.key}]);else{setSel(new Set([i.key]))}}} className={`flex items-center gap-4 px-4 py-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer text-sm ${s?'bg-blue-50':''}`}>
                        <div className="w-6">{s?<CheckCircle2 className="w-4 h-4 text-blue-600"/>:d?<Folder className="w-4 h-4 text-slate-400"/>:<FileText className="w-4 h-4 text-slate-400"/>}</div><div className="flex-1 truncate font-medium text-slate-700">{i.name}</div><div className="text-slate-400 text-xs">{d?'-':formatBytes(i.size)}</div><div className="text-slate-400 text-xs w-32 text-right">{formatTime(i.uploadedAt)}</div>
                     </div>
                  })}
               </div>
            )
           }
      </div>

      {/* 右键菜单 */}
      {menu.v && <div className="fixed z-50 bg-white rounded shadow-xl border border-slate-200 w-48 py-1 text-sm animate-in fade-in zoom-in-95 duration-100" style={{top:Math.min(menu.y,window.innerHeight-200),left:Math.min(menu.x,window.innerWidth-200)}} onClick={e=>e.stopPropagation()}>
         {menu.type==='blank' ? <><button onClick={()=>{setMenu(p=>({...p,v:false}));load(cur.folderId,cur.path,true)}} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2"><RefreshCw className="w-4 h-4"/> 刷新</button><button onClick={()=>{const n=prompt('文件夹名:');if(n)doOp(()=>api.createFolder(cur.folderId,n),'创建中...');setMenu(p=>({...p,v:false}))}} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2"><FolderPlus className="w-4 h-4"/> 新建文件夹</button></> :
         <><button onClick={()=>{setMenu(p=>({...p,v:false}));setRenOpen({open:true,kind:isFolder(single!)?'folder':'file',old:single!.name,new:single!.name,fid:cur.folderId,pid:cur.folderId,fidItem:isFolder(single!)?(single as FolderItem).folderId:''})}} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2"><Pencil className="w-4 h-4"/> 重命名</button><button onClick={()=>{setMenu(p=>({...p,v:false}));setDelOpen(true)}} className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2"><Trash2 className="w-4 h-4"/> 删除</button></>}
      </div>}
      {menu.v && <div className="fixed inset-0 z-40" onClick={()=>setMenu(p=>({...p,v:false}))}/>}

      {/* 弹窗组件 (删除、重命名、移动) */}
      {delOpen && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full"><h3 className="font-bold mb-4 text-lg">确认删除 {sel.size} 项?</h3><p className="text-slate-500 mb-6 text-sm">此操作不可恢复。</p><div className="flex justify-end gap-2"><button onClick={()=>setDelOpen(false)} className="px-4 py-2 border rounded-lg hover:bg-slate-50 text-sm">取消</button><button onClick={()=>{setDelOpen(false);doOp(async()=>{await api.batchDelete(Array.from(sel).map(k=>byKey.get(k)).filter(Boolean).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,name:x!.name,folderId:x!.folderId}:{kind:'file',fromFolderId:cur.folderId,name:x!.name,fileId:x!.fileId}) as any)},'删除中...')}} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium">确认删除</button></div></div></div>}
      {renOpen.open && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 backdrop-blur-sm"><div className="bg-white p-6 rounded-xl shadow-2xl max-w-sm w-full"><h3 className="font-bold mb-4 text-lg">重命名</h3><input value={renOpen.new} onChange={e=>setRenOpen(p=>({...p,new:e.target.value}))} className="w-full border p-2 rounded-lg mb-4 outline-none focus:border-blue-500" autoFocus/><div className="flex justify-end gap-2"><button onClick={()=>setRenOpen(p=>({...p,open:false}))} className="px-4 py-2 border rounded-lg hover:bg-slate-50 text-sm">取消</button><button onClick={()=>{setRenOpen(p=>({...p,open:false}));doOp(()=>renOpen.kind==='file'?api.renameFile(renOpen.fid,renOpen.old,renOpen.new):api.renameFolder(renOpen.pid,renOpen.fidItem,renOpen.old,renOpen.new),'重命名中...')}} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">确定</button></div></div></div>}
      {moveOpen && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 backdrop-blur-sm"><div className="bg-white rounded-xl shadow-2xl w-full max-w-lg h-[500px] flex flex-col overflow-hidden"><div className="p-4 border-b font-bold">移动到</div><div className="flex-1 overflow-auto p-2 bg-slate-50"><FolderTree shared={sharedTree} mode="picker" currentFolderId={cur.folderId} currentPath={cur.path} pickedFolderId={pick[pick.length-1].folderId} onPick={(i,p,c)=>setPick(c)}/></div><div className="p-4 border-t flex justify-end gap-2 bg-white"><button onClick={()=>setMoveOpen(false)} className="px-4 py-2 border rounded-lg hover:bg-slate-50 text-sm">取消</button><button onClick={()=>{setMoveOpen(false);doOp(()=>api.move(Array.from(sel).map(k=>byKey.get(k)).map(x=>isFolder(x!)?{kind:'folder',fromFolderId:cur.folderId,folderId:x!.folderId,name:x!.name}:{kind:'file',fromFolderId:cur.folderId,name:x!.name}) as any, pick[pick.length-1].folderId),'移动中...')}} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">确认移动</button></div></div></div>}
    </div>
  );
}