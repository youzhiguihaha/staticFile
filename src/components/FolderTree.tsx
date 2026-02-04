import { useState, useMemo } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown, FileText, FileImage, FileCode, File } from 'lucide-react';
import { FileItem } from '../lib/api';

interface Props {
  files: FileItem[];
  currentPath: string;
  onNavigate: (path: string) => void;
  onDrop: (e: React.DragEvent, targetPath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  type?: string;
  children: Record<string, TreeNode>;
}

export function FolderTree({ files, currentPath, onNavigate, onDrop }: Props) {
  const tree = useMemo(() => {
    const root: TreeNode = { name: 'Root', path: '', isFolder: true, children: {} };
    files.forEach(f => {
        const parts = f.key.split('/');
        const cleanParts = parts.filter(Boolean);
        let currentNode = root;
        let currentPathAcc = '';
        cleanParts.forEach((part, index) => {
            currentPathAcc += part;
            const isLast = index === cleanParts.length - 1;
            const isFile = isLast && !f.key.endsWith('/');
            const nodePath = isFile ? f.key : currentPathAcc + '/';
            if (!currentNode.children[part]) {
                currentNode.children[part] = { 
                    name: part, path: nodePath, isFolder: !isFile, type: isFile ? f.type : undefined, children: {} 
                };
            }
            currentNode = currentNode.children[part];
            if (!isFile) currentPathAcc += '/';
        });
    });
    return root;
  }, [files]);

  return (
    <div className="w-full h-full overflow-auto select-none py-2 px-1 custom-scrollbar">
      <div className="min-w-fit">
          <div 
            className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${currentPath === '' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
            onClick={() => onNavigate('')}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={e => onDrop(e, '')}
          >
            <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <span className="text-sm">根目录</span>
          </div>
          <div className="mt-1 relative">
            {Object.values(tree.children).sort((a,b) => (b.isFolder?1:0)-(a.isFolder?1:0)).map(node => (
                <TreeNodeItem key={node.path} node={node} currentPath={currentPath} onNavigate={onNavigate} onDrop={onDrop} level={0} />
            ))}
          </div>
      </div>
    </div>
  );
}

function TreeNodeItem({ node, currentPath, onNavigate, onDrop, level }: { node: TreeNode, currentPath: string, onNavigate: (path: string) => void, onDrop: any, level: number }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = currentPath === node.path;
  const hasChildren = Object.keys(node.children).length > 0;
  const [isDragOver, setIsDragOver] = useState(false);

  const FileIcon = useMemo(() => {
      if (!node.type) return File;
      if (node.type.startsWith('image')) return FileImage;
      if (node.type.includes('javascript') || node.type.includes('json') || node.type.includes('html')) return FileCode;
      if (node.type.includes('text')) return FileText;
      return File;
  }, [node.type]);

  const handleToggle = (e: React.MouseEvent) => { e.stopPropagation(); setExpanded(!expanded); };
  const handleClick = () => { onNavigate(node.path); if (node.isFolder && !expanded) setExpanded(true); };

  return (
    <div className="relative">
      {level > 0 && <div className="absolute top-0 bottom-0 border-l border-slate-200/50" style={{ left: `${level * 16 + 4}px` }} />}
      <div 
        className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer transition-colors whitespace-nowrap relative z-10
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${isDragOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
        `}
        style={{ paddingLeft: `${level * 16 + 12}px` }} 
        onClick={handleClick}
        onDragOver={node.isFolder ? e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); } : undefined}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={node.isFolder ? e => { setIsDragOver(false); onDrop(e, node.path); } : undefined}
        title={node.name}
      >
        <div className={`p-0.5 rounded hover:bg-slate-300/50 transition-colors flex items-center justify-center w-5 h-5 flex-shrink-0 ${!hasChildren && node.isFolder ? 'invisible' : ''}`} onClick={node.isFolder ? handleToggle : undefined}>
            {node.isFolder ? (expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-400" />) : <div className="w-3 h-3" />}
        </div>
        
        {node.isFolder ? (
            (isActive || expanded) ? <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-yellow-500'}`} /> : <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
        ) : (
            <FileIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
        <span className="text-sm truncate select-none block max-w-[200px]">{node.name}</span>
      </div>

      {expanded && hasChildren && (
        <div>
           {Object.values(node.children).sort((a,b) => (b.isFolder?1:0)-(a.isFolder?1:0)).map(child => (
               <TreeNodeItem key={child.path} node={child} currentPath={currentPath} onNavigate={onNavigate} onDrop={onDrop} level={level + 1} />
           ))}
        </div>
      )}
    </div>
  );
}
