// src/components/FileExplorer.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CheckSquare, ClipboardPaste, Download, FileText, Folder,
  FolderPlus, Link as LinkIcon, Menu, RefreshCw, Scissors, Search, Trash2, UploadCloud
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, EntryItem } from '../lib/api';
import { FolderTree } from './FolderTree';

type Crumb = { id: string; name: string };

const ROOT_ID = 'root';
const TRASH_ID = 'trash';

export function FileExplorer() {
  const [currentFolderId, setCurrentFolderId] = useState<string>(ROOT_ID);
  const [crumb, setCrumb] = useState<Crumb[]>([]);
  const [items, setItems] = useState<EntryItem[]>([]);
  const [selection, setSelection] = useState<Map<string, { id: string; fromFolderId: string }>>(new Map());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchItems, setSearchItems] = useState<EntryItem[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [clipboard, setClipboard] = useState<{ items: { id: string; fromFolderId: string }[] } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; hard: boolean; targets: { id: string; fromFolderId: string }[] }>({
    isOpen: false, hard: false, targets: [],
  });

  const containerRef = useRef<HTMLDivElement>(null);

  const visibleItems = useMemo(() => {
    if (searchQuery.trim()) return searchItems;
    return items;
  }, [items, searchItems, searchQuery]);

  const titleName = useMemo(() => {
    if (searchQuery.trim()) return '搜索结果';
    if (currentFolderId === ROOT_ID) return '根目录';
    if (currentFolderId === TRASH_ID) return '回收站';
    return crumb.length ? crumb[crumb.length - 1].name : '目录';
  }, [searchQuery, currentFolderId, crumb]);

  const reload = async () => {
    try {
      const list = await api.listFolder(currentFolderId);
      setItems(list);
    } catch (e: any) {
      if (String(e?.message || '').includes('Expired')) api.logout();
      toast.error('加载失败');
    }
  };

  useEffect(() => { reload(); }, [currentFolderId]);

  // 搜索：后端遍历（只读 KV.get，不用 list）
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchItems([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.search(q, 200);
        setSearchItems(res);
      } catch {
        setSearchItems([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const navigate = (folderId: string, newCrumb: Crumb[]) => {
    setCurrentFolderId(folderId);
    setCrumb(folderId === ROOT_ID ? [] : newCrumb.filter(x => x.id !== ROOT_ID));
    setSelection(new Map());
    setLastSelectedId(null);
    setShowSidebar(false);
  };

  const getFromFolderId = (item: EntryItem) => {
    // 搜索结果会带 parentId；普通列表 parentId 不需要
    if (searchQuery.trim()) return item.parentId || ROOT_ID;
    return currentFolderId;
  };

  const selectedArray = () => Array.from(selection.values());

  const initiateDelete = (hard = false, targets?: { id: string; fromFolderId: string }[]) => {
    const t = targets && targets.length ? targets : selectedArray();
    if (!t.length) return;
    setDeleteConfirm({ isOpen: true, hard, targets: t });
  };

  const executeDelete = async () => {
    const { hard, targets } = deleteConfirm;
    setDeleteConfirm({ isOpen: false, hard: false, targets: [] });
    const toastId = toast.loading(hard ? '正在硬删除...' : '正在删除(移入回收站)...');

    try {
      await api.batchDelete(targets, hard);
      toast.dismiss(toastId);
      toast.success(hard ? '已硬删除' : '已移入回收站');
      setSelection(new Map());
      await reload();
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message || '删除失败');
    }
  };

  const handleCreateFolder = async () => {
    if (searchQuery.trim()) { toast.error('请先退出搜索模式'); return; }
    const name = prompt('请输入文件夹名称:');
    if (!name) return;
    const clean = name.replace(/[\/\\]/g, '').trim();
    if (!clean) { toast.error('名称不能为空'); return; }

    try {
      await api.createFolder(currentFolderId, clean);
      toast.success('文件夹创建成功');
      await reload();
    } catch {
      toast.error('创建失败');
    }
  };

  const handleUpload = async (files: File[]) => {
    if (!files.length) return;
    const toastId = toast.loading('正在上传...');
    try {
      await api.upload(files, currentFolderId);
      toast.dismiss(toastId);
      toast.success('上传成功');
      await reload();
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message || '上传失败');
    }
  };

  const handleCut = () => {
    const items = selectedArray();
    if (!items.length) return;
    setClipboard({ items });
    toast('已剪切');
    setSelection(new Map());
  };

  const handlePaste = async () => {
    if (!clipboard?.items?.length) return;
    const toastId = toast.loading('正在移动...');
    try {
      await api.move(clipboard.items, currentFolderId);
      toast.dismiss(toastId);
      toast.success('移动成功');
      setClipboard(null);
      await reload();
    } catch (e: any) {
      toast.dismiss(toastId);
      toast.error(e?.message || '移动失败');
    }
  };

  const handleCopyLink = (item: EntryItem) => {
    if (item.kind !== 'file') return;
    const url = api.getFileUrl(item.id);
    navigator.clipboard.writeText(url);
    toast.success('直链已复制');
  };

  const handleItemClick = (e: React.MouseEvent, item: EntryItem) => {
    e.stopPropagation();
    const id = item.id;
    const fromFolderId = getFromFolderId(item);

    if (isMultiSelectMode || e.ctrlKey || e.metaKey) {
      const next = new Map(selection);
      if (next.has(id)) next.delete(id);
      else next.set(id, { id, fromFolderId });
      setSelection(next);
      setLastSelectedId(id);
      return;
    }

    // shift range（仅当前视图内）
    if (e.shiftKey && lastSelectedId) {
      const ids = visibleItems.map(x => x.id);
      const i1 = ids.indexOf(lastSelectedId);
      const i2 = ids.indexOf(id);
      if (i1 !== -1 && i2 !== -1) {
        const next = new Map<string, { id: string; fromFolderId: string }>();
        const lo = Math.min(i1, i2);
        const hi = Math.max(i1, i2);
        for (let i = lo; i <= hi; i++) {
          const it = visibleItems[i];
          next.set(it.id, { id: it.id, fromFolderId: getFromFolderId(it) });
        }
        setSelection(next);
        return;
      }
    }

    // 单选
    const next = new Map<string, { id: string; fromFolderId: string }>();
    next.set(id, { id, fromFolderId });
    setSelection(next);
    setLastSelectedId(id);

    // 文件夹单击不直接进入（保持你原来的“单击选中、双击进入/打开”习惯）
  };

  const openItem = (item: EntryItem) => {
    if (item.kind === 'folder') {
      // 搜索结果里会带 crumb（folder 的 crumb 指向它自己）
      const c = item.crumb || [...crumb, { id: item.id, name: item.name }];
      navigate(item.id, c);
      setSearchQuery('');
      return;
    }
    window.open(api.getFileUrl(item.id), '_blank');
  };

  // 键盘快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes((document.activeElement?.tagName || '').toLowerCase())) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const next = new Map<string, { id: string; fromFolderId: string }>();
        for (const it of visibleItems) next.set(it.id, { id: it.id, fromFolderId: getFromFolderId(it) });
        setSelection(next);
      }

      if (e.key === 'Escape') {
        setSelection(new Map());
        setIsMultiSelectMode(false);
        setDeleteConfirm({ isOpen: false, hard: false, targets: [] });
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size > 0) initiateDelete(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visibleItems, selection, searchQuery, currentFolderId]);

  const goBack = () => {
    if (currentFolderId === ROOT_ID) return;
    if (currentFolderId === TRASH_ID) { navigate(ROOT_ID, []); return; }
    // crumb 里存的是从根到当前（不含根）的路径
    const nextCrumb = crumb.slice(0, -1);
    const nextId = nextCrumb.length ? nextCrumb[nextCrumb.length - 1].id : ROOT_ID;
    navigate(nextId, nextCrumb);
  };

  const onDropToFolder = async (e: React.DragEvent, folderId: string, c: Crumb[]) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const dragged: { id: string; fromFolderId: string }[] = data?.items || [];
      if (!dragged.length) return;

      // 防止拖到自己所在目录（无意义）
      if (dragged.every(x => x.fromFolderId === folderId)) return;

      const toastId = toast.loading('正在移动...');
      await api.move(dragged, folderId);
      toast.dismiss(toastId);
      toast.success('移动成功');
      await reload();
    } catch {}
  };

  return (
    <div className="bg-white rounded-xl shadow-2xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] flex flex-col sm:flex-row select-none relative">
      {showSidebar && <div className="fixed inset-0 bg-black/20 z-30 sm:hidden" onClick={() => setShowSidebar(false)} />}

      <div className={`absolute sm:relative z-40 w-64 h-full bg-white transition-transform duration-300 transform border-r border-slate-100 ${showSidebar ? 'translate-x-0' : '-translate-x-full sm:translate-x-0'} flex-shrink-0`}>
        <FolderTree
          currentFolderId={currentFolderId}
          onNavigate={navigate}
          onDropToFolder={onDropToFolder}
        />
      </div>

      <div
        className="flex-1 flex flex-col min-w-0 bg-white"
        ref={containerRef}
        onClick={() => !isMultiSelectMode && setSelection(new Map())}
        onDragOver={e => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          // 拖到空白处：移动到当前目录
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            try {
              const data = JSON.parse(raw);
              const dragged: { id: string; fromFolderId: string }[] = data?.items || [];
              if (!dragged.length) return;
              if (dragged.every(x => x.fromFolderId === currentFolderId)) return;

              const toastId = toast.loading('正在移动...');
              await api.move(dragged, currentFolderId);
              toast.dismiss(toastId);
              toast.success('移动成功');
              await reload();
            } catch {}
            return;
          }

          // 外部文件拖入上传
          if (e.dataTransfer.files?.length) {
            await handleUpload(Array.from(e.dataTransfer.files));
          }
        }}
      >
        {/* top bar */}
        <div className="px-4 py-3 border-b border-slate-100 flex gap-3 items-center justify-between bg-white/95 backdrop-blur sticky top-0 z-20 h-14">
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            <button className="sm:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 rounded-full" onClick={() => setShowSidebar(true)}>
              <Menu className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goBack(); }}
              disabled={currentFolderId === ROOT_ID}
              className={`p-2 rounded-lg transition-all ${currentFolderId !== ROOT_ID ? 'hover:bg-slate-100 text-slate-600' : 'text-slate-300'}`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-slate-700 truncate px-2" title={titleName}>
              {titleName}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selection.size > 0 ? (
              <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-100 animate-in slide-in-from-top-1 fade-in mr-2">
                {selection.size === 1 && (() => {
                  const onlyId = selectedArray()[0].id;
                  const it = visibleItems.find(x => x.id === onlyId);
                  if (it && it.kind === 'file') {
                    return (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); window.open(api.getFileUrl(it.id), '_blank'); }}
                          className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600"
                          title="打开/下载"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopyLink(it); }}
                          className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-blue-600"
                          title="复制直链"
                        >
                          <LinkIcon className="w-4 h-4" />
                        </button>
                      </>
                    );
                  }
                  return null;
                })()}
                {selection.size >= 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCut(); }}
                    className="p-2 hover:bg-white rounded-md text-slate-600 hover:text-orange-600"
                    title="剪切"
                  >
                    <Scissors className="w-4 h-4" />
                  </button>
                )}
                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                <button
                  onClick={(e) => { e.stopPropagation(); initiateDelete(false); }}
                  className="p-2 hover:bg-white rounded-md text-red-600 hover:bg-red-50"
                  title="删除（移入回收站）"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <span className="px-2 text-xs text-slate-400 font-medium">{selection.size}</span>
              </div>
            ) : (
              <>
                {clipboard && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePaste(); }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 text-xs font-medium"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" /> 粘贴
                  </button>
                )}

                <div className="relative group hidden md:block">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索..."
                    className="w-[160px] pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-all"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); reload(); }}
                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="刷新"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }}
                  className="p-2 text-slate-600 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
                  title="新建文件夹"
                >
                  <FolderPlus className="w-5 h-5" />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMultiSelectMode(!isMultiSelectMode);
                    if (isMultiSelectMode) setSelection(new Map());
                  }}
                  className={`p-2 rounded-lg transition-all ${isMultiSelectMode ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  title="多选模式"
                >
                  <CheckSquare className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* grid */}
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 content-start flex-1 bg-slate-50/30 overflow-y-auto">
          {!searchQuery.trim() && (
            <label
              className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 cursor-pointer group transition-all aspect-[3/4]"
              onClick={e => e.stopPropagation()}
            >
              <input type="file" multiple className="hidden" onChange={e => e.target.files && handleUpload(Array.from(e.target.files))} />
              <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 mb-2 transition-colors" />
              <span className="text-xs text-slate-500 font-medium">上传</span>
            </label>
          )}

          {visibleItems.map(item => {
            const isSelected = selection.has(item.id);
            const fromFolderId = getFromFolderId(item);

            const showName = searchQuery.trim() ? (item.path || item.name) : item.name;

            return (
              <div
                key={`${fromFolderId}:${item.id}`}
                draggable
                onDragStart={(e) => {
                  const selected = selection.has(item.id) ? selectedArray() : [{ id: item.id, fromFolderId }];
                  e.dataTransfer.setData('application/json', JSON.stringify({ items: selected }));
                }}
                onClick={(e) => handleItemClick(e, item)}
                onDoubleClick={() => openItem(item)}
                className={`relative group flex flex-col items-center p-2 rounded-xl border transition-all cursor-pointer aspect-[3/4]
                  ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500 z-10' : 'border-transparent hover:bg-white hover:shadow-md'}`}
                title={showName}
              >
                {(isSelected || isMultiSelectMode) && (
                  <div className="absolute top-2 right-2 z-20 pointer-events-none">
                    {isSelected ? <CheckCircle2 className="w-5 h-5 text-blue-600 fill-white" /> : <div className="w-5 h-5 rounded-full border-2 border-slate-300 bg-white/80" />}
                  </div>
                )}

                <div className="flex-1 w-full flex items-center justify-center overflow-hidden pointer-events-none">
                  {item.kind === 'folder' ? (
                    <Folder className="w-16 h-16 text-blue-400/90 fill-blue-100" />
                  ) : item.type?.startsWith('image/') ? (
                    <img
                      src={api.getFileUrl(item.id)}
                      className="w-full h-full object-contain rounded shadow-sm"
                      loading="lazy"
                    />
                  ) : (
                    <FileText className="w-14 h-14 text-slate-400" />
                  )}
                </div>

                <div className="w-full text-center px-0.5 mt-2">
                  <div className={`text-xs font-medium truncate w-full ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                    {showName}
                  </div>
                </div>

                {/* quick actions (single file) */}
                {isSelected && selection.size === 1 && item.kind === 'file' && (
                  <div className="absolute bottom-2 left-2 right-2 flex gap-2 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopyLink(item); }}
                      className="px-2 py-1 text-xs bg-white border rounded-md hover:bg-blue-50"
                      title="复制直链"
                    >
                      复制链接
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* delete confirm */}
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
                  即将删除 {deleteConfirm.targets.length} 项。
                  <br />
                  <span className="text-slate-500">默认是移入回收站（更省 KV delete 配额）。</span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full mt-2">
                <button
                  onClick={() => setDeleteConfirm({ isOpen: false, hard: false, targets: [] })}
                  className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  取消
                </button>
                <button
                  onClick={executeDelete}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl"
                >
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
