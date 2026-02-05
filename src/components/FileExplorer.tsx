// src/components/FileExplorer.tsx
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
  List as ListIcon,
  LayoutGrid,
  ArrowDownAZ,
  Clock3,
  HardDrive,
  CheckCheck,
  Replace,
  Pencil,
  MoreHorizontal,
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
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function formatTime(ts?: number) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString();
}

function formatTimeShort(ts?: number) {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ====== 极致缩略图：只有进入视口才设置 src（更省 /file reads） ======
function LazyImg({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!('IntersectionObserver' in window)) {
      setReady(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setReady(true);
            io.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin: '150px', threshold: 0.01 }
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <img ref={ref} src={ready ? src : ''} alt={alt || ''} className={className} loading="lazy" />;
}

type ContextMenuState = { visible: boolean; x: number; y: number; key: string | null; type: 'item' | 'blank' };
type ViewMode = 'grid' | 'list';
type SortMode = 'time' | 'name' | 'size';

const LS_LAST_CRUMBS = 'last_crumbs_v1';
const LS_RECENT_CRUMBS = 'recent_crumbs_v1';

const MAX_UPLOAD_FILES = 200;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

// 统一一点“情绪价值”与可用性：按下反馈 + 键盘 focus 可见（纯 CSS，不影响性能）
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';
const PRESS_FEEL = 'active:scale-[0.98]';
const ICON_BTN_BASE = `inline-flex items-center justify-center ${FOCUS_RING} ${PRESS_FEEL}`;

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  // ====== crumbs ======
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);
  const current = crumbs[crumbs.length - 1];
  const currentFolderId = current.folderId;
  const currentPath = current.path;

  const [recentCrumbs, setRecentCrumbs] = useState<Crumb[][]>([]);

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

  const [isMoving, setIsMoving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, key: null, type: 'blank' });
  const [infoOpen, setInfoOpen] = useState(false);

  const [moveToOpen, setMoveToOpen] = useState(false);
  const [pickedTarget, setPickedTarget] = useState<Crumb[]>([{ folderId: 'root', name: '根目录', path: '' }]);

  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    kind: 'file' | 'folder';
    oldName: string;
    newName: string;
    folderId: string;
    parentId: string;
    folderItemId?: string;
  }>({ open: false, kind: 'file', oldName: '', newName: '', folderId: 'root', parentId: 'root' });

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortMode, setSortMode] = useState<SortMode>('time');

  // ===== shared tree =====
  const [childrenMap, setChildrenMap] = useState<Map<string, FolderItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const nodeInfoRef = useRef<Map<string, { folderId: string; name: string; path: string }>>(new Map());
  const sharedTree: SharedTreeState = useMemo(
    () => ({ childrenMap, setChildrenMap, expanded, setExpanded, nodeInfoRef }),
    [childrenMap, expanded]
  );

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

  const clearSelection = () => {
    setSelection(new Set());
    setLastSelectedKey(null);
  };

  // ===== 操作后短暂高亮（纯 UI）=====
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());
  const flashTimerRef = useRef<number | null>(null);
  const flash = (keys: string[]) => {
    const uniq = Array.from(new Set(keys.filter(Boolean)));
    if (!uniq.length) return;

    setFlashKeys(new Set(uniq));
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashKeys(new Set()), 1200);
  };
  useEffect(() => {
    return () => {
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // ===== LocalStorage 最近/上次 =====
  const saveLastCrumbs = (c: Crumb[]) => {
    try {
      localStorage.setItem(LS_LAST_CRUMBS, JSON.stringify(c));
    } catch {}
  };

  const pushRecent = (c: Crumb[]) => {
    try {
      const raw = localStorage.getItem(LS_RECENT_CRUMBS);
      const list: Crumb[][] = raw ? JSON.parse(raw) : [];
      const key = (x: Crumb[]) => (x && x.length ? x[x.length - 1].folderId : '');
      const k = key(c);
      const next = [c, ...list.filter((x) => key(x) !== k)].slice(0, 8);
      localStorage.setItem(LS_RECENT_CRUMBS, JSON.stringify(next));
      setRecentCrumbs(next);
    } catch {}
  };

  const loadRecent = () => {
    try {
      const raw = localStorage.getItem(LS_RECENT_CRUMBS);
      setRecentCrumbs(raw ? JSON.parse(raw) : []);
    } catch {
      setRecentCrumbs([]);
    }
  };

  const removeRecentByLastFolderId = (fid: string) => {
    try {
      const raw = localStorage.getItem(LS_RECENT_CRUMBS);
      const list: Crumb[][] = raw ? JSON.parse(raw) : [];
      const next = list.filter((x) => (x?.length ? x[x.length - 1].folderId : '') !== fid);
      localStorage.setItem(LS_RECENT_CRUMBS, JSON.stringify(next));
      setRecentCrumbs(next);
    } catch {}
  };

  // ===== load：seq + AbortController + bypassCache（配合 api.list 短 TTL 缓存）=====
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = async (folderId = currentFolderId, path = currentPath, opts?: { bypassCache?: boolean }) => {
    if (loadAbortRef.current) loadAbortRef.current.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    const seq = ++loadSeqRef.current;

    setLoading(true);
    setLoadError('');
    try {
      const res = await api.list(folderId, path, { signal: controller.signal, bypassCache: !!opts?.bypassCache });
      if (seq !== loadSeqRef.current) return;
      setItems([...res.folders, ...res.files]);
      clearSelection();
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      if (seq !== loadSeqRef.current) return;
      setLoadError(e?.message || '加载失败');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (loadAbortRef.current) loadAbortRef.current.abort();
    };
  }, []);

  // ===== 可靠跳转：按 folderId 解析最新 crumbs 再进入 =====
  const navigateToFolderIdResolved = async (folderId: string, opts?: { silent?: boolean }) => {
    setSearchQuery('');
    setShowSidebar(false);
    clearSelection();

    try {
      const chain = await api.crumbs(folderId);
      if (!chain.length) throw new Error('Bad crumbs');
      const last = chain[chain.length - 1];
      setCrumbs(chain as any);
      await load(last.folderId, last.path);
    } catch {
      if (!opts?.silent) toast.error('该目录已不存在或无法访问，已从最近目录移除');
      removeRecentByLastFolderId(folderId);
      setCrumbs([{ folderId: 'root', name: '根目录', path: '' }]);
      await load('root', '', { bypassCache: true });
    }
  };

  // ===== 启动恢复 =====
  useEffect(() => {
    loadRecent();

    const tryRestore = async () => {
      if (!api.checkAuth()) return;

      let restored: Crumb[] | null = null;
      try {
        const raw = localStorage.getItem(LS_LAST_CRUMBS);
        restored = raw ? JSON.parse(raw) : null;
      } catch {}

      if (!restored || !Array.isArray(restored) || restored.length === 0) {
        await load().catch(() => {});
        return;
      }

      const last = restored[restored.length - 1];
      await navigateToFolderIdResolved(last.folderId, { silent: true }).catch(async () => {
        setCrumbs([{ folderId: 'root', name: '根目录', path: '' }]);
        await load('root', '', { bypassCache: true }).catch(() => {});
      });
    };

    tryRestore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部刷新：用户预期“强制最新” -> bypassCache
  useEffect(() => {
    if (!api.checkAuth()) return;
    load(currentFolderId, currentPath, { bypassCache: true }).catch(() => {});
    invalidateTree(['root', currentFolderId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  // crumbs 变化：存 last + recent
  useEffect(() => {
    saveLastCrumbs(crumbs);
    pushRecent(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crumbs]);

  const navigateByCrumbs = (next: Crumb[]) => {
    const last = next[next.length - 1];
    setCrumbs(next);
    setSearchQuery('');
    setShowSidebar(false);
    clearSelection();
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

  // ===== optimistic helpers =====
  const removeKeysFromItems = (keys: string[]) => {
    const s = new Set(keys);
    if (s.size === 0) return;
    setItems((prev) => prev.filter((it) => !s.has(it.key)));
    setSelection((prev) => {
      const next = new Set(prev);
      for (const k of s) next.delete(k);
      return next;
    });
    setLastSelectedKey((prev) => (prev && s.has(prev) ? null : prev));
  };

  const addOrReplaceItems = (newItems: ExplorerItem[]) => {
    if (!newItems.length) return;
    setItems((prev) => {
      const map = new Map<string, ExplorerItem>();
      for (const it of prev) map.set(it.key, it);
      for (const it of newItems) map.set(it.key, it);
      return Array.from(map.values());
    });
  };

  const renameKeyInSelection = (oldKey: string, newKey: string) => {
    setSelection((prev) => {
      if (!prev.has(oldKey)) return prev;
      const next = new Set(prev);
      next.delete(oldKey);
      next.add(newKey);
      return next;
    });
    setLastSelectedKey((prev) => (prev === oldKey ? newKey : prev));
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

  const filterNoopMoves = (moveItems: MoveItem[], targetFolderId: string) => moveItems.filter((m) => m.fromFolderId !== targetFolderId);

  const keyFromNameKind = (name: string, kind: 'file' | 'folder') => {
    const n = (name || '').trim();
    if (!n) return '';
    return kind === 'folder' ? `${currentPath}${n}/` : `${currentPath}${n}`;
  };

  // ===== 视图/排序 =====
  const sortedItems = useMemo(() => {
    let list = items;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = items.filter((i) => i.name.toLowerCase().includes(q));
    }

    const folders = list.filter(isFolder);
    const files = list.filter((x) => !isFolder(x)) as FileItem[];

    const sortFiles = (arr: FileItem[]) => {
      if (sortMode === 'name') return arr.sort((a, b) => a.name.localeCompare(b.name));
      if (sortMode === 'size') return arr.sort((a, b) => (b.size || 0) - (a.size || 0));
      return arr.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
    };
    const sortFolders = (arr: FolderItem[]) => arr.sort((a, b) => a.name.localeCompare(b.name));

    return [...sortFolders([...folders]), ...sortFiles([...files])];
  }, [items, searchQuery, sortMode]);

  // ===== 全选/反选 =====
  const selectAll = () => setSelection(new Set(sortedItems.map((i) => i.key)));
  const invertSelection = () => {
    const ns = new Set<string>();
    for (const it of sortedItems) if (!selection.has(it.key)) ns.add(it.key);
    setSelection(ns);
  };

  // ===== Skeleton（仅首次/空数据加载中显示，不覆盖已有列表刷新体验）=====
  const showSkeleton = loading && !loadError && items.length === 0;

  const GridSkeleton = () => (
    <>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={`skg-${i}`}
          className="animate-pulse flex flex-col items-center p-2 rounded-xl border border-transparent bg-white/60 aspect-square sm:aspect-[3/4] pointer-events-none"
        >
          <div className="flex-1 w-full rounded-lg bg-slate-200/70" />
          <div className="w-full mt-2 px-1">
            <div className="h-3 w-4/5 bg-slate-200/70 rounded" />
          </div>
        </div>
      ))}
    </>
  );

  const ListSkeleton = () => (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={`skl-${i}`}
          className="animate-pulse grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr),120px,160px] gap-2 px-3 py-2 text-sm border-b border-slate-100"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-4 h-4 bg-slate-200/80 rounded" />
            <div className="h-3 w-48 max-w-[60%] bg-slate-200/80 rounded" />
          </div>
          <div className="hidden sm:flex justify-end">
            <div className="h-3 w-10 bg-slate-200/80 rounded" />
          </div>
          <div className="hidden sm:flex justify-end">
            <div className="h-3 w-20 bg-slate-200/80 rounded" />
          </div>
        </div>
      ))}
    </>
  );

  // ===== context menu positioning + "⋯" 入口 =====
  const clampMenuPos = (x: number, y: number) => {
    const MENU_W = 208;
    const MENU_H = 260;
    const pad = 8;
    const maxX = Math.max(pad, window.innerWidth - MENU_W - pad);
    const maxY = Math.max(pad, window.innerHeight - MENU_H - pad);
    return { x: Math.min(Math.max(x, pad), maxX), y: Math.min(Math.max(y, pad), maxY) };
  };

  const openContextMenuBlank = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = clampMenuPos(e.clientX, e.clientY);
    setContextMenu({ visible: true, x: p.x, y: p.y, key: null, type: 'blank' });
  };

  const openContextMenuItem = (e: React.MouseEvent, item: ExplorerItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.has(item.key)) {
      setSelection(new Set([item.key]));
      setLastSelectedKey(item.key);
    }
    const p = clampMenuPos(e.clientX, e.clientY);
    setContextMenu({ visible: true, x: p.x, y: p.y, key: item.key, type: 'item' });
  };

  const openItemMenuFromButton = (e: React.MouseEvent, item: ExplorerItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selection.has(item.key)) {
      setSelection(new Set([item.key]));
      setLastSelectedKey(item.key);
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = clampMenuPos(rect.right, rect.bottom);
    setContextMenu({ visible: true, x: p.x, y: p.y, key: item.key, type: 'item' });
  };

  useEffect(() => {
    const close = () => setContextMenu((p) => ({ ...p, visible: false }));
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, []);

  // ===== actions =====

  // 1) create folder：完全 optimistic（不 /api/list）
  const handleCreateFolder = async () => {
    if (searchQuery) return toast.error('请先清空搜索再新建文件夹');
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const clean = name.replace(/[\/\\|]/g, '').trim();
    if (!clean) return toast.error('名称不能为空');

    const tid = toast.loading('创建中...');
    try {
      const res = await api.createFolder(currentFolderId, clean);
      toast.dismiss(tid);
      toast.success(res.existed ? '已存在' : '创建成功');

      const finalName = (res.name || clean).trim();
      const folderKey = `${currentPath}${finalName}/`;

      const folderItem: FolderItem = {
        key: folderKey,
        folderId: res.folderId,
        name: finalName,
        type: 'folder',
        size: 0,
        uploadedAt: Date.now(),
        fileId: null,
      };

      addOrReplaceItems([folderItem]);
      flash([folderKey]);

      api.invalidateListCache(currentFolderId, currentPath);
      invalidateTree([currentFolderId]);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '创建失败');
    }
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    if (isUploading) return;

    if (files.length > MAX_UPLOAD_FILES) {
      toast.error(`一次最多上传 ${MAX_UPLOAD_FILES} 个文件`);
      return;
    }

    const tooLarge = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooLarge.length) {
      toast.error(`有 ${tooLarge.length} 个文件超过 24MB，已取消上传`);
      return;
    }

    setIsUploading(true);
    const tid = toast.loading('上传中...');
    try {
      const res = await api.upload(files, currentFolderId);
      toast.dismiss(tid);
      toast.success(`上传成功（${files.length} 个）`);

      const added: FileItem[] = (res.uploaded || []).map((u) => ({
        key: `${currentPath}${u.name}`,
        name: u.name,
        fileId: u.fileId,
        type: u.type || 'application/octet-stream',
        size: u.size || 0,
        uploadedAt: u.uploadedAt || Date.now(),
      }));

      addOrReplaceItems(added);
      clearSelection();
      flash(added.map((x) => x.key));

      api.invalidateListCache(currentFolderId, currentPath);
      invalidateTree([currentFolderId]);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '上传失败');
    } finally {
      setIsUploading(false);
    }
  };

  const initiateDelete = (keys: string[] = []) => {
    const targets = keys.length ? keys : Array.from(selection);
    if (!targets.length) return;
    setDeleteConfirm({ isOpen: true, targets });
  };

  const executeDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);

    const keys = deleteConfirm.targets;
    setDeleteConfirm({ isOpen: false, targets: [] });

    const tid = toast.loading('正在删除...');
    try {
      await api.batchDelete(buildDeleteItemsFromKeys(keys));
      toast.dismiss(tid);
      toast.success('删除成功');

      removeKeysFromItems(keys);
      clearSelection();

      api.invalidateListCache(currentFolderId, currentPath);
      invalidateTree([currentFolderId]);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '删除失败');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCut = () => {
    const m = buildMoveItemsFromSelection();
    if (!m.length) return;
    setClipboard(m);
    clearSelection();
    toast.success('已剪切：到目标目录点击“粘贴”即可移动');
  };

  const handlePaste = async () => {
    if (!clipboard?.length) return;
    if (isMoving) return;
    setIsMoving(true);

    const filtered = filterNoopMoves(clipboard, currentFolderId);
    if (!filtered.length) {
      toast('目标就是当前目录，无需移动');
      setClipboard(null);
      setIsMoving(false);
      return;
    }

    const tid = toast.loading('正在移动...');
    try {
      const res = await api.move(filtered, currentFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([currentFolderId, ...fromIds]);

      const addedFiles: FileItem[] = (res.targetAdded?.files || []).map((u) => ({
        key: `${currentPath}${u.name}`,
        name: u.name,
        fileId: u.fileId,
        type: u.type || 'application/octet-stream',
        size: u.size || 0,
        uploadedAt: u.uploadedAt || Date.now(),
      }));

      const addedFolders: FolderItem[] = (res.targetAdded?.folders || []).map((f) => ({
        key: `${currentPath}${f.name}/`,
        name: f.name,
        type: 'folder',
        size: 0,
        uploadedAt: Date.now(),
        folderId: f.folderId,
        fileId: null,
      }));

      addOrReplaceItems([...addedFolders, ...addedFiles]);
      clearSelection();
      flash([...addedFolders, ...addedFiles].map((x) => x.key));

      setClipboard(null);

      api.invalidateListCache(currentFolderId, currentPath);
      for (const id of fromIds) api.invalidateListCache(id);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    } finally {
      setIsMoving(false);
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

  const openMoveToDialog = () => {
    if (selection.size === 0) return;
    setPickedTarget(crumbs);
    setMoveToOpen(true);
  };

  const confirmMoveTo = async () => {
    if (isMoving) return;
    setIsMoving(true);

    const target = pickedTarget[pickedTarget.length - 1];
    const moveItems = buildMoveItemsFromSelection();
    const filtered = filterNoopMoves(moveItems, target.folderId);

    if (!filtered.length) {
      toast('目标就是原目录，无需移动');
      setMoveToOpen(false);
      setIsMoving(false);
      return;
    }

    const tid = toast.loading('正在移动...');
    try {
      await api.move(filtered, target.folderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([target.folderId, ...fromIds]);

      // 从当前目录移走：本地移除
      const keysToRemove: string[] = filtered.map((m) => keyFromNameKind(m.name, m.kind));
      removeKeysFromItems(keysToRemove);
      clearSelection();

      setMoveToOpen(false);

      api.invalidateListCache(currentFolderId, currentPath);
      api.invalidateListCache(target.folderId);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    } finally {
      setIsMoving(false);
    }
  };

  // rename dialog
  const openRename = (item: ExplorerItem) => {
    if (isFolder(item)) {
      setRenameDialog({
        open: true,
        kind: 'folder',
        oldName: item.name,
        newName: item.name,
        folderId: currentFolderId,
        parentId: currentFolderId,
        folderItemId: item.folderId,
      });
    } else {
      setRenameDialog({
        open: true,
        kind: 'file',
        oldName: item.name,
        newName: item.name,
        folderId: currentFolderId,
        parentId: currentFolderId,
      });
    }
  };

  // 2) rename：使用后端返回 newName（避免 ensureUniqueName 冲突时 UI 假同步）
  const confirmRename = async () => {
    if (!renameDialog.open) return;
    if (isRenaming) return;

    const inputName = renameDialog.newName.trim();
    if (!inputName) return toast.error('名称不能为空');

    setIsRenaming(true);
    const tid = toast.loading('重命名中...');
    try {
      if (renameDialog.kind === 'file') {
        const r = await api.renameFile(renameDialog.folderId, renameDialog.oldName, inputName);
        const finalName = (r?.newName || inputName).trim();

        toast.dismiss(tid);
        toast.success(r?.noop ? '未修改' : '重命名成功');

        if (!r?.noop) {
          const oldKey = `${currentPath}${renameDialog.oldName}`;
          const newKey = `${currentPath}${finalName}`;

          setItems((prev) =>
            prev.map((it) => {
              if (it.key !== oldKey) return it;
              const f = it as FileItem;
              return { ...f, key: newKey, name: finalName };
            })
          );
          renameKeyInSelection(oldKey, newKey);
          flash([newKey]);
        }

        setRenameDialog((p) => ({ ...p, open: false }));
        invalidateTree([currentFolderId]);
        api.invalidateListCache(currentFolderId, currentPath);
      } else {
        const r = await api.renameFolder(renameDialog.parentId, renameDialog.folderItemId!, renameDialog.oldName, inputName);
        const finalName = (r?.newName || inputName).trim();

        toast.dismiss(tid);
        toast.success(r?.noop ? '未修改' : '重命名成功');

        if (!r?.noop) {
          const oldKey = `${currentPath}${renameDialog.oldName}/`;
          const newKey = `${currentPath}${finalName}/`;

          setItems((prev) =>
            prev.map((it) => {
              if (it.key !== oldKey) return it;
              const f = it as FolderItem;
              return { ...f, key: newKey, name: finalName };
            })
          );
          renameKeyInSelection(oldKey, newKey);
          flash([newKey]);
        }

        setRenameDialog((p) => ({ ...p, open: false }));
        invalidateTree([currentFolderId]);
        api.invalidateListCache(currentFolderId, currentPath);
      }
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '重命名失败');
    } finally {
      setIsRenaming(false);
    }
  };

  // click/select
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
      const idx1 = sortedItems.findIndex((i) => i.key === lastSelectedKey);
      const idx2 = sortedItems.findIndex((i) => i.key === item.key);
      if (idx1 !== -1 && idx2 !== -1) {
        const range = sortedItems.slice(Math.min(idx1, idx2), Math.max(idx1, idx2) + 1);
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

  // drag start
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

    if (isMoving) return;
    setIsMoving(true);

    const data = e.dataTransfer.getData('application/json');
    if (!data) {
      setIsMoving(false);
      return;
    }

    try {
      const parsed = JSON.parse(data);
      const moveItems = Array.isArray(parsed?.moveItems) ? (parsed.moveItems as MoveItem[]) : [];
      if (!moveItems.length) {
        setIsMoving(false);
        return;
      }

      const filtered = filterNoopMoves(moveItems, target.folderId);
      if (!filtered.length) {
        toast('目标就是原目录，无需移动');
        setIsMoving(false);
        return;
      }

      const tid = toast.loading('正在移动...');
      await api.move(filtered, target.folderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([target.folderId, ...fromIds]);

      // 从当前目录移走：本地移除
      const keysToRemove = filtered
        .filter((m) => m.fromFolderId === currentFolderId)
        .map((m) => keyFromNameKind(m.name, m.kind));
      if (keysToRemove.length) {
        removeKeysFromItems(keysToRemove);
        clearSelection();
      }

      api.invalidateListCache(currentFolderId, currentPath);
      api.invalidateListCache(target.folderId);
    } catch (err: any) {
      toast.error(err?.message || '移动失败');
    } finally {
      setIsMoving(false);
    }
  };

  const handleDropToFolderId = async (moveItems: MoveItem[], targetFolderId: string) => {
    const filtered = filterNoopMoves(moveItems, targetFolderId);
    if (!filtered.length) return toast('目标就是原目录，无需移动');

    if (isMoving) return;
    setIsMoving(true);

    const tid = toast.loading('正在移动...');
    try {
      const res = await api.move(filtered, targetFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');

      const fromIds = Array.from(new Set(filtered.map((x) => x.fromFolderId)));
      invalidateTree([targetFolderId, ...fromIds]);

      // 如果源目录是当前目录：移除本地
      const keysToRemove = filtered
        .filter((m) => m.fromFolderId === currentFolderId)
        .map((m) => keyFromNameKind(m.name, m.kind));
      if (keysToRemove.length) {
        removeKeysFromItems(keysToRemove);
        clearSelection();
      }

      // 如果目标目录是当前目录：合并 targetAdded（尽量不 list）
      if (targetFolderId === currentFolderId && res?.targetAdded) {
        const addedFiles: FileItem[] = (res.targetAdded.files || []).map((u) => ({
          key: `${currentPath}${u.name}`,
          name: u.name,
          fileId: u.fileId,
          type: u.type || 'application/octet-stream',
          size: u.size || 0,
          uploadedAt: u.uploadedAt || Date.now(),
        }));
        const addedFolders: FolderItem[] = (res.targetAdded.folders || []).map((f) => ({
          key: `${currentPath}${f.name}/`,
          name: f.name,
          type: 'folder',
          size: 0,
          uploadedAt: Date.now(),
          folderId: f.folderId,
          fileId: null,
        }));
        addOrReplaceItems([...addedFolders, ...addedFiles]);
        flash([...addedFolders, ...addedFiles].map((x) => x.key));
      }

      api.invalidateListCache(currentFolderId, currentPath);
      api.invalidateListCache(targetFolderId);
      for (const id of fromIds) api.invalidateListCache(id);
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    } finally {
      setIsMoving(false);
    }
  };

  // keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase() || '')) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        invertSelection();
      }

      if (e.key === 'Escape') {
        clearSelection();
        setIsMultiSelectMode(false);
        setDeleteConfirm({ isOpen: false, targets: [] });
        setContextMenu((p) => ({ ...p, visible: false }));
        setMoveToOpen(false);
        setInfoOpen(false);
        setRenameDialog((p) => ({ ...p, open: false }));
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size > 0) {
          e.preventDefault();
          initiateDelete();
        }
      }

      if (e.key.toLowerCase() === 'i' && selection.size === 1) {
        setInfoOpen(true);
      }
      if (e.key === 'F2' && selection.size === 1) {
        const it = singleSelected;
        if (it) openRename(it);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, sortedItems, singleSelected]);

  const copyText = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error('复制失败（浏览器权限限制）');
    }
  };

  // ======= Render =======
  return (
    <div className="bg-white rounded-xl shadow-xl sm:shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[min(600px,100svh)] flex flex-col sm:flex-row select-none relative touch-manipulation">
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}

      {/* Sidebar */}
      <div
        className={`absolute sm:relative z-40 w-[min(16rem,85vw)] sm:w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100 ${
          showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'
        } flex-shrink-0 pt-[env(safe-area-inset-top,0px)]`}
      >
        {/* 最近访问 */}
        {recentCrumbs.length > 0 && (
          <div className="p-2 border-b border-slate-100">
            <div className="text-xs text-slate-500 px-2 py-1">最近目录</div>
            <div className="flex flex-col gap-1">
              {recentCrumbs.slice(0, 5).map((c, idx) => {
                const last = c[c.length - 1];
                return (
                  <button
                    key={idx}
                    className={`text-left text-xs px-2 py-1.5 rounded-md hover:bg-slate-100 text-slate-700 truncate ${FOCUS_RING} ${PRESS_FEEL}`}
                    title={last.path || '根目录'}
                    onClick={() => navigateToFolderIdResolved(last.folderId)}
                  >
                    {c.map((x) => x.name || '根目录').join(' / ')}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
        onClick={() => !isMultiSelectMode && clearSelection()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) handleUpload(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Top bar */}
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-center justify-between bg-white/95 sm:backdrop-blur sticky top-0 z-20 pt-[env(safe-area-inset-top,0px)]">
          <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
            <button
              className={`sm:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full ${ICON_BTN_BASE}`}
              onClick={() => setShowSidebar(true)}
              title="目录"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                back();
              }}
              disabled={crumbs.length <= 1}
              className={`p-2 rounded-lg transition-all ${ICON_BTN_BASE} ${
                crumbs.length > 1 ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'
              }`}
              title="返回上级"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* Breadcrumb（移动端可横向滚动） */}
            <div className="flex items-center gap-1 text-sm min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none]">
              {crumbs.map((c, idx) => {
                const active = idx === crumbs.length - 1;
                return (
                  <div key={c.folderId} className="flex items-center min-w-0">
                    {idx !== 0 && <span className="text-slate-300 px-1">/</span>}
                    <button
                      className={`truncate max-w-[140px] px-2 py-1 rounded-md ${FOCUS_RING} ${PRESS_FEEL} ${
                        active ? 'text-slate-800 font-semibold' : 'text-slate-600 hover:bg-slate-100'
                      }`}
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

            {isMultiSelectMode && (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                多选模式
              </span>
            )}

            {loading && <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">加载中...</span>}
          </div>

          {/* Actions：允许换行，避免手机端溢出 */}
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end max-w-full">
            {selection.size > 0 ? (
              <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100 flex-wrap">
                {selection.size === 1 && singleSelected && !isFolder(singleSelected) && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(api.getFileUrl(singleSelected.fileId), '_blank');
                      }}
                      className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600 ${ICON_BTN_BASE}`}
                      title="打开/下载"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyLink(singleSelected.key);
                      }}
                      className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600 ${ICON_BTN_BASE}`}
                      title="复制直链"
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setInfoOpen(true);
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-slate-900 ${ICON_BTN_BASE}`}
                  title="详情 (I)"
                >
                  <Info className="w-4 h-4" />
                </button>

                {selection.size === 1 && singleSelected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openRename(singleSelected);
                    }}
                    className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-slate-900 ${ICON_BTN_BASE}`}
                    title="重命名 (F2)"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCut();
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-orange-600 ${ICON_BTN_BASE}`}
                  title="剪切"
                >
                  <Scissors className="w-4 h-4" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openMoveToDialog();
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600 ${ICON_BTN_BASE}`}
                  title="移动到..."
                >
                  <FolderInput className="w-4 h-4" />
                </button>

                <div className="w-px h-4 bg-slate-200 mx-1"></div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    initiateDelete();
                  }}
                  className={`p-2 rounded-md text-red-600 hover:bg-red-50 ${ICON_BTN_BASE}`}
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <span className="px-2 text-xs text-slate-400 font-medium">{selection.size}</span>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    selectAll();
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 ${ICON_BTN_BASE}`}
                  title="全选 (Ctrl+A)"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    invertSelection();
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 ${ICON_BTN_BASE}`}
                  title="反选 (Ctrl+I)"
                >
                  <Replace className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearSelection();
                  }}
                  className={`p-2 hover:bg-white rounded-md text-slate-600 ${ICON_BTN_BASE}`}
                  title="取消选择 (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                {clipboard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePaste();
                    }}
                    disabled={isMoving}
                    className={`flex items-center gap-2 px-3 py-1.5 text-white rounded-lg shadow text-xs font-medium ${FOCUS_RING} ${PRESS_FEEL} ${
                      isMoving ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                    title="把剪切的项目移动到当前目录"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" /> {isMoving ? '移动中...' : '粘贴'}
                  </button>
                )}

                <button
                  onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                  className={`p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors ${ICON_BTN_BASE}`}
                  title={viewMode === 'grid' ? '切换列表视图' : '切换网格视图'}
                >
                  {viewMode === 'grid' ? <ListIcon className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
                </button>

                <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg p-1">
                  <button
                    onClick={() => setSortMode('time')}
                    className={`p-2 rounded-md ${ICON_BTN_BASE} ${
                      sortMode === 'time' ? 'bg-white shadow text-blue-600' : 'text-slate-600 hover:bg-white'
                    }`}
                    title="按时间排序"
                  >
                    <Clock3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSortMode('name')}
                    className={`p-2 rounded-md ${ICON_BTN_BASE} ${
                      sortMode === 'name' ? 'bg-white shadow text-blue-600' : 'text-slate-600 hover:bg-white'
                    }`}
                    title="按名称排序"
                  >
                    <ArrowDownAZ className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSortMode('size')}
                    className={`p-2 rounded-md ${ICON_BTN_BASE} ${
                      sortMode === 'size' ? 'bg-white shadow text-blue-600' : 'text-slate-600 hover:bg-white'
                    }`}
                    title="按大小排序"
                  >
                    <HardDrive className="w-4 h-4" />
                  </button>
                </div>

                {/* 搜索：不再只在 md 才显示（移动端也可用），宽度自适应，避免挤爆 */}
                <div className="relative group">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索(当前目录)..."
                    className={`w-[min(220px,52vw)] md:w-[180px] pl-9 pr-9 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all ${FOCUS_RING}`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {searchQuery && (
                    <button
                      className={`absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-slate-200 text-slate-500 ${ICON_BTN_BASE}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchQuery('');
                      }}
                      title="清空搜索"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateFolder();
                  }}
                  className={`p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors ${ICON_BTN_BASE}`}
                  title="新建文件夹"
                >
                  <FolderPlus className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMultiSelectMode(!isMultiSelectMode);
                    if (isMultiSelectMode) clearSelection();
                  }}
                  className={`p-2 rounded-lg transition-all ${ICON_BTN_BASE} ${
                    isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title="多选模式"
                >
                  <CheckSquare className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    load(currentFolderId, currentPath, { bypassCache: true }).then(() => toast.success('已刷新'));
                    invalidateTree([currentFolderId]);
                  }}
                  className={`p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors ${ICON_BTN_BASE}`}
                  title="刷新当前目录"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 剪切状态条 */}
        {clipboard && (
          <div className="px-4 py-2 border-b border-amber-100 bg-amber-50/80">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-amber-800 truncate">
                剪切板：已剪切 <span className="font-semibold">{clipboard.length}</span> 项（进入目标目录点“粘贴”即可完成移动）
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  className={`px-3 py-1.5 text-xs rounded-lg text-white ${FOCUS_RING} ${PRESS_FEEL} ${
                    isMoving ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                  disabled={isMoving}
                  onClick={() => handlePaste()}
                  title="粘贴到当前目录"
                >
                  粘贴
                </button>
                <button
                  className={`px-3 py-1.5 text-xs rounded-lg bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 ${FOCUS_RING} ${PRESS_FEEL}`}
                  disabled={isMoving}
                  onClick={() => setClipboard(null)}
                  title="取消剪切"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* error bar */}
        {loadError && (
          <div className="px-4 py-2 border-b border-slate-100 bg-red-50 text-red-700 text-sm flex items-center justify-between gap-2">
            <span className="truncate">加载失败：{loadError}</span>
            <button
              className={`px-3 py-1 rounded bg-white border border-red-200 hover:bg-red-100 flex-shrink-0 ${FOCUS_RING} ${PRESS_FEEL}`}
              onClick={() => load(currentFolderId, currentPath, { bypassCache: true })}
            >
              重试
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 bg-slate-50/30 overflow-y-auto overscroll-contain">
          {viewMode === 'grid' ? (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start">
              {!searchQuery && (
                <label
                  className={`flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 cursor-pointer group transition-all aspect-square sm:aspect-[3/4] ${
                    isUploading ? 'opacity-60 pointer-events-none' : ''
                  }`}
                  onClick={(e) => e.stopPropagation()}
                  title="点击选择文件上传，或直接拖拽到页面任意位置"
                >
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const fs = e.currentTarget.files ? Array.from(e.currentTarget.files) : [];
                      e.currentTarget.value = '';
                      if (fs.length) handleUpload(fs);
                    }}
                  />
                  <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
                  <span className="text-xs text-slate-500 font-medium">{isUploading ? '上传中...' : '上传'}</span>
                  <span className="text-[10px] text-slate-400 mt-1 hidden sm:block">支持拖拽</span>
                </label>
              )}

              {showSkeleton ? (
                <GridSkeleton />
              ) : (
                <>
                  {!loading && !loadError && sortedItems.length === 0 && (
                    <div className="col-span-full flex items-center justify-center py-10">
                      <div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
                        {searchQuery ? '没有找到匹配结果（仅搜索当前目录）' : '这里还没有文件。把文件拖进来，就能马上上传。'}
                      </div>
                    </div>
                  )}

                  {sortedItems.map((item) => {
                    const selected = selection.has(item.key);
                    const isFlashing = flashKeys.has(item.key);
                    const isDraggingOver = dragOverFolderKey === item.key;

                    const fileThumb =
                      !isFolder(item) && item.type?.startsWith('image/') ? api.getFileUrl((item as FileItem).fileId) : '';

                    const metaText = isFolder(item)
                      ? '文件夹'
                      : `${formatBytes((item as FileItem).size)} · ${formatTimeShort((item as FileItem).uploadedAt)}`;

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
                        onDoubleClick={() => {
                          if (!isFolder(item)) window.open(api.getFileUrl((item as FileItem).fileId), '_blank');
                        }}
                        className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-square sm:aspect-[3/4]
                          ${PRESS_FEEL}
                          ${
                            selected
                              ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10'
                              : isDraggingOver
                              ? 'border-blue-500 bg-blue-100 scale-105 shadow-md'
                              : isFlashing
                              ? 'border-emerald-400 bg-emerald-50 shadow-sm ring-1 ring-emerald-300'
                              : 'border-transparent hover:bg-white hover:shadow-md'
                          }`}
                        title={item.key}
                      >
                        {/* ⋯更多按钮 */}
                        <button
                          className={`absolute top-2 left-2 z-30 p-1.5 rounded-lg border border-slate-200 bg-white/90 text-slate-600 hover:bg-white transition
                                     opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${ICON_BTN_BASE}`}
                          onClick={(e) => openItemMenuFromButton(e, item)}
                          title="更多操作"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {(selected || isMultiSelectMode) && (
                          <div className="absolute top-2 right-2 z-20 pointer-events-none">
                            {selected ? (
                              <CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white/80" />
                            )}
                          </div>
                        )}

                        {/* 拖拽提示 */}
                        {isFolder(item) && isDraggingOver && (
                          <div className="absolute inset-0 rounded-xl bg-blue-500/10 ring-2 ring-blue-400 flex items-center justify-center pointer-events-none">
                            <div className="text-xs font-semibold text-blue-700 bg-white/85 border border-blue-200 px-2 py-1 rounded-lg">
                              松手移动到此文件夹
                            </div>
                          </div>
                        )}

                        <div className="flex-1 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                          {isFolder(item) ? (
                            <Folder className="w-16 h-16 text-blue-400/90 fill-blue-100" />
                          ) : fileThumb ? (
                            <LazyImg src={fileThumb} className="w-full h-full object-contain rounded shadow-sm" />
                          ) : (
                            <FileText className="w-14 h-14 text-slate-400" />
                          )}
                        </div>

                        <div className="w-full text-center px-0.5 mt-2">
                          <div className={`text-xs font-medium truncate w-full ${selected ? 'text-blue-700' : 'text-slate-700'}`}>
                            {item.name}
                          </div>
                          {/* 移动端默认显示，桌面端 hover 显示 */}
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition">
                            {metaText}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ) : (
            <div className="p-4">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr),120px,160px] gap-2 px-3 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-b border-slate-200">
                  <div>名称</div>
                  <div className="text-right hidden sm:block tabular-nums">大小</div>
                  <div className="text-right hidden sm:block tabular-nums">时间</div>
                </div>

                {showSkeleton ? (
                  <ListSkeleton />
                ) : sortedItems.length === 0 ? (
                  <div className="p-6 text-sm text-slate-600">
                    {searchQuery ? '没有找到匹配结果（仅搜索当前目录）' : '这里还没有文件。现在上传一个试试？'}
                  </div>
                ) : (
                  sortedItems.map((item) => {
                    const selected = selection.has(item.key);
                    const isFlashing = flashKeys.has(item.key);
                    const sizeText = isFolder(item) ? '-' : formatBytes((item as FileItem).size);
                    const timeText = formatTimeShort(item.uploadedAt);

                    return (
                      <div
                        key={item.key}
                        className={`group grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr),120px,160px] gap-2 px-3 py-2 text-sm border-b border-slate-100 cursor-pointer ${PRESS_FEEL}
                          ${selected ? 'bg-blue-50' : isFlashing ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                        onClick={(e) => handleItemClick(e, item)}
                        onContextMenu={(e) => openContextMenuItem(e, item)}
                        onDoubleClick={() => {
                          if (!isFolder(item)) window.open(api.getFileUrl((item as FileItem).fileId), '_blank');
                        }}
                        title={item.key}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isFolder(item) ? (
                            <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          )}
                          <span className="truncate flex-1 min-w-0">{item.name}</span>

                          <button
                            className={`flex-shrink-0 p-1.5 rounded-lg border border-slate-200 bg-white/90 text-slate-600 hover:bg-white transition
                                       opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ${ICON_BTN_BASE}`}
                            onClick={(e) => openItemMenuFromButton(e, item)}
                            title="更多操作"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="hidden sm:block text-right text-slate-600 tabular-nums">{sizeText}</div>
                        <div className="hidden sm:block text-right text-slate-500 tabular-nums">{timeText}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 右键菜单（⋯按钮复用它） ===== */}
      {contextMenu.visible && (
        <div
          className="fixed z-50 bg-white/95 sm:backdrop-blur rounded-lg shadow-xl border border-slate-100 w-52 py-1 overflow-auto max-h-[70svh]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'blank' ? (
            <>
              {clipboard && (
                <button
                  className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2 ${FOCUS_RING}`}
                  onClick={() => {
                    setContextMenu((p) => ({ ...p, visible: false }));
                    handlePaste();
                  }}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                </button>
              )}
              <button
                className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  load(currentFolderId, currentPath, { bypassCache: true });
                }}
              >
                <RefreshCw className="w-3.5 h-3.5" /> 刷新
              </button>
              <button
                className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  handleCreateFolder();
                }}
              >
                <FolderPlus className="w-3.5 h-3.5" /> 新建文件夹
              </button>
            </>
          ) : (
            <>
              {selection.size === 1 && singleSelected && !isFolder(singleSelected) && (
                <>
                  <button
                    className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2 ${FOCUS_RING}`}
                    onClick={() => {
                      setContextMenu((p) => ({ ...p, visible: false }));
                      window.open(api.getFileUrl(singleSelected.fileId), '_blank');
                    }}
                  >
                    <Download className="w-3.5 h-3.5" /> 打开/下载
                  </button>
                  <button
                    className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2 ${FOCUS_RING}`}
                    onClick={() => {
                      setContextMenu((p) => ({ ...p, visible: false }));
                      copyText(api.getFileUrl(singleSelected.fileId), '直链已复制');
                    }}
                  >
                    <LinkIcon className="w-3.5 h-3.5" /> 复制直链
                  </button>
                </>
              )}

              <button
                className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  setInfoOpen(true);
                }}
              >
                <Info className="w-3.5 h-3.5" /> 详情
              </button>

              {selection.size === 1 && singleSelected && (
                <button
                  className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex gap-2 ${FOCUS_RING}`}
                  onClick={() => {
                    setContextMenu((p) => ({ ...p, visible: false }));
                    openRename(singleSelected);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" /> 重命名
                </button>
              )}

              <button
                className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  handleCut();
                }}
              >
                <Scissors className="w-3.5 h-3.5" /> 剪切
              </button>

              <button
                className={`w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  openMoveToDialog();
                }}
              >
                <FolderInput className="w-3.5 h-3.5" /> 移动到...
              </button>

              <button
                className={`w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex gap-2 ${FOCUS_RING}`}
                onClick={() => {
                  setContextMenu((p) => ({ ...p, visible: false }));
                  initiateDelete();
                }}
              >
                <Trash2 className="w-3.5 h-3.5" /> 删除
              </button>
            </>
          )}
        </div>
      )}

      {/* ===== MoveTo Dialog（只渲染一次：UI 修复，不动业务逻辑）===== */}
      {moveToOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 sm:backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)]"
          onClick={() => !isMoving && setMoveToOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-4 border border-slate-100 max-h-[90svh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 py-2">
              <div>
                <div className="text-base font-bold text-slate-800">移动到...</div>
                <div className="text-xs text-slate-500 mt-1">已选中 {selection.size} 项</div>
              </div>
              <button
                className={`p-2 rounded-lg hover:bg-slate-100 text-slate-500 ${ICON_BTN_BASE}`}
                onClick={() => !isMoving && setMoveToOpen(false)}
                title="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="h-[min(360px,60svh)] border border-slate-100 rounded-xl overflow-hidden mx-2">
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

            <div className="flex justify-end gap-2 px-2 pt-4 pb-[env(safe-area-inset-bottom,0px)]">
              <button
                className={`px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl ${FOCUS_RING} ${PRESS_FEEL}`}
                onClick={() => !isMoving && setMoveToOpen(false)}
                disabled={isMoving}
              >
                取消
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium text-white rounded-xl ${FOCUS_RING} ${PRESS_FEEL} ${
                  isMoving ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                disabled={isMoving}
                onClick={confirmMoveTo}
              >
                {isMoving ? '移动中...' : '确认移动'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Rename Dialog ===== */}
      {renameDialog.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 sm:backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)]"
          onClick={() => !isRenaming && setRenameDialog((p) => ({ ...p, open: false }))}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-100 max-h-[90svh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-bold text-slate-800">重命名</div>
              <button
                className={`p-2 rounded-lg hover:bg-slate-100 text-slate-500 ${ICON_BTN_BASE}`}
                onClick={() => !isRenaming && setRenameDialog((p) => ({ ...p, open: false }))}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4">
              <div className="text-xs text-slate-500 mb-2">原名称：{renameDialog.oldName}</div>
              <input
                value={renameDialog.newName}
                onChange={(e) => setRenameDialog((p) => ({ ...p, newName: e.target.value }))}
                className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500 ${FOCUS_RING}`}
                placeholder="输入新名称"
                autoFocus
                disabled={isRenaming}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
                }}
              />
              <div className="text-[11px] text-slate-400 mt-2">小提示：支持使用 F2 快速重命名（桌面端）。</div>
            </div>

            <div className="flex justify-end gap-2 mt-4 pb-[env(safe-area-inset-bottom,0px)]">
              <button
                className={`px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl ${FOCUS_RING} ${PRESS_FEEL}`}
                disabled={isRenaming}
                onClick={() => setRenameDialog((p) => ({ ...p, open: false }))}
              >
                取消
              </button>
              <button
                className={`px-4 py-2 text-sm font-medium text-white rounded-xl ${FOCUS_RING} ${PRESS_FEEL} ${
                  isRenaming ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'
                }`}
                disabled={isRenaming}
                onClick={confirmRename}
              >
                {isRenaming ? '处理中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Info Drawer ===== */}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setInfoOpen(false)}>
          <div
            className="w-full max-w-md h-full bg-white shadow-2xl border-l border-slate-200 p-4 overflow-auto overscroll-contain pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold text-slate-800">详情</div>
              <button className={`p-2 rounded-lg hover:bg-slate-100 text-slate-500 ${ICON_BTN_BASE}`} onClick={() => setInfoOpen(false)} title="关闭">
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
                <div className="text-sm text-slate-700 break-all"><span className="text-slate-400">folderId：</span> {singleSelected.folderId}</div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.name, '文件夹名已复制')}>
                    复制名称
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.key, '路径已复制')}>
                    复制路径
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.folderId, 'folderId 已复制')}>
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
                    <LazyImg
                      src={api.getFileUrl(singleSelected.fileId)}
                      className="w-full max-h-64 object-contain rounded-lg border border-slate-200 bg-slate-50"
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  <button className={`px-3 py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => window.open(api.getFileUrl(singleSelected.fileId), '_blank')}>
                    打开/下载
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(api.getFileUrl(singleSelected.fileId), '直链已复制')}>
                    复制直链
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.fileId, 'fileId 已复制')}>
                    复制 fileId
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.name, '文件名已复制')}>
                    复制文件名
                  </button>
                  <button className={`px-3 py-2 text-xs rounded-lg bg-slate-100 hover:bg-slate-200 ${FOCUS_RING} ${PRESS_FEEL}`} onClick={() => copyText(singleSelected.key, '路径已复制')}>
                    复制路径
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Delete Confirm ===== */}
      {deleteConfirm.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 sm:backdrop-blur-sm pb-[env(safe-area-inset-bottom,0px)]"
          onClick={() => !isDeleting && setDeleteConfirm({ isOpen: false, targets: [] })}
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100 max-h-[90svh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">确认删除？</h3>
                <p className="text-sm text-slate-500 mt-2">
                  即将删除 {deleteConfirm.targets.length} 项。<br />
                  <span className="text-red-500 font-medium">此操作不可恢复。</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full mt-2 pb-[env(safe-area-inset-bottom,0px)]">
                <button
                  onClick={() => setDeleteConfirm({ isOpen: false, targets: [] })}
                  disabled={isDeleting}
                  className={`px-4 py-2 text-sm font-medium rounded-xl ${FOCUS_RING} ${PRESS_FEEL} ${
                    isDeleting ? 'text-slate-400 bg-slate-100 cursor-not-allowed' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
                  }`}
                >
                  取消
                </button>
                <button
                  onClick={executeDelete}
                  disabled={isDeleting}
                  className={`px-4 py-2 text-sm font-medium text-white rounded-xl ${FOCUS_RING} ${PRESS_FEEL} ${
                    isDeleting ? 'bg-red-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600'
                  }`}
                >
                  {isDeleting ? '删除中...' : '确认删除'}
                </button>
              </div>
              <div className="text-[11px] text-slate-400">小提示：桌面端可用 Delete/Backspace 快速删除。</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}