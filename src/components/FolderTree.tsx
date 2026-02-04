// src/components/FolderTree.tsx
import { useEffect, useMemo, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
import { api, FolderItem, MoveItem } from '../lib/api';
import toast from 'react-hot-toast';

interface Props {
  refreshNonce?: number;
  currentFolderId: string;
  currentPath: string;
  onNavigate: (folderId: string, path: string) => void;
  onMove: (items: MoveItem[], targetFolderId: string) => void;
}

interface Node {
  folderId: string;
  name: string;
  path: string; // UI path，仅用于生成子 key
}

export function FolderTree({ refreshNonce = 0, currentFolderId, currentPath, onNavigate, onMove }: Props) {
  const [childrenMap, setChildrenMap] = useState<Map<string, FolderItem[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const root: Node = useMemo(() => ({ folderId: 'root', name: '根目录', path: '' }), []);

  const loadChildren = async (node: Node) => {
    if (childrenMap.has(node.folderId)) return;
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

  useEffect(() => {
    // refresh 时清理缓存（避免树显示旧结构）
    setChildrenMap(new Map());
    setExpanded(new Set());
    loadChildren(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce]);

  useEffect(() => {
    // 初次加载 root
    loadChildren(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const { moveItems } = JSON.parse(data);
      if (!Array.isArray(moveItems) || !moveItems.length) return;

      await onMove(moveItems as MoveItem[], targetFolderId);

      // 移动后：清掉目标节点缓存，下次展开重新读一次（读很便宜）
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.delete(targetFolderId);
        return next;
      });
    } catch (err: any) {
      toast.error(err?.message || '移动失败');
    }
  };

  const renderNode = (node: Node, level: number) => {
    const isActive = currentFolderId === node.folderId && currentPath === node.path;
    const kids = childrenMap.get(node.folderId) || [];
    const hasChildren = kids.length > 0;
    const isExpanded = expanded.has(node.folderId);

    return (
      <div key={node.folderId}>
        <div
          className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${dragOverId === node.folderId ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
          `}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => onNavigate(node.folderId, node.path)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverId(node.folderId);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => handleDrop(e, node.folderId)}
          title={node.name}
        >
          <div
            className={`p-0.5 rounded hover:bg-slate-300/50 transition-colors flex items-center justify-center w-5 h-5 flex-shrink-0 ${!hasChildren ? 'invisible' : ''}`}
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

          <span className="text-sm truncate select-none block max-w-[200px]">{node.name}</span>
        </div>

        {isExpanded && kids.length > 0 && (
          <div>
            {kids
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((f) => renderNode({ folderId: f.folderId, name: f.name, path: f.key }, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-auto select-none py-2 px-1 custom-scrollbar">
      <div className="min-w-fit">{renderNode(root, 0)}</div>
    </div>
  );
}
