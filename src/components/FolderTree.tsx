import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { api, FolderItem, MoveItem } from '../lib/api';
import toast from 'react-hot-toast';

export type Crumb = { folderId: string; name: string; path: string };

export type SharedTreeState = {
  childrenMap: Map<string, FolderItem[]>;
  setChildrenMap: React.Dispatch<React.SetStateAction<Map<string, FolderItem[]>>>;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  nodeInfoRef: React.MutableRefObject<Map<string, { folderId: string; name: string; path: string }>>;
};

type Mode = 'navigator' | 'picker';

interface Props {
  refreshNonce?: number;
  invalidateNonce?: number;
  invalidateFolderIds?: string[];

  currentFolderId: string;
  currentPath: string;

  // navigator 模式：点击导航（返回完整 crumbs 链）
  onNavigate?: (folderId: string, path: string, chain: Crumb[]) => void;

  // 拖拽移动
  onMove?: (items: MoveItem[], targetFolderId: string) => void;
  enableDnD?: boolean;

  // picker 模式：点击选择目标目录
  mode?: Mode;
  pickedFolderId?: string;
  onPick?: (folderId: string, path: string, chain: Crumb[]) => void;

  // 共享缓存（侧边树 + 移动对话框共用，省 read）
  shared?: SharedTreeState;
}

interface Node {
  folderId: string;
  name: string;
  path: string; // UI path，用于生成 crumbs；不参与后端寻址
}

export function FolderTree({
  refreshNonce = 0,
  invalidateNonce = 0,
  invalidateFolderIds = [],
  currentFolderId,
  currentPath,
  onNavigate,
  onMove,
  enableDnD = true,
  mode = 'navigator',
  pickedFolderId,
  onPick,
  shared,
}: Props) {
  // local fallback if shared not provided
  const [childrenMapLocal, setChildrenMapLocal] = useState<Map<string, FolderItem[]>>(new Map());
  const [expandedLocal, setExpandedLocal] = useState<Set<string>>(new Set());
  const nodeInfoRefLocal = useRef<Map<string, Node>>(new Map());

  const childrenMap = shared?.childrenMap ?? childrenMapLocal;
  const setChildrenMap = shared?.setChildrenMap ?? setChildrenMapLocal;
  const expanded = shared?.expanded ?? expandedLocal;
  const setExpanded = shared?.setExpanded ?? setExpandedLocal;
  const nodeInfoRef = (shared?.nodeInfoRef ?? nodeInfoRefLocal) as React.MutableRefObject<Map<string, Node>>;

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const root: Node = useMemo(() => ({ folderId: 'root', name: '根目录', path: '' }), []);

  const loadChildren = async (node: Node, force = false) => {
    if (!force && childrenMap.has(node.folderId)) return;
    try {
      const res = await api.list(node.folderId, node.path);
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.set(node.folderId, res.folders);
        return next;
      });
    } catch {
      toast.error('加载目录失败');
    }
  };

  // 全量刷新：清缓存（更省心，但读会多一点）
  useEffect(() => {
    setChildrenMap(new Map());
    setExpanded(new Set());
    loadChildren(root, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  // 初次加载 root
  useEffect(() => {
    loadChildren(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 精准失效：只删指定 folderId 的缓存；若已展开则强制重载一次（读便宜）
  useEffect(() => {
    if (!invalidateFolderIds.length) return;

    setChildrenMap((prev) => {
      const next = new Map(prev);
      for (const id of invalidateFolderIds) next.delete(id);
      return next;
    });

    for (const id of invalidateFolderIds) {
      if (expanded.has(id)) {
        const info = nodeInfoRef.current.get(id);
        if (info) loadChildren(info, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidateNonce]);

  const toggle = async (node: Node) => {
    await loadChildren(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(node.folderId) ? next.delete(node.folderId) : next.add(node.folderId);
      return next;
    });
  };

  const handleDrop = async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);

    if (!enableDnD || !onMove) return;

    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      const moveItems = Array.isArray(parsed?.moveItems) ? (parsed.moveItems as MoveItem[]) : [];
      if (!moveItems.length) return;

      await onMove(moveItems, targetFolderId);

      // 目标目录内容变化：失效目标缓存（省事且读便宜）
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.delete(targetFolderId);
        return next;
      });
    } catch (err: any) {
      toast.error(err?.message || '移动失败');
    }
  };

  const renderNode = (node: Node, level: number, chain: Crumb[]) => {
    nodeInfoRef.current.set(node.folderId, node);

    const currentChain = [...chain, { folderId: node.folderId, name: node.name, path: node.path }];
    const isActive = currentFolderId === node.folderId && currentPath === node.path;
    const isPicked = mode === 'picker' && pickedFolderId === node.folderId;

    const kids = childrenMap.get(node.folderId) || [];
    const hasChildren = kids.length > 0;
    const isExpanded = expanded.has(node.folderId);

    const handleClick = () => {
      if (mode === 'picker') {
        onPick?.(node.folderId, node.path, currentChain);
        // picker 模式点击也可自动展开（更人性化，不增加 KV 写）
        if (hasChildren && !isExpanded) toggle(node);
      } else {
        onNavigate?.(node.folderId, node.path, currentChain);
        if (hasChildren && !isExpanded) toggle(node);
      }
    };

    return (
      <div key={node.folderId}>
        <div
          className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${isPicked ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
            ${dragOverId === node.folderId ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
          `}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={handleClick}
          onDragOver={
            enableDnD
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(node.folderId);
                }
              : undefined
          }
          onDragLeave={enableDnD ? () => setDragOverId(null) : undefined}
          onDrop={enableDnD ? (e) => handleDrop(e, node.folderId) : undefined}
          title={node.name}
        >
          <div
            className={`p-0.5 rounded hover:bg-slate-300/50 transition-colors flex items-center justify-center w-5 h-5 flex-shrink-0 ${
              !hasChildren ? 'invisible' : ''
            }`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(node);
            }}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
          </div>

          {isActive || isExpanded ? (
            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-yellow-500'}`} />
          ) : (
            <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          )}

          <span className="text-sm truncate select-none block max-w-[170px]">{node.name}</span>

          {mode === 'picker' && isPicked && <Check className="w-4 h-4 text-blue-600 ml-auto" />}
        </div>

        {isExpanded && kids.length > 0 && (
          <div>
            {kids
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => renderNode({ folderId: f.folderId, name: f.name, path: f.key }, level + 1, currentChain))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-auto select-none py-2 px-1 custom-scrollbar">
      <div className="min-w-fit">{renderNode(root, 0, [])}</div>
    </div>
  );
}