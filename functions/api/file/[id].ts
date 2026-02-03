// Cloudflare Pages Function - 获取文件内容 (公开访问，无需认证)
// 需要绑定 KV 命名空间: FILES_KV

interface Env {
  FILES_KV: KVNamespace;
}

interface FileMetadataKV {
  name: string;
  type: string;
  size: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const fileId = context.params.id as string;

    // 获取文件内容和元数据
    const { value, metadata } = await context.env.FILES_KV.getWithMetadata<FileMetadataKV>(`file:${fileId}`, 'arrayBuffer');

    if (!value) {
      return new Response('文件不存在', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const contentType = metadata?.type || 'application/octet-stream';
    const fileName = metadata?.name || 'file';

    // 设置缓存头，让 Cloudflare CDN 缓存文件
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // 缓存1年
      'Access-Control-Allow-Origin': '*',
    };

    // 如果不是图片/视频/音频等可以直接预览的文件，则添加下载头
    const previewableTypes = [
      'image/', 'video/', 'audio/', 'text/', 'application/pdf',
      'application/json', 'application/javascript', 'application/xml'
    ];
    
    const isPreviewable = previewableTypes.some(type => contentType.startsWith(type) || contentType === type);
    
    if (!isPreviewable) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fileName)}"`;
    }

    return new Response(value, { headers });

  } catch (error) {
    console.error('Get file error:', error);
    return new Response('获取文件失败', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
};
