import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ExplorerItem, FileItem, FolderItem, MoveItem, DeleteItem } from '../lib/api';
import {
  Folder,
  FileText,
  UploadCloud,
  Trash2,
  FolderPlus,
  ArrowLeft,
  Search,
  CheckSquare,
  Link as LinkIcon,
  Scissors,
  ClipboardPaste,
  RefreshCw,
  Menu,
  CheckCircle2,
  Download,
  AlertTriangle,
  X,
  Info,
  FolderInput,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree, Crumb, SharedTreeState } from './FolderTree';

function isFolder(item: ExplorerItem): item is FolderItem {
  return (item as any).type === 'folder';
}

function formatBytes(bytes: number) {
  if (!bytes && bytes !== 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
function formatTime(ts?: number) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

type ContextMenuState = { visible: boolean; x: number; y: number; key: string | null; type: 'item' | 'blank' };

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  // 面包屑
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);
  const current = crumbs[crumbs.length - 1];
  const currentFolderId = current.folderId;
  const currentPath = current.path;

  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [clipboard, setClipboard] = useState<MoveItem[] | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>('');

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; targets: string[] }>({ isOpen: false, targets: [] });

  // 右键菜单
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, key: null, type: 'blank' });

  // 信息抽屉
  const [infoOpen, setInfoOpen] = useState(false);

  // 移动到…对话框
  const [moveToOpen, setMoveToOpen] = useState(false);
  const [pickedTarget, setPickedTarget] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);

  // 树共享缓存（最大化节省 read：侧边树 & 移动对话框共用）
  const [childrenMap, setChildrenMap] = useState<Map<string, FolderItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const nodeInfoRef = useRef<Map<string, { folderId: string; name: string; path: string }>>(new Map());

  const sharedTree: SharedTreeState = useMemo(() => ({
    childrenMap, setChildrenMap, expanded, setExpanded, nodeInfoRef
  }), [childrenMap, expanded]);

  // 精准失效树（不全刷）
  const [treeInvalidate, setTreeInvalidate] = useState<{ nonce: number; ids: string[] }>({ nonce: 0, ids: [] });
  const invalidateTree = (ids: string[]) => {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (!uniq.length) return;
    setTreeInvalidate((p) => ({ nonce: p.nonce + 1, ids: uniq }));
  };

  const itemsByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const singleSelected = useMemo(() => {
    if (selection.size !== 1) return null;
    const k = Array.from(selection)[0];
    return itemsByKey.get(k) || null;
  }, [selection, itemsByKey]);

  const load = async (folderId = currentFolderId, path = currentPath) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.list(folderId, path);
      setItems([...res.folders, ...res.files]);
      setSelection(new Set());
      setLastSelectedKey(null);
    } catch (e: any) {
      setLoadError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!api.checkAuth()) return;
    load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.checkAuth()) return;
    load(currentFolderId, currentPath).catch(() => {});
    invalidateTree(['root', currentFolderId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  const viewItems = useMemo(() => {
    let list = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = items.filter((i) => i.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const af = isFolder(a) ? 0 : 1;
      const bf = isFolder(b) ? 0 : 1;
      if (af !== bf) return af - bf;
      return (b.uploadedAt || 0) - (a.uploadedAt || 0);
    });
  }, [items, searchQuery]);

  const navigateByCrumbs = (next: Crumb[]) => {
    const last = next[next.length - 1];
    setCrumbs(next);
    setSearchQuery('');
    setShowSidebar(false);
    setSelection(new Set());
    setLastSelectedKey(null);
    load(last.folderId, last.path).catch(() => {});
  };

  const enterFolder = (folder: FolderItem) => {
    navigateByCrumbs([...crumbs, { folderId: folder.folderId, name: folder.name, path: folder.key }]);
  };

  const enterFolderFromTree = (folderId: string, path: string, chain: Crumb[]) => {
    navigateByCrumbs(chain.length ? chain : [{ folderId: 'root', name: '根目录', path: '' }, { folderId, name: '目录', path }]);
  };

  const back = () => {
    if (crumbs.length <= 1) return;
    navigateByCrumbs(crumbs.slice(0, -1));
  };

  const buildMoveItemsFromSelection = (): MoveItem[] => {
    const keys = Array.from(selection);
    const out: MoveItem[] = [];
    for (const k of keys) {
      const it = itemsByKey.get(k);
      if (!it) continue;
      if (isFolder(it)) out.push({ kind: 'folder', fromFolderId: currentFolderId, folderId: it.folderId, name: it.name });
      else out.push({ kind: 'file', fromFolderId: currentFolderId, name: it.name });
    }
    return out;
  };

  const buildDeleteItemsFromKeys = (keys: string[]): DeleteItem[] => {
    const out: DeleteItem[] = [];
    for (const k of keys) {
      const it = itemsByKey.get(k);
      if (!it) continue;
      if (isFolder(it)) out.push({ kind: 'folder', fromFolderId: currentFolderId, folderId: it.folderId, name: it.name });
      else out.push({ kind: 'file', fromFolderId: currentFolderId, name: it.name, fileId: it.fileId });
    }
    return out;
  };

  const filterNoopMoves = (moveItems: MoveItem[], targetFolderId: string) =>
    moveItems.filter((m) => m.fromFolderId !== targetFolderId);

  // ===== actions =====
  const handleCreateFolder = async () => {
    if (searchQuery) return toast.error('请先清空搜索再新建文件夹');
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const clean = name.replace(/[\/\\|]/g, '').trim();
    if (!clean) return toast.error('名称不能为空');

    const tid = toast.loading('创建中...');
    try {
      await api.createFolder(currentFolderId, clean);
      toast.dismiss(tid);
      toast.success('创建成功');
      invalidateTree([currentFolderId]);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '创建失败');
    }
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    const tid = toast.loading('上传中...');
    try {
      await api.upload(files, currentFolderId);
      toast.dismiss(tid);
      toast.success(`上传成功（${files.length} 个）`);
      invalidateTree([currentFolderId]);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '上传失败');
    }
  };

  const initiateDelete = (keys: string[] = []) => {
    const targets = keys.length ? keys : Array.from(selection);
    if (!targets.length) return;
    setDeleteConfirm({ isOpen: true, targets });
  };

  const executeDelete = async () => {
    const keys = deleteConfirm.targets;
    setDeleteConfirm({ isOpen: false, targets: [] });
    const tid = toast.loading('正在删除...');
    try {
      await api.batchDelete(buildDeleteItemsFromKeys(keys));
      toast.dismiss(tid);
      toast.success('删除成功');
      invalidateTree([currentFolderId]);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '删除失败');
    }
  };

  const handleCut = () => {
    const m = buildMoveItemsFromSelection();
    if (!m.length) return;
    setClipboard(m);
    setSelection(new Set());
    toast.success('已剪切：到目标目录点击“粘贴”即可移动');
  };

  const handlePaste = async () => {
    if (!clipboard?.length) return;
    const filtered = filterNoopMoves(clipboard, currentFolderId);
    if (!filtered.length) {
      toast('目标就是当前目录，无需移动');
      setClipboard(null);
      return;
    }
    const tid = toast.loading('正在移动...');
    try {
      await api.move(filtered, currentFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');
      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([currentFolderId, ...fromIds]);
      setClipboard(null);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    }
  };

  const handleCopyLink = async (key: string) => {
    const it = itemsByKey.get(key);
    if (!it || isFolder(it)) return;
    try {
      await navigator.clipboard.writeText(api.getFileUrl(it.fileId));
      toast.success('直链已复制');
    } catch {
      toast.error('复制失败（浏览器权限限制）');
    }
  };

  const handleOpen = (key: string) => {
    const it = itemsByKey.get(key);
    if (!it || isFolder(it)) return;
    window.open(api.getFileUrl(it.fileId), '_blank');
  };

  const openMoveToDialog = () => {
    if (selection.size === 0) return;
    setPickedTarget(crumbs); // 默认目标：当前目录（更符合直觉）
    setMoveToOpen(true);
  };

  const confirmMoveTo = async () => {
    const target = pickedTarget[pickedTarget.length - 1];
    const moveItems = buildMoveItemsFromSelection();
    const filtered = filterNoopMoves(moveItems, target.folderId);

    if (!filtered.length) {
      toast('目标就是原目录，无需移动');
      setMoveToOpen(false);
      return;
    }

    const tid = toast.loading('正在移动...');
    try {
      await api.move(filtered, target.folderId);
      toast.dismiss(tid);
      toast.success('移动成功');
      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([target.folderId, ...fromIds]);
      setMoveToOpen(false);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    }
  };

  // ===== click / select =====
  const handleItemClick = (e: React.MouseEvent, item: ExplorerItem) => {
    e.stopPropagation();

    if (isMultiSelectMode || e.ctrlKey || e.metaKey) {
      const ns = new Set(selection);
      ns.has(item.key) ? ns.delete(item.key) : ns.add(item.key);
      setSelection(ns);
      setLastSelectedKey(item.key);
      return;
    }

    if (e.shiftKey && lastSelectedKey) {
      const idx1 = viewItems.findIndex((i) => i.key === lastSelectedKey);
      const idx2 = viewItems.findIndex((i) => i.key === item.key);
      if (idx1 !== -1 && idx2 !== -1) {
        const range = viewItems.slice(Math.min(idx1, idx2), Math.max(idx1, idx2) + 1);
        setSelection(new Set(range.map((i) => i.key)));
      }
      return;
    }

    if (isFolder(item)) enterFolder(item);
    else {
      setSelection(new Set([item.key]));
      setLastSelectedKey(item.key);
    }
  };

  // 拖拽：携带 moveItems（不增加 KV）
  const handleDragStart = (e: React.DragEvent, item: ExplorerItem) => {
    const keys = selection.has(item.key) ? Array.from(selection) : [item.key];
    const moveItems: MoveItem[] = [];
    for (const k of keys) {
      const it = itemsByKey.get(k);
      if (!it) continue;
      if (isFolder(it)) moveItems.push({ kind: 'folder', fromFolderId: currentFolderId, folderId: it.folderId, name: it.name });
      else moveItems.push({ kind: 'file', fromFolderId: currentFolderId, name: it.name });
    }
    e.dataTransfer.setData('application/json', JSON.stringify({ moveItems }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null);
  const handleDropToFolderTile = async (e: React.DragEvent, target: FolderItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderKey(null);

    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      const moveItems = Array.isArray(parsed?.moveItems) ? (parsed.moveItems as MoveItem[]) : [];
      if (!moveItems.length) return;

      const filtered = filterNoopMoves(moveItems, target.folderId);
      if (!filtered.length) return toast('目标就是原目录，无需移动');

      const tid = toast.loading('正在移动...');
      await api.move(filtered, target.folderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([target.folderId, ...fromIds]);

      await load();
    } catch (err: any) {
      toast.error(err?.message || '移动失败');
    }
  };

  const handleDropToFolderId = async (moveItems: MoveItem[], targetFolderId: string) => {
    const filtered = filterNoopMoves(moveItems, targetFolderId);
    if (!filtered.length) return toast('目标就是原目录，无需移动');

    const tid = toast.loading('正在移动...');
    try {
      await api.move(filtered, targetFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([targetFolderId, ...fromIds]);

      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    }
  };

  // ===== keyboard =====
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase() || '')) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(viewItems.map((i) => i.key)));
      }
      if (e.key === 'Escape') {
        setSelection(new Set());
        setIsMultiSelectMode(false);
        setDeleteConfirm({ isOpen: false, targets: [] });
        setContextMenu((p) => ({ ...p, visible: false }));
        setMoveToOpen(false);
        setInfoOpen(false);
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size > 0) initiateDelete();
      }
      // I 打开详情（纯前端）
      if (e.key.toLowerCase() === 'i' && selection.size === 1) {
        setInfoOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, viewItems]);

  // ===== empty tips =====
  const emptyTip = useMemo(() => {
    if (loading || loadError) return '';
    if (searchQuery && viewItems.length === 0) return '没有找到匹配结果（仅搜索当前目录）';
    if (!searchQuery && viewItems.length === 0) return '这里还没有文件。拖拽文件到此处即可上传。';
    return '';
  }, [loading, loadError, searchQuery, viewItems.length]);

  // ===== context menu helpers =====
  const openContextMenuBlank = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.pageX, y: e.pageY, key: null, type: 'blank' });
  };
  const openContextMenuItem = (e: React.MouseEvent, item: ExplorerItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.has(item.key)) setSelection(new Set([item.key]));
    setContextMenu({ visible: true, x: e.pageX, y: e.pageY, key: item.key, type: 'item' });
  };
  useEffect(() => {
    const close = () => setContextMenu((p) => ({ ...p, visible: false }));
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col sm:flex-row select-none relative">
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}

      {/* Sidebar tree */}
      <div className={`absolute sm:relative z-40 w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100 ${showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'} flex-shrink-0`}>
        <FolderTree
          shared={sharedTree}
          refreshNonce={refreshNonce}
          invalidateNonce={treeInvalidate.nonce}
          invalidateFolderIds={treeInvalidate.ids}
          currentFolderId={currentFolderId}
          currentPath={currentPath}
          onNavigate={enterFolderFromTree}
          onMove={handleDropToFolderId}
          enableDnD
          mode="navigator"
        />
      </div>

      {/* Main */}
      <div
        className="flex-1 flex flex-col min-w-0 bg-white"
        onContextMenu={openContextMenuBlank}
        onClick={() => !isMultiSelectMode && setSelection(new Set())}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) handleUpload(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Top bar */}
        <div className="px-4 py-3 border-b border-slate-100 flex gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
            <button className="sm:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full" onClick={() => setShowSidebar(true)} title="目录">
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); back(); }}
              disabled={crumbs.length <= 1}
              className={`p-2 rounded-lg transition-all ${crumbs.length > 1 ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
              title="返回上级"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 text-sm min-w-0">
              {crumbs.map((c, idx) => {
                const active = idx === crumbs.length - 1;
                return (
                  <div key={c.folderId} className="flex items-center min-w-0">
                    {idx !== 0 && <span className="text-slate-300 px-1">/</span>}
                    <button
                      className={`truncate max-w-[140px] px-2 py-1 rounded-md ${active ? 'text-slate-800 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}
                      title={c.path || '根目录'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (active) return;
                        navigateByCrumbs(crumbs.slice(0, idx + 1));
                      }}
                    >
                      {c.name || '根目录'}
                    </button>
                  </div>
                );
              })}
            </div>

            {loading && <span className="text-xs text-slate-400 ml-2">加载中...</span>}
          </div>

          {/* actions */}
          <div className="flex items-center gap-2">
            {selection.size > 0 ? (
              <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100">
                {selection.size === 1 && !Array.from(selection)[0].endsWith('/') && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); handleOpen(Array.from(selection)[0]); }}
                      className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600" title="打开/下载">
                      <Download className="w-4 h-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleCopyLink(Array.from(selection)[0]); }}
                      className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600" title="复制直链">
                      <LinkIcon className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button onClick={(e) => { e.stopPropagation(); setInfoOpen(true); }}
                  className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-slate-900" title="详情 (I)">
                  <Info className="w-4 h-4" />
                </button>

                <button onClick={(e) => { e.stopPropagation(); handleCut(); }}
                  className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-orange-600" title="剪切">
                  <Scissors className="w-4 h-4" />
                </button>

                <button onClick={(e) => { e.stopPropagation(); openMoveToDialog(); }}
                  className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600" title="移动到...">
                  <FolderInput className="w-4 h-4" />
                </button>

                <div className="w-px h-4 bg-slate-200 mx-1"></div>

                <button onClick={(e) => { e.stopPropagation(); initiateDelete(); }}
                  className="p-2 hover:bg-white rounded-md text-red-600 hover:bg-red-50" title="删除">
                  <Trash2 className="w-4 h-4" />
                </button>

                <span className="px-2 text-xs text-slate-400 font-medium">{selection.size}</span>
              </div>
            ) : (
              <>
                {clipboard && (
                  <button onClick={(e) => { e.stopPropagation(); handlePaste(); }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 text-xs font-medium"
                    title="把剪切的项目移动到当前目录">
                    <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                  </button>
                )}

                <div className="relative group hidden md:block">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索(当前目录)..."
                    className="w-[180px] pl-9 pr-9 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {searchQuery && (
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 text-slate-500"
                      onClick={(e) => { e.stopPropagation(); setSearchQuery(''); }}
                      title="清空搜索"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }}
                  className="p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors" title="新建文件夹">
                  <FolderPlus className="w-5 h-5" />
                </button>

                <button onClick={(e) => { e.stopPropagation(); setIsMultiSelectMode(!isMultiSelectMode); if (isMultiSelectMode) setSelection(new Set()); }}
                  className={`p-2 rounded-lg transition-all ${isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} title="多选模式">
                  <CheckSquare className="w-5 h-5" />
                </button>

                <button onClick={(e) => { e.stopPropagation(); load().then(() => toast.success('已刷新')); invalidateTree([currentFolderId]); }}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="刷新当前目录">
                  <RefreshCw className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* error bar */}
        {loadError && (
          <div className="px-4 py-2 border-b border-slate-100 bg-red-50 text-red-700 text-sm flex items-center justify-between">
            <span>加载失败：{loadError}</span>
            <button className="px-3 py-1 rounded bg-white border border-red-200 hover:bg-red-100" onClick={() => load()}>
              重试
            </button>
          </div>
        )}

        {/* grid */}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start flex-1 bg-slate-50/30 overflow-y-auto">
          {!searchQuery && (
            <label
              className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 cursor-pointer group transition-all aspect-[3/4]"
              onClick={(e) => e.stopPropagation()}
              title="点击选择文件上传，或拖拽到页面任意位置"
            >
              <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(Array.from(e.target.files))} />
              <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
              <span className="text-xs text-slate-500 font-medium">上传</span>
            </label>
          )}

          {emptyTip && (
            <div className="col-span-full flex items-center justify-center py-10">
              <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
                {emptyTip}
              </div>
            </div>
          )}

          {viewItems.map((item) => {
            const selected = selection.has(item.key);
            const draggingOver = dragOverFolderKey === item.key;

            const fileThumb =
              !isFolder(item) && item.type?.startsWith('image/')
                ? api.getFileUrl((item as FileItem).fileId)
                : '';

            return (
              <div
                key={item.key}
                draggable
                onDragStart={(e) => handleDragStart(e, item)}
                onDragOver={(e) => {
                  if (isFolder(item)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverFolderKey(item.key);
                  }
                }}
                onDragLeave={() => setDragOverFolderKey(null)}
                onDrop={isFolder(item) ? (e) => handleDropToFolderTile(e, item as FolderItem) : undefined}
                onContextMenu={(e) => openContextMenuItem(e, item)}
                onClick={(e) => handleItemClick(e, item)}
                onDoubleClick={() => { if (!isFolder(item)) window.open(api.getFileUrl((item as FileItem).fileId), '_blank'); }}
                className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-[3/4]
                  ${
                    selected
                      ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10'
                      : draggingOver
                      ? 'border-blue-500 bg-blue-100 scale-105 shadow-md'
                      : 'border-transparent hover:bg-white hover:shadow-md'
                  }`}
                title={item.key}
              >
                {(selected || isMultiSelectMode) && (
                  <div className="absolute top-2 right-2 z-20 pointer-events-none">
                    {selected ? <CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white/80" />}
                  </div>
                )}

                <div className="flex-1 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                  {isFolder(item) ? (
                    <Folder className="w-16 h-16 text-blue-400/90 fill-blue-100" />
                  ) : fileThumb ? (
                    <img src={fileThumb} className="w-full h-full object-contain rounded shadow-sm" loading="lazy" />
                  ) : (
                    <FileText className="w-14 h-14 text-slate-400" />
                  )}
                </div>

                <div className="w-full text-center px-0.5 mt-2">
                  <div className={`text-xs font-medium truncate w-full ${selected ? 'text-blue-700' : 'text-slate-700'}`}>{item.name}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ========= Right click menu ========= */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-white/95 backdrop-blur rounded-lg shadow-xl border border-slate-100 w-48 py-1 overflow-hidden"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'blank' ? (
            <>
              {clipboard && (
                <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"
                  onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); handlePaste(); }}>
                  <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                </button>
              )}
              <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); load(); }}>
                <RefreshCw className="w-3.5 h-3.5" /> 刷新
              </button>
              <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); handleCreateFolder(); }}>
                <FolderPlus className="w-3.5 h-3.5" /> 新建文件夹
              </button>
            </>
          ) : (
            <>
              {selection.size === 1 && singleSelected && !isFolder(singleSelected) && (
                <>
                  <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"
                    onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); handleOpen(singleSelected.key); }}>
                    <Download className="w-3.5 h-3.5" /> 打开/下载
                  </button>
                  <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"
                    onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); handleCopyLink(singleSelected.key); }}>
                    <LinkIcon className="w-3.5 h-3.5" /> 复制直链
                  </button>
                </>
              )}

              <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); setInfoOpen(true); }}>
                <Info className="w-3.5 h-3.5" /> 详情
              </button>

              <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); handleCut(); }}>
                <Scissors className="w-3.5 h-3.5" /> 剪切
              </button>

              <button className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); openMoveToDialog(); }}>
                <FolderInput className="w-3.5 h-3.5" /> 移动到...
              </button>

              <button className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex gap-2"
                onClick={() => { setContextMenu((p) => ({ ...p, visible: false })); initiateDelete(); }}>
                <Trash2 className="w-3.5 h-3.5" /> 删除
              </button>
            </>
          )}
        </div>
      )}

      {/* ========= Move To Dialog ========= */}
      {moveToOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={() => setMoveToOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-4 border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-2">
              <div>
                <div className="text-base font-bold text-slate-800">移动到...</div>
                <div className="text-xs text-slate-500 mt-1">已选中 {selection.size} 项</div>
              </div>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" onClick={() => setMoveToOpen(false)} title="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-2 pb-2">
              <div className="text-xs text-slate-500 mb-2">目标目录：</div>
              <div className="flex items-center flex-wrap gap-1 text-sm bg-slate-50 border border-slate-200 rounded-lg p-2">
                {pickedTarget.map((c, idx) => (
                  <div key={c.folderId} className="flex items-center">
                    {idx !== 0 && <span className="text-slate-300 px-1">/</span>}
                    <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700">{c.name || '根目录'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-[360px] border border-slate-100 rounded-xl overflow-hidden mx-2">
              <FolderTree
                shared={sharedTree}
                currentFolderId={currentFolderId}
                currentPath={currentPath}
                mode="picker"
                pickedFolderId={pickedTarget[pickedTarget.length - 1].folderId}
                onPick={(fid, path, chain) => setPickedTarget(chain)}
                enableDnD={false}
              />
            </div>

            <div className="flex justify-end gap-2 px-2 pt-4">
              <button className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                onClick={() => setMoveToOpen(false)}>
                取消
              </button>
              <button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
                onClick={confirmMoveTo}>
                确认移动
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========= Info Drawer ========= */}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setInfoOpen(false)}>
          <div className="w-full max-w-md h-full bg-white shadow-2xl border-l border-slate-200 p-4 overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold text-slate-800">详情</div>
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" onClick={() => setInfoOpen(false)} title="关闭">
                <X className="w-5 h-5" />
              </button>
            </div>

            {selection.size !== 1 || !singleSelected ? (
              <div className="mt-6 text-sm text-slate-500">请选择 1 个文件或文件夹查看详情。</div>
            ) : isFolder(singleSelected) ? (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-slate-700"><span className="text-slate-400">类型：</span> 文件夹</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">名称：</span> {singleSelected.name}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">路径：</span> {singleSelected.key}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">folderId：</span> {singleSelected.folderId}</div>

                <div className="flex gap-2 pt-2">
                  <button className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200"
                    onClick={() => { navigator.clipboard.writeText(singleSelected.key); toast.success('路径已复制'); }}>
                    复制路径
                  </button>
                  <button className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200"
                    onClick={() => { navigator.clipboard.writeText(singleSelected.folderId); toast.success('folderId 已复制'); }}>
                    复制 folderId
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-slate-700"><span className="text-slate-400">类型：</span> 文件</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">名称：</span> {singleSelected.name}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">路径：</span> {singleSelected.key}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">MIME：</span> {singleSelected.type || '-'}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">大小：</span> {formatBytes(singleSelected.size)}</div>
                <div className="text-sm text-slate-700"><span className="text-slate-400">上传时间：</span> {formatTime(singleSelected.uploadedAt)}</div>
                <div className="text-sm text-slate-700 break-all"><span className="text-slate-400">fileId：</span> {singleSelected.fileId}</div>
                <div className="text-sm text-slate-700 break-all"><span className="text-slate-400">直链：</span> {api.getFileUrl(singleSelected.fileId)}</div>

                {singleSelected.type?.startsWith('image/') && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-400 mb-1">预览</div>
                    <img src={api.getFileUrl(singleSelected.fileId)} className="w-full max-h-64 object-contain rounded-lg border border-slate-200 bg-slate-50" />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <button className="px-3 py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => window.open(api.getFileUrl(singleSelected.fileId), '_blank')}>
                    打开/下载
                  </button>
                  <button className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200"
                    onClick={() => { navigator.clipboard.writeText(api.getFileUrl(singleSelected.fileId)); toast.success('直链已复制'); }}>
                    复制直链
                  </button>
                  <button className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200"
                    onClick={() => { navigator.clipboard.writeText(singleSelected.fileId); toast.success('fileId 已复制'); }}>
                    复制 fileId
                  </button>
                  <button className="px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200"
                    onClick={() => { navigator.clipboard.writeText(singleSelected.key); toast.success('路径已复制'); }}>
                    复制路径
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========= Delete Confirm ========= */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteConfirm({ isOpen: false, targets: [] })}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">确认删除?</h3>
                <p className="text-sm text-slate-500 mt-2">
                  即将删除 {deleteConfirm.targets.length} 项。<br />
                  <span className="text-red-500 font-medium">此操作不可恢复。</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full mt-2">
                <button onClick={() => setDeleteConfirm({ isOpen: false, targets: [] })}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl">
                  取消
                </button>
                <button onClick={executeDelete}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl">
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
