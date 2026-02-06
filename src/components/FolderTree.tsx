// src/components/FolderTree.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Check, Loader2 } from 'lucide-react';
import * as api from '../lib/api';
import type { FolderItem, MoveItem } from '../lib/api';
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

  onNavigate?: (folderId: string, path: string, chain: Crumb[]) => void;

  onMove?: (items: MoveItem[], targetFolderId: string) => void;
  enableDnD?: boolean;

  mode?: Mode;
  pickedFolderId?: string;
  onPick?: (folderId: string, path: string, chain: Crumb[]) => void;

  shared?: SharedTreeState;
}

interface Node {
  folderId: string;
  name: string;
  path: string;
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
  const [childrenMapLocal, setChildrenMapLocal] = useState<Map<string, FolderItem[]>>(new Map());
  const [expandedLocal, setExpandedLocal] = useState<Set<string>>(new Set());
  const nodeInfoRefLocal = useRef<Map<string, Node>>(new Map());

  const childrenMap = shared?.childrenMap ?? childrenMapLocal;
  const setChildrenMap = shared?.setChildrenMap ?? setChildrenMapLocal;
  const expanded = shared?.expanded ?? expandedLocal;
  const setExpanded = shared?.setExpanded ?? setExpandedLocal;
  const nodeInfoRef = (shared?.nodeInfoRef ?? nodeInfoRefLocal) as React.MutableRefObject<Map<string, Node>>;

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const inflightRef = useRef<Map<string, AbortController>>(new Map());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const root: Node = useMemo(() => ({ folderId: 'root', name: '根目录', path: '' }), []);

  // ===== UI: 自动把当前目录滚动到可视区域（体验优化，不改业务）=====
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const target = el.querySelector<HTMLElement>(`[data-fid="${currentFolderId}"]`);
    if (!target) return;

    // 让 active 行尽量保持在可视区中间附近
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentFolderId]);

  const setLoading = (folderId: string, on: boolean) => {
    setLoadingIds((prev) => {
      const next = new Set(prev);
      on ? next.add(folderId) : next.delete(folderId);
      return next;
    });
  };

  const abortInflight = (folderId: string) => {
    const c = inflightRef.current.get(folderId);
    if (c) {
      c.abort();
      inflightRef.current.delete(folderId);
      setLoading(folderId, false);
    }
  };

  const abortAllInflight = () => {
    for (const c of inflightRef.current.values()) c.abort();
    inflightRef.current.clear();
    setLoadingIds(new Set());
  };

  const loadChildren = async (node: Node, force = false) => {
    const fid = node.folderId;

    if (!force && childrenMap.has(fid)) return;
    if (!force && inflightRef.current.has(fid)) return;
    if (force) abortInflight(fid);

    const controller = new AbortController();
    inflightRef.current.set(fid, controller);
    setLoading(fid, true);

    try {
      const res = await api.list(node.folderId, node.path, { signal: controller.signal });
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.set(node.folderId, res.folders);
        return next;
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      toast.error('加载目录失败');
    } finally {
      const cur = inflightRef.current.get(fid);
      if (cur === controller) inflightRef.current.delete(fid);
      setLoading(fid, false);
    }
  };

  useEffect(() => {
    abortAllInflight();
    setChildrenMap(new Map());
    setExpanded(new Set());
    loadChildren(root, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

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
      } else {
        abortInflight(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalidateNonce]);

  const toggle = async (node: Node) => {
    const fid = node.folderId;
    const isExpanded = expanded.has(fid);

    if (isExpanded) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(fid);
        return next;
      });
      return;
    }

    await loadChildren(node);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(fid);
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

    const loaded = childrenMap.has(node.folderId);
    const kids = childrenMap.get(node.folderId) || [];
    const canExpand = !loaded || kids.length > 0;
    const isExpanded = expanded.has(node.folderId);
    const isLoading = loadingIds.has(node.folderId);

    const navigateHere = () => {
      if (mode === 'picker') {
        onPick?.(node.folderId, node.path, currentChain);
      } else {
        onNavigate?.(node.folderId, node.path, currentChain);
      }
    };

    const handleClickRow = () => {
      // ✅ 体验优化：点“行”一定会导航（显示该目录内容）
      // 同时，如果可展开且未展开，顺便展开（保持你原风格）
      navigateHere();
      if (canExpand && !isExpanded) toggle(node);
    };

    // UI：缩进封顶，避免深层目录把文本挤没
    const padLeft = Math.min(level, 6) * 16 + 12;

    return (
      <div key={node.folderId}>
        <div
          data-fid={node.folderId}
          className={`flex items-center gap-1.5 py-[clamp(6px,0.9vw,8px)] px-2 mx-1 rounded-md cursor-pointer transition-colors min-w-0
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${isPicked ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
            ${dragOverId === node.folderId ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
          `}
          style={{ paddingLeft: `${padLeft}px` }}
          onClick={handleClickRow}
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
          aria-current={isActive ? 'page' : undefined}
        >
          <button
            type="button"
            className={`rounded hover:bg-slate-300/50 transition-colors flex items-center justify-center w-7 h-7 flex-shrink-0 ${
              !canExpand ? 'invisible' : ''
            }`}
            onClick={(e) => {
              // ✅ 关键优化：很多用户会点“箭头”来进入目录
              // 这里改为：点箭头也会“进入并显示内容”，同时展开/收起（不改业务逻辑，只改交互）
              e.stopPropagation();
              navigateHere();
              if (canExpand) toggle(node);
            }}
            aria-label={isExpanded ? '收起并进入' : '展开并进入'}
            title={isExpanded ? '收起（并显示该目录内容）' : '展开（并显示该目录内容）'}
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="w-3 h-3 text-slate-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-slate-400" />
            )}
          </button>

          {isActive || isExpanded ? (
            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-yellow-500'}`} />
          ) : (
            <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          )}

          <span className="text-[clamp(12px,1vw,14px)] truncate select-none flex-1 min-w-0">{node.name}</span>

          {mode === 'picker' && isPicked && <Check className="w-4 h-4 text-blue-600 ml-auto flex-shrink-0" />}
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
    <div ref={containerRef} className="w-full h-full overflow-y-auto overflow-x-hidden select-none py-2 px-1 custom-scrollbar overscroll-contain">
      {/* 轻量提示：让用户知道“箭头/行点击都能进入并显示内容” */}
      <div className="px-3 py-2 text-[11px] text-slate-400">
        提示：点击文件夹（或左侧箭头）可进入并显示内容
      </div>

      <div className="w-full min-w-0">{renderNode(root, 0, [])}</div>
    </div>
  );

}
