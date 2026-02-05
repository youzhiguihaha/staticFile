import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { api, FolderItem, MoveItem } from '../lib/api';

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

interface Node { folderId: string; name: string; path: string; }

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
  // 本地状态 (如果未提供共享状态)
  const [cMapLocal, setCMapLocal] = useState(new Map());
  const [expLocal, setExpLocal] = useState(new Set());
  const nodeRefLocal = useRef(new Map());

  const childrenMap = shared?.childrenMap ?? cMapLocal;
  const setChildrenMap = shared?.setChildrenMap ?? setCMapLocal;
  const expanded = shared?.expanded ?? expLocal;
  const setExpanded = shared?.setExpanded ?? setExpLocal;
  const nodeInfoRef = (shared?.nodeInfoRef ?? nodeRefLocal) as React.MutableRefObject<Map<string, Node>>;

  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const root: Node = useMemo(() => ({ folderId: 'root', name: '根目录', path: '' }), []);

  const load = async (node: Node, force = false) => {
    if (!force && childrenMap.has(node.folderId)) return;
    try {
      const res = await api.list(node.folderId, node.path);
      setChildrenMap((prev: any) => {
        const next = new Map(prev);
        next.set(node.folderId, res.folders);
        return next;
      });
    } catch {}
  };

  useEffect(() => {
    if (refreshNonce > 0) {
      setChildrenMap(new Map());
      setExpanded(new Set());
      load(root, true);
    }
  }, [refreshNonce]);

  useEffect(() => {
    if (!childrenMap.has('root')) load(root);
  }, []);

  useEffect(() => {
    if (!invalidateFolderIds.length) return;
    setChildrenMap((prev: any) => {
      const next = new Map(prev);
      invalidateFolderIds.forEach(id => next.delete(id));
      return next;
    });
    invalidateFolderIds.forEach(id => {
      if (expanded.has(id)) {
        const info = nodeInfoRef.current.get(id);
        if (info) load(info, true);
      }
    });
  }, [invalidateNonce]);

  const toggle = async (node: Node) => {
    if (!expanded.has(node.folderId)) {
      await load(node);
      setExpanded((p: any) => {
        const n = new Set(p);
        n.add(node.folderId);
        return n;
      });
    } else {
      setExpanded((p: any) => {
        const n = new Set(p);
        n.delete(node.folderId);
        return n;
      });
    }
  };

  const renderNode = (node: Node, level: number, chain: Crumb[]) => {
    nodeInfoRef.current.set(node.folderId, node);
    const currentChain = [...chain, { folderId: node.folderId, name: node.name, path: node.path }];
    const isActive = currentFolderId === node.folderId;
    const isPicked = mode === 'picker' && pickedFolderId === node.folderId;
    
    const kids = childrenMap.get(node.folderId) || [];
    const hasChildren = kids.length > 0;
    const isExp = expanded.has(node.folderId);

    return (
      <div key={node.folderId}>
        <div 
          className={`flex items-center gap-2 py-1.5 px-2 mx-1 rounded-lg cursor-pointer transition-all whitespace-nowrap text-sm select-none 
            ${isActive ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-slate-600 hover:bg-slate-100'} 
            ${isPicked ? 'ring-2 ring-blue-500 bg-blue-50' : ''} 
            ${dragOverId === node.folderId ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
          `} 
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => {
            if (mode === 'picker') {
              onPick?.(node.folderId, node.path, currentChain);
              if (hasChildren && !isExp) toggle(node);
            } else {
              onNavigate?.(node.folderId, node.path, currentChain);
              if (hasChildren && !isExp) toggle(node);
            }
          }}
          onDragOver={enableDnD ? (e) => { e.preventDefault(); setDragOverId(node.folderId); } : undefined}
          onDragLeave={enableDnD ? () => setDragOverId(null) : undefined}
          onDrop={enableDnD ? (e) => { 
            e.preventDefault(); 
            e.stopPropagation(); 
            setDragOverId(null); 
            const data = e.dataTransfer.getData('application/json'); 
            if (data) { 
              try { 
                const p = JSON.parse(data); 
                if (p.moveItems) onMove?.(p.moveItems, node.folderId); 
              } catch {} 
            } 
          } : undefined}
        >
          <div 
            className={`p-0.5 rounded hover:bg-black/5 transition-colors ${!hasChildren && node.folderId !== 'root' ? 'invisible' : ''}`} 
            onClick={(e) => { e.stopPropagation(); toggle(node); }}
          >
            {isExp ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
          
          <FolderOpen className={`w-5 h-5 flex-shrink-0 ${isActive || isPicked ? 'text-blue-500' : 'text-yellow-500'}`} />
          <span className="truncate">{node.name}</span>
          {mode === 'picker' && isPicked && <Check className="w-4 h-4 text-blue-600 ml-auto" />}
        </div>
        
        {isExp && kids.slice().sort((a, b) => a.name.localeCompare(b.name)).map(f => 
          renderNode({ folderId: f.folderId, name: f.name, path: f.key }, level + 1, currentChain)
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-auto py-2 custom-scrollbar">
      {renderNode(root, 0, [])}
    </div>
  );
}