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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { FolderTree } from './FolderTree';

function isFolder(item: ExplorerItem): item is FolderItem {
  return (item as any).type === 'folder';
}

export function FileExplorer({ refreshNonce = 0 }: { refreshNonce?: number }) {
  const [currentPath, setCurrentPath] = useState<string>(''); // 'a/b/'
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [parentId, setParentId] = useState<string | null>(null);

  const [items, setItems] = useState<ExplorerItem[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  const [clipboard, setClipboard] = useState<MoveItem[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOverFolderKey, setDragOverFolderKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; targets: string[] }>({ isOpen: false, targets: [] });

  const itemsByKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);

  const load = async (folderId = currentFolderId, path = currentPath) => {
    const res = await api.list(folderId, path);
    setParentId(res.parentId);
    setItems([...res.folders, ...res.files]);
    setSelection(new Set());
  };

  useEffect(() => {
    if (!api.checkAuth()) return;
    load().catch(() => toast.error('加载失败'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!api.checkAuth()) return;
    load(currentFolderId, currentPath).catch(() => toast.error('刷新失败'));
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

  const navigateToFolder = (folderId: string, path: string) => {
    setCurrentFolderId(folderId);
    setCurrentPath(path);
    setSearchQuery('');
    setShowSidebar(false);
    load(folderId, path).catch(() => toast.error('加载失败'));
  };

  const back = () => {
    if (!parentId) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.length ? parts.join('/') + '/' : '';
    setCurrentPath(parentPath);
    setCurrentFolderId(parentId);
    setSearchQuery('');
    load(parentId, parentPath).catch(() => toast.error('加载失败'));
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

  const handleCreateFolder = async () => {
    if (searchQuery) return toast.error('请先退出搜索模式');
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const clean = name.replace(/[\/\\|]/g, '').trim();
    if (!clean) return toast.error('名称不能为空');

    const tid = toast.loading('创建中...');
    try {
      await api.createFolder(currentFolderId, clean);
      toast.dismiss(tid);
      toast.success('创建成功');
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
      toast.success('上传成功');
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
      const delItems = buildDeleteItemsFromKeys(keys);
      await api.batchDelete(delItems);
      toast.dismiss(tid);
      toast.success('删除成功');
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
    toast.success('已剪切');
  };

  const handlePaste = async () => {
    if (!clipboard?.length) return;
    const tid = toast.loading('正在移动...');
    try {
      await api.move(clipboard, currentFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');
      setClipboard(null);
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    }
  };

  const handleCopyLink = (key: string) => {
    const it = itemsByKey.get(key);
    if (!it || isFolder(it)) return;
    navigator.clipboard.writeText(api.getFileUrl(it.fileId));
    toast.success('直链已复制');
  };

  const handleOpen = (key: string) => {
    const it = itemsByKey.get(key);
    if (!it || isFolder(it)) return;
    window.open(api.getFileUrl(it.fileId), '_blank');
  };

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

    if (isFolder(item)) {
      navigateToFolder(item.folderId, item.key);
    } else {
      setSelection(new Set([item.key]));
      setLastSelectedKey(item.key);
    }
  };

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

  const handleDropToFolderTile = async (e: React.DragEvent, target: FolderItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderKey(null);

    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const { moveItems } = JSON.parse(data);
      if (!Array.isArray(moveItems) || !moveItems.length) return;

      const tid = toast.loading('正在移动...');
      await api.move(moveItems as MoveItem[], target.folderId);
      toast.dismiss(tid);
      toast.success('移动成功');
      await load();
    } catch (err: any) {
      toast.error(err?.message || '移动失败');
    }
  };

  const handleDropToFolderId = async (moveItems: MoveItem[], targetFolderId: string) => {
    const tid = toast.loading('正在移动...');
    try {
      await api.move(moveItems, targetFolderId);
      toast.dismiss(tid);
      toast.success('移动成功');
      await load();
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message || '移动失败');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes(document.activeElement?.tagName.toLowerCase() || '')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelection(new Set(viewItems.map((i) => i.key)));
      }
      if (e.key === 'Escape') {
        setSelection(new Set());
        setIsMultiSelectMode(false);
        setDeleteConfirm({ isOpen: false, targets: [] });
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size > 0) initiateDelete();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, viewItems]);

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col sm:flex-row select-none relative">
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}

      <div
        className={`absolute sm:relative z-40 w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100 ${
          showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'
        } flex-shrink-0`}
      >
        <FolderTree
          refreshNonce={refreshNonce}
          currentFolderId={currentFolderId}
          currentPath={currentPath}
          onNavigate={(fid, path) => navigateToFolder(fid, path)}
          onMove={handleDropToFolderId}
        />
      </div>

      <div
        className="flex-1 flex flex-col min-w-0 bg-white"
        ref={containerRef}
        onClick={() => !isMultiSelectMode && setSelection(new Set())}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) handleUpload(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20 h-14">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button className="sm:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full" onClick={() => setShowSidebar(true)}>
              <Menu className="w-5 h-5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                back();
              }}
              disabled={!parentId}
              className={`p-2 rounded-lg transition-all ${parentId ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
              title="返回上级"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="text-sm font-medium text-slate-700 truncate px-2" title={currentPath}>
              {searchQuery ? '搜索结果' : currentPath ? currentPath.split('/').filter(Boolean).pop() : '根目录'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selection.size > 0 ? (
              <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100 mr-2">
                {selection.size === 1 && !Array.from(selection)[0].endsWith('/') && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpen(Array.from(selection)[0]);
                      }}
                      className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600"
                      title="打开/下载"
                    >
                      <Download className="w-4 h-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyLink(Array.from(selection)[0]);
                      }}
                      className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600"
                      title="复制直链"
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCut();
                  }}
                  className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-orange-600"
                  title="剪切"
                >
                  <Scissors className="w-4 h-4" />
                </button>

                <div className="w-px h-4 bg-slate-200 mx-1"></div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    initiateDelete();
                  }}
                  className="p-2 hover:bg-white rounded-md text-red-600 hover:bg-red-50"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <span className="px-2 text-xs text-slate-400 font-medium">{selection.size}</span>
              </div>
            ) : (
              <>
                {clipboard && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePaste();
                    }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 text-xs font-medium"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                  </button>
                )}

                <div className="relative group hidden md:block">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索(当前目录)..."
                    className="w-[160px] pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreateFolder();
                  }}
                  className="p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
                  title="新建文件夹"
                >
                  <FolderPlus className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMultiSelectMode(!isMultiSelectMode);
                    if (isMultiSelectMode) setSelection(new Set());
                  }}
                  className={`p-2 rounded-lg transition-all ${isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  title="多选模式"
                >
                  <CheckSquare className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    load().then(() => toast.success('已刷新')).catch(() => toast.error('刷新失败'));
                  }}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="刷新"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start flex-1 bg-slate-50/30 overflow-y-auto">
          {!searchQuery && (
            <label
              className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 cursor-pointer group transition-all aspect-[3/4]"
              onClick={(e) => e.stopPropagation()}
            >
              <input type="file" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(Array.from(e.target.files))} />
              <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
              <span className="text-xs text-slate-500 font-medium">上传</span>
            </label>
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
                onClick={(e) => handleItemClick(e, item)}
                onDoubleClick={() => {
                  if (!isFolder(item)) window.open(api.getFileUrl((item as FileItem).fileId), '_blank');
                }}
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

      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100">
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
                <button
                  onClick={() => setDeleteConfirm({ isOpen: false, targets: [] })}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  取消
                </button>
                <button onClick={executeDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl">
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
