import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { api, FolderItem, MoveItem } from '../lib/api';

export type Crumb = { folderId: string; name: string; path: string };
export type SharedTreeState = {
  childrenMap: Map<string, FolderItem[]>; setChildrenMap: any;
  expanded: Set<string>; setExpanded: any;
  nodeInfoRef: React.MutableRefObject<Map<string, { folderId: string; name: string; path: string }>>;
};
type Mode = 'navigator' | 'picker';
interface Props {
  refreshNonce?: number; invalidateNonce?: number; invalidateFolderIds?: string[];
  currentFolderId: string; currentPath: string;
  onNavigate?: (folderId: string, path: string, chain: Crumb[]) => void;
  onMove?: (items: MoveItem[], targetFolderId: string) => void;
  enableDnD?: boolean; mode?: Mode; pickedFolderId?: string;
  onPick?: (folderId: string, path: string, chain: Crumb[]) => void;
  shared?: SharedTreeState;
}
interface Node { folderId: string; name: string; path: string; }

export function FolderTree({ refreshNonce = 0, invalidateNonce = 0, invalidateFolderIds = [], currentFolderId, currentPath, onNavigate, onMove, enableDnD = true, mode = 'navigator', pickedFolderId, onPick, shared }: Props) {
  const [cMapL, setCMapL] = useState(new Map()); const [expL, setExpL] = useState(new Set()); const nodeRefL = useRef(new Map());
  const childrenMap = shared?.childrenMap ?? cMapL; const setChildrenMap = shared?.setChildrenMap ?? setCMapL;
  const expanded = shared?.expanded ?? expL; const setExpanded = shared?.setExpanded ?? setExpL;
  const nodeInfoRef = (shared?.nodeInfoRef ?? nodeRefL) as React.MutableRefObject<Map<string, Node>>;
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const root: Node = useMemo(() => ({ folderId: 'root', name: '我的云盘', path: '' }), []);

  const load = async (node: Node, force = false) => {
    if (!force && childrenMap.has(node.folderId)) return;
    try {
      const res = await api.list(node.folderId, node.path);
      setChildrenMap((p:any) => { const n = new Map(p); n.set(node.folderId, res.folders); return n; });
    } catch {}
  };

  useEffect(() => { if(refreshNonce > 0) { setChildrenMap(new Map()); setExpanded(new Set()); load(root, true); } }, [refreshNonce]);
  useEffect(() => { if (!childrenMap.has('root')) load(root); }, []);
  useEffect(() => {
    if (!invalidateFolderIds.length) return;
    setChildrenMap((p:any) => { const n = new Map(p); invalidateFolderIds.forEach(id => n.delete(id)); return n; });
    invalidateFolderIds.forEach(id => { if(expanded.has(id)) { const i = nodeInfoRef.current.get(id); if(i) load(i, true); }});
  }, [invalidateNonce]);

  const toggle = async (node: Node) => {
    if (!expanded.has(node.folderId)) { await load(node); setExpanded((p:any) => { const n = new Set(p); n.add(node.folderId); return n; }); }
    else setExpanded((p:any) => { const n = new Set(p); n.delete(node.folderId); return n; });
  };

  const renderNode = (node: Node, level: number, chain: Crumb[]) => {
    nodeInfoRef.current.set(node.folderId, node);
    const currentChain = [...chain, { folderId: node.folderId, name: node.name, path: node.path }];
    const isActive = currentFolderId === node.folderId;
    const isPicked = mode === 'picker' && pickedFolderId === node.folderId;
    const kids = childrenMap.get(node.folderId) || [];
    const isExp = expanded.has(node.folderId);
    
    // UI 细节优化
    const isRoot = node.folderId === 'root';
    const paddingLeft = level * 16 + 12;

    return (
      <div key={node.folderId} className="select-none">
        <div 
          className={`
            group flex items-center gap-2 py-1.5 pr-3 my-0.5 mr-2 rounded-r-full cursor-pointer transition-all duration-200 border-l-[3px]
            ${isActive 
              ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-semibold' 
              : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'}
            ${isPicked ? 'bg-green-50 border-green-500 text-green-700' : ''}
            ${dragOverId===node.folderId ? 'bg-indigo-100 border-indigo-400' : ''}
          `}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => {
            if (mode === 'picker') { onPick?.(node.folderId, node.path, currentChain); if (kids.length && !isExp) toggle(node); }
            else { onNavigate?.(node.folderId, node.path, currentChain); if (kids.length && !isExp) toggle(node); }
          }}
          onDragOver={enableDnD ? (e) => { e.preventDefault(); setDragOverId(node.folderId); } : undefined}
          onDragLeave={enableDnD ? () => setDragOverId(null) : undefined}
          onDrop={enableDnD ? (e) => { e.preventDefault(); e.stopPropagation(); setDragOverId(null); const d = e.dataTransfer.getData('application/json'); if(d) { try{ const p = JSON.parse(d); if(p.moveItems) onMove?.(p.moveItems, node.folderId); }catch{} } } : undefined}
        >
          <div className={`p-0.5 rounded-md hover:bg-black/5 text-slate-400 transition-colors ${!kids.length && !isRoot ? 'invisible' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(node); }}>
            {isExp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
          
          {isRoot ? <Folder className="w-4 h-4 text-indigo-500" /> : (isExp ? <FolderOpen className={`w-4 h-4 ${isActive?'text-indigo-600':'text-yellow-500'}`} /> : <Folder className={`w-4 h-4 ${isActive?'text-indigo-600':'text-yellow-500'}`} />)}
          
          <span className="truncate text-sm flex-1">{node.name}</span>
          {mode === 'picker' && isPicked && <Check className="w-4 h-4 text-green-600" />}
        </div>
        {isExp && kids.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(f => renderNode({ folderId: f.folderId, name: f.name, path: f.key }, level + 1, currentChain))}
      </div>
    );
  };

  return <div className="w-full h-full overflow-y-auto overflow-x-hidden py-3 custom-scrollbar">{renderNode(root, 0, [])}</div>;
}