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
  path: string; // 文件的 key 或 文件夹的 path
  isFolder: boolean;
  type?: string;
  children: Record<string, TreeNode>;
}

export function FolderTree({ files, currentPath, onNavigate, onDrop }: Props) {
  const tree = useMemo(() => {
    const root: TreeNode = { name: 'Root', path: '', isFolder: true, children: {} };
    
    files.forEach(f => {
        // 分割路径
        const parts = f.key.split('/');
        // 如果是文件夹标记 (key以/结尾)，最后一部分是空字符串，需要去掉
        const cleanParts = parts.filter(Boolean);
        
        let currentNode = root;
        let currentPathAcc = '';

        cleanParts.forEach((part, index) => {
            currentPathAcc += part;
            const isLast = index === cleanParts.length - 1;
            
            // 如果是最后一个节点，且原 key 不以 / 结尾，则它是文件
            const isFile = isLast && !f.key.endsWith('/');
            const nodePath = isFile ? f.key : currentPathAcc + '/';
            
            if (!currentNode.children[part]) {
                currentNode.children[part] = { 
                    name: part, 
                    path: nodePath,
                    isFolder: !isFile,
                    type: isFile ? f.type : undefined,
                    children: {} 
                };
            }
            currentNode = currentNode.children[part];
            
            // 路径累加时如果是目录要加 /
            if (!isFile) currentPathAcc += '/';
        });
    });
    return root;
  }, [files]);

  return (
    <div className="w-full h-full overflow-y-auto select-none py-2 px-1">
      <div 
        className={`flex items-center gap-2 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors ${currentPath === '' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}`}
        onClick={() => onNavigate('')}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onDrop={e => onDrop(e, '')}
      >
        <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="text-sm">根目录</span>
      </div>
      
      <div className="mt-1">
        {Object.values(tree.children).sort((a,b) => (b.isFolder?1:0)-(a.isFolder?1:0)).map(node => (
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

  // 文件图标逻辑
  const FileIcon = useMemo(() => {
      if (!node.type) return File;
      if (node.type.startsWith('image')) return FileImage;
      if (node.type.includes('javascript') || node.type.includes('json') || node.type.includes('html')) return FileCode;
      if (node.type.includes('text')) return FileText;
      return File;
  }, [node.type]);

  const handleToggle = (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded(!expanded);
  };

  const handleClick = () => {
      onNavigate(node.path);
      if (node.isFolder && !expanded) setExpanded(true);
  };

  return (
    <div>
      <div 
        className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer transition-colors 
            ${isActive ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-200/50'}
            ${isDragOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
        `}
        style={{ paddingLeft: `${level * 14 + 12}px` }}
        onClick={handleClick}
        onDragOver={node.isFolder ? e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); } : undefined}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={node.isFolder ? e => { setIsDragOver(false); onDrop(e, node.path); } : undefined}
      >
        <div 
            className={`p-0.5 rounded hover:bg-slate-300/50 transition-colors flex items-center justify-center w-5 h-5 flex-shrink-0 ${!hasChildren && node.isFolder ? 'invisible' : ''}`}
            onClick={node.isFolder ? handleToggle : undefined}
        >
            {node.isFolder ? (
                expanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-400" />
            ) : <div className="w-3 h-3" />}
        </div>
        
        {node.isFolder ? (
            (isActive || expanded) ? <FolderOpen className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-yellow-500'}`} /> 
            : <Folder className="w-4 h-4 text-yellow-500 flex-shrink-0" />
        ) : (
            <FileIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
        
        <span className="text-sm truncate select-none">{node.name}</span>
      </div>

      {expanded && hasChildren && (
        <div className="border-l border-slate-200 ml-[calc(12px+10px)] pl-0.5">
           {Object.values(node.children).sort((a,b) => (b.isFolder?1:0)-(a.isFolder?1:0)).map(child => (
               <TreeNodeItem key={child.path} node={child} currentPath={currentPath} onNavigate={onNavigate} onDrop={onDrop} level={level + 1} />
           ))}
        </div>
      )}
    </div>
  );
}
