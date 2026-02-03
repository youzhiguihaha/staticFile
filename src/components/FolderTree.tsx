import { useState, useMemo } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
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
  children: Record<string, TreeNode>;
}

export function FolderTree({ files, currentPath, onNavigate, onDrop }: Props) {
  // 构建树结构
  const tree = useMemo(() => {
    const root: TreeNode = { name: 'Root', path: '', children: {} };
    const folderPaths = new Set<string>();
    
    files.forEach(f => {
        if (f.name.endsWith('/')) folderPaths.add(f.key); 
        const parts = f.key.split('/');
        if (parts.length > 1) {
             let acc = '';
             for (let i = 0; i < parts.length - 1; i++) {
                 acc += parts[i] + '/';
                 folderPaths.add(acc);
             }
        }
    });

    Array.from(folderPaths).sort().forEach(path => {
        const parts = path.split('/').filter(Boolean);
        let currentNode = root;
        let currentPathAcc = '';
        parts.forEach(part => {
            currentPathAcc += part + '/';
            if (!currentNode.children[part]) {
                currentNode.children[part] = { name: part, path: currentPathAcc, children: {} };
            }
            currentNode = currentNode.children[part];
        });
    });
    return root;
  }, [files]);

  return (
    <div className="w-full border-r border-slate-200 bg-slate-50/50 flex flex-col h-full overflow-y-auto select-none py-2">
      <div 
        className={`flex items-center gap-2 px-4 py-2 mx-2 rounded-lg cursor-pointer transition-colors ${currentPath === '' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
        onClick={() => onNavigate('')}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={e => onDrop(e, '')}
      >
        <FolderOpen className="w-4 h-4 text-blue-500" />
        <span className="text-sm">根目录</span>
      </div>
      
      <div className="mt-1">
        {Object.values(tree.children).map(node => (
            <TreeNodeItem key={node.path} node={node} currentPath={currentPath} onNavigate={onNavigate} onDrop={onDrop} level={0} />
        ))}
      </div>
    </div>
  );
}

function TreeNodeItem({ node, currentPath, onNavigate, onDrop, level }: { node: TreeNode, currentPath: string, onNavigate: (path: string) => void, onDrop: any, level: number }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = currentPath === node.path;
  const hasChildren = Object.keys(node.children).length > 0;
  const [isDragOver, setIsDragOver] = useState(false);

  // 只要路径匹配，就自动展开父级 (简单的自动展开逻辑)
  // 注意：这只是一个简单的副作用，如果想做完美的自动展开需要自顶向下传递 props
  // 这里我们手动控制点击展开
  
  const handleToggle = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded(!expanded);
  };

  return (
    <div>
      <div 
        className={`flex items-center gap-1 py-1.5 px-2 mx-2 rounded-md cursor-pointer transition-colors 
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${isDragOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
        `}
        style={{ paddingLeft: `${level * 12 + 12}px` }}
        onClick={() => { onNavigate(node.path); if(!expanded && hasChildren) setExpanded(true); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => { setIsDragOver(false); onDrop(e, node.path); }}
      >
        <div 
            className="p-1 -ml-1 hover:bg-slate-300/50 rounded-full transition-colors flex items-center justify-center w-5 h-5"
            onClick={handleToggle}
        >
            {hasChildren ? (
                expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-400" />
            ) : <div className="w-3 h-3" />}
        </div>
        
        {isActive || expanded ? <FolderOpen className={`w-4 h-4 ${isActive ? 'text-blue-500' : 'text-yellow-500'}`} /> : <Folder className="w-4 h-4 text-yellow-500" />}
        <span className="text-sm truncate select-none">{node.name}</span>
      </div>

      {expanded && (
        <div className="animate-in slide-in-from-top-1 duration-200">
           {Object.values(node.children).map(child => (
               <TreeNodeItem key={child.path} node={child} currentPath={currentPath} onNavigate={onNavigate} onDrop={onDrop} level={level + 1} />
           ))}
        </div>
      )}
    </div>
  );
}
