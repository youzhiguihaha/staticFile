import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ExplorerItem, FileItem, FolderItem, MoveItem, DeleteItem } from '../lib/api';
import { 
  Folder, FileText, UploadCloud, Trash2, FolderPlus, ArrowLeft, Search, CheckSquare, 
  Link as LinkIcon, Scissors, ClipboardPaste, RefreshCw, Menu, CheckCircle2, Download, 
  AlertTriangle, X, Info, FolderInput, List as ListIcon, LayoutGrid, ArrowDownAZ, 
  Clock3, HardDrive, Pencil, Image as ImageIcon, Film, Music 
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree, Crumb, SharedTreeState } from './FolderTree';

// --- 辅助函数 ---
function isFolder(item: ExplorerItem): item is FolderItem { 
  return (item as any).type === 'folder'; 
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${units[i]}`;
}

function formatTime(ts?: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function getFileIcon(type: string, className: string) {
  if (type.startsWith('image/')) return <ImageIcon className={`${className} text-purple-500`} />;
  if (type.startsWith('video/')) return <Film className={`${className} text-red-500`} />;
  if (type.startsWith('audio/')) return <Music className={`${className} text-yellow-500`} />;
  return <FileText className={`${className} text-slate-400`} />;
}

// 懒加载图片组件
function LazyImg({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <img ref={ref} src={visible ? src : ''} className={className} loading="lazy" alt="" />;
}

const LS_LAST_CRUMBS = 'last_crumbs_v3';

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  // --- 状态管理 ---
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);
  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  
  // UI 状态
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortMode, setSortMode] = useState<'time' | 'name' | 'size'>('time');
  const [clipboard, setClipboard] = useState<MoveItem[] | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // 对话框状态
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, key: null as string | null, type: 'blank' });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [renameDialog, setRenameDialog] = useState({ 
    open: false, kind: 'file', oldName: '', newName: '', folderId: '', parentId: '', folderItemId: '' 
  });
  const [pickedTarget, setPickedTarget] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);

  // 缓存与树共享
  const itemsCache = useRef<Map<string, ExplorerItem[]>>(new Map());
  const [childrenMap, setChildrenMap] = useState(new Map());
  const [expanded, setExpanded] = useState(new Set());
  const nodeInfoRef = useRef(new Map());
  const sharedTree: SharedTreeState = useMemo(() => ({
    childrenMap, setChildrenMap, expanded, setExpanded, nodeInfoRef
  }), [childrenMap, expanded]);
  
  // 树失效信号
  const [treeInvalidate, setTreeInvalidate] = useState({ nonce: 0, ids: [] as string[] });

  // 衍生数据
  const current = crumbs[crumbs.length - 1];
  const itemsByKey = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  const singleSelected = useMemo(() => selection.size === 1 ? itemsByKey.get(Array.from(selection)[0]) : null, [selection, itemsByKey]);

  // --- 核心方法 ---
  const load = async (folderId = current.folderId, path = current.path, force = false) => {
    // 优先读取内存缓存
    if (!force && itemsCache.current.has(folderId)) {
      setItems(itemsCache.current.get(folderId)!);
      // 静默后台刷新
      api.list(folderId, path).then(res => {
        setItems([...res.folders, ...res.files]);
        itemsCache.current.set(folderId, [...res.folders, ...res.files]);
      }).catch(() => {});
      return;
    }

    setLoading(true);
    setLoadError('');
    try {
      const res = await api.list(folderId, path, force);
      setItems([...res.folders, ...res.files]);
      itemsCache.current.set(folderId, [...res.folders, ...res.files]);
      setSelection(new Set());
    } catch (e: any) {
      setLoadError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 初始化
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_LAST_CRUMBS);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) {
          setCrumbs(saved);
          load(saved[saved.length - 1].folderId, saved[saved.length - 1].path);
          return;
        }
      }
    } catch {}
    load();
  }, []);

  // 外部刷新监听
  useEffect(() => {
    if (api.checkAuth()) {
      load(current.folderId, current.path, true);
      itemsCache.current.clear();
      setTreeInvalidate(p => ({ nonce: p.nonce + 1, ids: ['root', current.folderId] }));
    }
  }, [refreshNonce]);

  // 记录面包屑
  useEffect(() => {
    localStorage.setItem(LS_LAST_CRUMBS, JSON.stringify(crumbs));
  }, [crumbs]);

  const navigate = (nextCrumbs: Crumb[]) => {
    setCrumbs(nextCrumbs);
    setSearchQuery('');
    setShowSidebar(false);
    setSelection(new Set());
    const last = nextCrumbs[nextCrumbs.length - 1];
    load(last.folderId, last.path);
  };

  // 排序与过滤
  const sortedItems = useMemo(() => {
    let list = searchQuery ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase())) : items;
    
    const folders = list.filter(isFolder);
    const files = list.filter(i => !isFolder(i));

    folders.sort((a, b) => a.name.localeCompare(b.name));

    files.sort((a: any, b: any) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name);
      if (sortMode === 'size') return (b.size || 0) - (a.size || 0);
      return (b.uploadedAt || 0) - (a.uploadedAt || 0);
    });

    return [...folders, ...files];
  }, [items, searchQuery, sortMode]);

  // 通用操作封装
  const executeOperation = async (operationFn: () => Promise<void>, loadingMsg: string) => {
    if (isBusy) return;
    setIsBusy(true);
    const toastId = toast.loading(loadingMsg);
    try {
      await operationFn();
      toast.success('操作成功');
      setTreeInvalidate(p => ({ nonce: p.nonce + 1, ids: [current.folderId] }));
      await load(current.folderId, current.path, true);
    } catch (e: any) {
      toast.error(e?.message || '操作失败');
    } finally {
      setIsBusy(false);
      toast.dismiss(toastId);
    }
  };

  // --- 事件处理 ---
  const handleItemClick = (e: React.MouseEvent, item: ExplorerItem) => {
    e.stopPropagation();
    if (isMultiSelectMode || e.ctrlKey || e.metaKey) {
      setSelection(prev => {
        const next = new Set(prev);
        next.has(item.key) ? next.delete(item.key) : next.add(item.key);
        return next;
      });
      setLastSelectedKey(item.key);
      return;
    }
    
    if (e.shiftKey && lastSelectedKey) {
      // 简单范围选择逻辑
      const idx1 = sortedItems.findIndex(i => i.key === lastSelectedKey);
      const idx2 = sortedItems.findIndex(i => i.key === item.key);
      if (idx1 !== -1 && idx2 !== -1) {
        const [start, end] = [Math.min(idx1, idx2), Math.max(idx1, idx2)];
        const range = sortedItems.slice(start, end + 1).map(i => i.key);
        setSelection(new Set(range));
      }
      return;
    }

    if (isFolder(item)) {
      navigate([...crumbs, { folderId: item.folderId, name: item.name, path: item.key }]);
    } else {
      setSelection(new Set([item.key]));
      setLastSelectedKey(item.key);
    }
  };

  const handleDragStart = (e: React.DragEvent, item: ExplorerItem) => {
    const keys = selection.has(item.key) ? Array.from(selection) : [item.key];
    const moveItems = keys.map(k => {
      const it = itemsByKey.get(k);
      if (!it) return null;
      return isFolder(it)
        ? { kind: 'folder', fromFolderId: current.folderId, folderId: it.folderId, name: it.name }
        : { kind: 'file', fromFolderId: current.folderId, name: it.name };
    }).filter(Boolean);
    e.dataTransfer.setData('application/json', JSON.stringify({ moveItems }));
  };

  const handleDropOnFolder = (e: React.DragEvent, target: FolderItem) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('ring-2', 'ring-blue-400');
    
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    
    try {
      const { moveItems } = JSON.parse(data);
      if (moveItems && moveItems.length) {
        executeOperation(
          () => api.move(moveItems, target.folderId),
          '移动中...'
        );
      }
    } catch {}
  };

  // --- 渲染 ---
  return (
    <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col sm:flex-row h-[calc(100vh-140px)] relative select-none">
      
      {/* 移动端侧边栏遮罩 */}
      {showSidebar && (
        <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />
      )}

      {/* 侧边栏 */}
      <div className={`absolute sm:relative z-40 w-64 h-full bg-slate-50 border-r border-slate-200 transition-transform ${showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'} flex flex-col`}>
        <FolderTree 
          shared={sharedTree}
          refreshNonce={refreshNonce}
          invalidateNonce={treeInvalidate.nonce}
          invalidateFolderIds={treeInvalidate.ids}
          currentFolderId={current.folderId}
          currentPath={current.path}
          onNavigate={(fid, p, chain) => navigate(chain)}
          onMove={(items, targetFid) => executeOperation(() => api.move(items, targetFid), '移动中...')}
        />
      </div>

      {/* 主内容区 */}
      <div 
        className="flex-1 flex flex-col min-w-0 bg-white"
        onClick={() => !isMultiSelectMode && setSelection(new Set())}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ visible: true, x: e.pageX, y: e.pageY, key: null, type: 'blank' });
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) {
            executeOperation(() => api.upload(Array.from(e.dataTransfer.files), current.folderId), '上传中...');
          }
        }}
      >
        {/* 顶部工具栏 */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 bg-white/80 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button className="sm:hidden p-2 text-slate-500 hover:bg-slate-100 rounded-full" onClick={() => setShowSidebar(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <button 
              onClick={() => crumbs.length > 1 && navigate(crumbs.slice(0, -1))} 
              disabled={crumbs.length <= 1} 
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-30"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            
            {/* 面包屑 */}
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700 overflow-hidden mask-linear-fade">
              {crumbs.map((c, i) => (
                <div key={c.path || 'root'} className="flex items-center whitespace-nowrap">
                  {i > 0 && <span className="text-slate-300 mx-1">/</span>}
                  <span 
                    onClick={(e) => { e.stopPropagation(); navigate(crumbs.slice(0, i + 1)); }}
                    className={`cursor-pointer hover:bg-slate-100 px-2 py-1 rounded-md ${i === crumbs.length - 1 ? 'text-black font-bold' : ''}`}
                  >
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selection.size > 0 ? (
              // 选中状态工具栏
              <div className="flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded-lg animate-in fade-in slide-in-from-top-2 duration-200">
                <span className="text-xs font-bold mr-2">{selection.size} 项</span>
                
                {singleSelected && !isFolder(singleSelected) && (
                  <button onClick={() => window.open(api.getFileUrl((singleSelected as FileItem).fileId))} className="p-1.5 hover:bg-blue-100 rounded" title="下载">
                    <Download className="w-4 h-4" />
                  </button>
                )}
                
                <button onClick={() => setInfoDrawerOpen(true)} className="p-1.5 hover:bg-blue-100 rounded" title="详情">
                  <Info className="w-4 h-4" />
                </button>
                
                <button 
                  onClick={() => {
                    const moveItems = Array.from(selection).map(k => {
                      const it = itemsByKey.get(k);
                      if (!it) return null;
                      return isFolder(it) 
                        ? { kind: 'folder', fromFolderId: current.folderId, folderId: it.folderId, name: it.name }
                        : { kind: 'file', fromFolderId: current.folderId, name: it.name };
                    }).filter(Boolean) as MoveItem[];
                    
                    setClipboard(moveItems);
                    setSelection(new Set());
                    toast.success('已剪切');
                  }} 
                  className="p-1.5 hover:bg-blue-100 rounded" title="剪切"
                >
                  <Scissors className="w-4 h-4" />
                </button>
                
                <button onClick={() => { setPickedTarget(crumbs); setMoveDialogOpen(true); }} className="p-1.5 hover:bg-blue-100 rounded" title="移动到">
                  <FolderInput className="w-4 h-4" />
                </button>
                
                <button onClick={() => setDeleteConfirmOpen(true)} className="p-1.5 hover:bg-red-100 text-red-600 rounded" title="删除">
                  <Trash2 className="w-4 h-4" />
                </button>
                
                <div className="w-px h-4 bg-blue-200 mx-1" />
                
                <button onClick={() => setSelection(new Set())} className="p-1.5 hover:bg-blue-100 rounded" title="取消">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              // 默认工具栏
              <>
                {clipboard && (
                  <button 
                    onClick={() => executeOperation(async () => { await api.move(clipboard, current.folderId); setClipboard(null); }, '移动中...')} 
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-xs shadow-sm"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                  </button>
                )}
                
                <div className="hidden md:block relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-2 top-2" />
                  <input 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                    placeholder="搜索..." 
                    className="pl-8 py-1.5 bg-slate-100 rounded-lg text-xs w-32 focus:w-48 transition-all outline-none focus:bg-white border border-transparent focus:border-blue-500"
                  />
                </div>
                
                <button onClick={() => setViewMode(v => v === 'grid' ? 'list' : 'grid')} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                  {viewMode === 'grid' ? <ListIcon className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
                </button>
                
                <button onClick={() => setSortMode(s => s === 'time' ? 'name' : s === 'name' ? 'size' : 'time')} className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg">
                  {sortMode === 'time' ? <Clock3 className="w-5 h-5" /> : sortMode === 'name' ? <ArrowDownAZ className="w-5 h-5" /> : <HardDrive className="w-5 h-5" />}
                </button>
                
                <button 
                  onClick={() => {
                    const n = prompt('请输入文件夹名称:');
                    if (n) executeOperation(() => api.createFolder(current.folderId, n), '创建中...');
                  }} 
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                  <FolderPlus className="w-5 h-5" />
                </button>
                
                <button 
                  onClick={() => { setIsMultiSelectMode(!isMultiSelectMode); setSelection(new Set()); }} 
                  className={`p-2 rounded-lg transition-colors ${isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <CheckSquare className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 列表内容 */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <RefreshCw className="w-8 h-8 text-slate-300 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center h-64 text-red-400">
              <AlertTriangle className="w-10 h-10 mb-2 opacity-50" />
              <p>{loadError}</p>
              <button onClick={() => load()} className="mt-4 px-4 py-2 bg-white border rounded shadow-sm">重试</button>
            </div>
          ) : !sortedItems.length ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="p-4 bg-slate-100 rounded-full mb-3">
                <Folder className="w-10 h-10 text-slate-300" />
              </div>
              <p>空空如也</p>
            </div>
          ) : viewMode === 'grid' ? (
            // 网格视图
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 pb-20">
              {/* 上传按钮卡片 */}
              {!searchQuery && (
                <label className="flex flex-col items-center justify-center aspect-[4/5] rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-blue-50 hover:border-blue-400 cursor-pointer transition-colors group">
                  <input 
                    type="file" 
                    multiple 
                    className="hidden" 
                    onChange={e => e.target.files && executeOperation(() => api.upload(Array.from(e.target.files!), current.folderId), '上传中...')} 
                  />
                  <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
                  <span className="text-xs text-slate-500 font-medium group-hover:text-blue-600">点击上传</span>
                </label>
              )}

              {sortedItems.map(item => {
                const isSel = selection.has(item.key);
                const isDir = isFolder(item);
                return (
                  <div 
                    key={item.key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragOver={(e) => { if(isDir) { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-blue-400'); }}}
                    onDragLeave={(e) => { if(isDir) e.currentTarget.classList.remove('ring-2', 'ring-blue-400'); }}
                    onDrop={(e) => { if(isDir) handleDropOnFolder(e, item as FolderItem); }}
                    onClick={(e) => handleItemClick(e, item)}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (!isSel) setSelection(new Set([item.key]));
                      setContextMenu({ visible: true, x: e.pageX, y: e.pageY, key: item.key, type: 'item' });
                    }}
                    onDoubleClick={() => isDir ? navigate([...crumbs, { folderId: item.folderId, name: item.name, path: item.key }]) : window.open(api.getFileUrl(item.fileId))}
                    className={`group relative flex flex-col rounded-xl border bg-white p-3 shadow-sm hover:shadow-md cursor-pointer aspect-[4/5] transition-all ${isSel ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30' : 'border-slate-200 hover:border-blue-300'}`}
                  >
                    {isSel && <div className="absolute top-2 right-2 z-10"><CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" /></div>}
                    
                    <div className="flex-1 flex items-center justify-center overflow-hidden w-full rounded-lg bg-slate-50 mb-3">
                      {isDir ? (
                        <Folder className="w-16 h-16 text-blue-400 fill-blue-50" />
                      ) : item.type?.startsWith('image/') ? (
                        <LazyImg src={api.getFileUrl(item.fileId)} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                      ) : (
                        getFileIcon(item.type, "w-14 h-14")
                      )}
                    </div>
                    
                    <div className="text-center w-full">
                      <div className="text-sm font-medium text-slate-700 truncate px-1" title={item.name}>{item.name}</div>
                      <div className="text-xs text-slate-400 mt-1">{isDir ? formatTime(item.uploadedAt) : formatBytes(item.size)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            // 列表视图
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[auto,1fr,100px,150px] gap-4 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <div className="w-6">#</div>
                <div>名称</div>
                <div className="text-right">大小</div>
                <div className="text-right">修改时间</div>
              </div>
              {sortedItems.map(item => {
                const isSel = selection.has(item.key);
                const isDir = isFolder(item);
                return (
                  <div 
                    key={item.key}
                    onClick={(e) => handleItemClick(e, item)}
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (!isSel) setSelection(new Set([item.key]));
                      setContextMenu({ visible: true, x: e.pageX, y: e.pageY, key: item.key, type: 'item' });
                    }}
                    onDoubleClick={() => isDir ? navigate([...crumbs, { folderId: item.folderId, name: item.name, path: item.key }]) : window.open(api.getFileUrl(item.fileId))}
                    className={`grid grid-cols-[auto,1fr,100px,150px] gap-4 px-4 py-3 border-b border-slate-100 items-center hover:bg-slate-50 cursor-pointer text-sm transition-colors ${isSel ? 'bg-blue-50' : ''}`}
                  >
                    <div className="w-6">
                      {isSel ? <CheckCircle2 className="w-4 h-4 text-blue-600" /> : isDir ? <Folder className="w-4 h-4 text-slate-400" /> : <FileText className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="truncate font-medium text-slate-700">{item.name}</div>
                    <div className="text-right text-slate-500 text-xs">{isDir ? '-' : formatBytes(item.size)}</div>
                    <div className="text-right text-slate-400 text-xs">{formatTime(item.uploadedAt)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* --- 全局弹窗与菜单 --- */}

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(p => ({ ...p, visible: false }))} />
          <div 
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-slate-200 w-48 py-1 text-sm text-slate-700 animate-in fade-in zoom-in-95 duration-100 origin-top-left"
            style={{ top: Math.min(contextMenu.y, window.innerHeight - 200), left: Math.min(contextMenu.x, window.innerWidth - 200) }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'blank' ? (
              <>
                <button onClick={() => { setContextMenu(p => ({ ...p, visible: false })); load(current.folderId, current.path, true); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> 刷新
                </button>
                <button onClick={() => { setContextMenu(p => ({ ...p, visible: false })); const n = prompt('文件夹名:'); if(n) executeOperation(() => api.createFolder(current.folderId, n), '创建中...'); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                  <FolderPlus className="w-4 h-4" /> 新建文件夹
                </button>
                {clipboard && (
                  <button onClick={() => { setContextMenu(p => ({ ...p, visible: false })); executeOperation(async () => { await api.move(clipboard, current.folderId); setClipboard(null); }, '粘贴中...'); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2 text-blue-600">
                    <ClipboardPaste className="w-4 h-4" /> 粘贴
                  </button>
                )}
              </>
            ) : (
              <>
                {selection.size === 1 && singleSelected && !isFolder(singleSelected) && (
                  <button onClick={() => { window.open(api.getFileUrl(singleSelected.fileId)); setContextMenu(p => ({ ...p, visible: false })); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                    <Download className="w-4 h-4" /> 下载
                  </button>
                )}
                {selection.size === 1 && singleSelected && (
                  <button onClick={() => { 
                    setRenameDialog({ 
                      open: true, kind: isFolder(singleSelected) ? 'folder' : 'file', 
                      oldName: singleSelected.name, newName: singleSelected.name, 
                      folderId: current.folderId, parentId: current.folderId, 
                      folderItemId: isFolder(singleSelected) ? singleSelected.folderId : '' 
                    });
                    setContextMenu(p => ({ ...p, visible: false })); 
                  }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                    <Pencil className="w-4 h-4" /> 重命名
                  </button>
                )}
                <button onClick={() => { setInfoDrawerOpen(true); setContextMenu(p => ({ ...p, visible: false })); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                  <Info className="w-4 h-4" /> 详情
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={() => { setPickedTarget(crumbs); setMoveDialogOpen(true); setContextMenu(p => ({ ...p, visible: false })); }} className="w-full text-left px-4 py-2 hover:bg-slate-100 flex items-center gap-2">
                  <FolderInput className="w-4 h-4" /> 移动到...
                </button>
                <button onClick={() => { setDeleteConfirmOpen(true); setContextMenu(p => ({ ...p, visible: false })); }} className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> 删除
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="font-bold text-lg mb-2 text-slate-800">确认删除 {selection.size} 项?</h3>
            <p className="text-slate-500 text-sm mb-6">此操作将永久删除选中文件，无法恢复。</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setDeleteConfirmOpen(false)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-sm font-medium">取消</button>
              <button 
                onClick={() => {
                  setDeleteConfirmOpen(false);
                  const targets = Array.from(selection).map(k => itemsByKey.get(k)).filter(Boolean);
                  const delItems = targets.map(t => isFolder(t!) 
                    ? { kind: 'folder', fromFolderId: current.folderId, name: t!.name, folderId: t!.folderId } 
                    : { kind: 'file', fromFolderId: current.folderId, name: t!.name, fileId: t!.fileId }
                  ) as DeleteItem[];
                  executeOperation(() => api.batchDelete(delItems), '正在删除...');
                }} 
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重命名弹窗 */}
      {renameDialog.open && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-bold text-lg mb-4 text-slate-800">重命名</h3>
            <input 
              value={renameDialog.newName} 
              onChange={e => setRenameDialog(p => ({ ...p, newName: e.target.value }))} 
              className="w-full border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500 mb-4 text-sm" 
              autoFocus 
              onKeyDown={e => { if (e.key === 'Enter') { /* Trigger submit */ } }}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameDialog(p => ({ ...p, open: false }))} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">取消</button>
              <button 
                onClick={() => {
                  setRenameDialog(p => ({ ...p, open: false }));
                  executeOperation(() => 
                    renameDialog.kind === 'file' 
                      ? api.renameFile(renameDialog.folderId, renameDialog.oldName, renameDialog.newName)
                      : api.renameFolder(renameDialog.parentId, renameDialog.folderItemId, renameDialog.oldName, renameDialog.newName),
                    '重命名中...'
                  );
                }} 
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 移动文件弹窗 */}
      {moveDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[500px] overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800">移动到...</h3>
              <button onClick={() => setMoveDialogOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="flex-1 overflow-auto p-2 bg-slate-50">
              <FolderTree 
                shared={sharedTree} 
                mode="picker" 
                currentFolderId={current.folderId} 
                currentPath={current.path} 
                pickedFolderId={pickedTarget[pickedTarget.length - 1].folderId} 
                onPick={(fid, p, chain) => setPickedTarget(chain)}
              />
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-white">
              <button onClick={() => setMoveDialogOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">取消</button>
              <button 
                onClick={() => {
                  setMoveDialogOpen(false);
                  const targetFid = pickedTarget[pickedTarget.length - 1].folderId;
                  const moveItems = Array.from(selection).map(k => {
                    const it = itemsByKey.get(k);
                    if (!it) return null;
                    return isFolder(it)
                      ? { kind: 'folder', fromFolderId: current.folderId, folderId: it.folderId, name: it.name }
                      : { kind: 'file', fromFolderId: current.folderId, name: it.name };
                  }).filter(Boolean) as MoveItem[];
                  
                  executeOperation(() => api.move(moveItems, targetFid), '移动中...');
                }} 
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                确认移动
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 详情侧边栏 */}
      {infoDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm flex justify-end" onClick={() => setInfoDrawerOpen(false)}>
          <div className="bg-white w-full max-w-md h-full shadow-2xl p-6 overflow-y-auto animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">详细信息</h3>
              <button onClick={() => setInfoDrawerOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            {singleSelected ? (
              <div className="space-y-6">
                <div className="aspect-video bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden border border-slate-200">
                  {isFolder(singleSelected) 
                    ? <Folder className="w-24 h-24 text-blue-400 fill-blue-50" /> 
                    : singleSelected.type?.startsWith('image/') 
                      ? <img src={api.getFileUrl((singleSelected as FileItem).fileId)} className="w-full h-full object-contain" alt="" /> 
                      : getFileIcon((singleSelected as FileItem).type, "w-24 h-24")
                  }
                </div>
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between border-b border-slate-100 py-3">
                    <span className="text-slate-500">名称</span>
                    <span className="font-medium text-slate-800 truncate max-w-[200px] select-all">{singleSelected.name}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 py-3">
                    <span className="text-slate-500">类型</span>
                    <span className="text-slate-800">{isFolder(singleSelected) ? '文件夹' : singleSelected.type}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 py-3">
                    <span className="text-slate-500">大小</span>
                    <span className="text-slate-800">{isFolder(singleSelected) ? '-' : formatBytes((singleSelected as FileItem).size)}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-100 py-3">
                    <span className="text-slate-500">修改时间</span>
                    <span className="text-slate-800">{formatTime(singleSelected.uploadedAt)}</span>
                  </div>
                  
                  {!isFolder(singleSelected) && (
                    <div className="pt-4 space-y-3">
                       <button 
                         onClick={() => { navigator.clipboard.writeText(api.getFileUrl(singleSelected.fileId)); toast.success('直链已复制'); }} 
                         className="w-full py-2.5 bg-blue-50 text-blue-600 rounded-xl font-medium hover:bg-blue-100 flex items-center justify-center gap-2 transition-colors"
                       >
                         <LinkIcon className="w-4 h-4" /> 复制下载直链
                       </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                <Info className="w-12 h-12 mb-3 opacity-50" />
                <p>选择了 {selection.size} 个项目</p>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}