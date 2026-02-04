// src/components/FolderTree.tsx

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, Trash2 } from 'lucide-react';
import { api, EntryItem } from '../lib/api';

type Crumb = { id: string; name: string };

interface Props {
  currentFolderId: string;
  onNavigate: (folderId: string, crumb: Crumb[]) => void;
  onDropToFolder: (e: React.DragEvent, folderId: string, crumb: Crumb[]) => void;
}

interface Node {
  id: string;
  name: string;
  children?: Node[];
  loaded?: boolean;
}

const ROOT_ID = 'root';
const TRASH_ID = 'trash';

export function FolderTree({ currentFolderId, onNavigate, onDropToFolder }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT_ID]));
  const [cache, setCache] = useState<Map<string, Node[]>>(new Map());

  const loadChildren = async (folderId: string) => {
    if (cache.has(folderId)) return;
    const items = await api.listFolder(folderId);
    const folders = items
      .filter(x => x.kind === 'folder')
      .map(x => ({ id: x.id, name: x.name, loaded: false } as Node))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    setCache(prev => new Map(prev).set(folderId, folders));
  };

  useEffect(() => {
    loadChildren(ROOT_ID).catch(() => {});
  }, []);

  const toggle = async (folderId: string) => {
    const next = new Set(expanded);
    if (next.has(folderId)) {
      next.delete(folderId);
      setExpanded(next);
      return;
    }
    next.add(folderId);
    setExpanded(next);
    await loadChildren(folderId);
  };

  const renderNode = (node: Node, crumb: Crumb[], level: number) => {
    const isActive = currentFolderId === node.id;
    const isOpen = expanded.has(node.id);
    const children = cache.get(node.id) || [];

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
          style={{ paddingLeft: `${level * 16 + 12}px` }}
          onClick={() => {
            onNavigate(node.id, crumb);
            if (!isOpen) toggle(node.id).catch(() => {});
          }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => onDropToFolder(e, node.id, crumb)}
          title={node.name}
        >
          <button
            className="p-0.5 rounded hover:bg-slate-300/50 w-5 h-5 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); toggle(node.id).catch(() => {}); }}
          >
            {isOpen ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
          </button>

          {isActive || isOpen ? (
            <FolderOpen className="w-4 h-4 text-yellow-500" />
          ) : (
            <Folder className="w-4 h-4 text-yellow-500" />
          )}
          <span className="text-sm truncate max-w-[200px]">{node.name}</span>
        </div>

        {isOpen && children.length > 0 && (
          <div>
            {children.map(child => renderNode(child, [...crumb, { id: child.id, name: child.name }], level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-auto select-none py-2 px-1 custom-scrollbar">
      {/* 根目录 */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap
          ${currentFolderId === ROOT_ID ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
        onClick={() => onNavigate(ROOT_ID, [])}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={(e) => onDropToFolder(e, ROOT_ID, [])}
      >
        <FolderOpen className="w-4 h-4 text-blue-500" />
        <span className="text-sm">根目录</span>
      </div>

      {/* 回收站（固定入口，不需要写 root 索引） */}
      <div
        className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap mt-1
          ${currentFolderId === TRASH_ID ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
        onClick={() => onNavigate(TRASH_ID, [{ id: TRASH_ID, name: '回收站' }])}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={(e) => onDropToFolder(e, TRASH_ID, [{ id: TRASH_ID, name: '回收站' }])}
      >
        <Trash2 className="w-4 h-4 text-slate-500" />
        <span className="text-sm">回收站</span>
      </div>

      <div className="mt-2">
        {(cache.get(ROOT_ID) || []).map(node => renderNode(node, [{ id: node.id, name: node.name }], 0))}
      </div>
    </div>
  );
}
