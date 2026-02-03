interface Env {
  FILES_KV: KVNamespace;
}

// 公开访问 - 获取文件内容
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;

  try {
    const [metaStr, base64] = await Promise.all([
      env.FILES_KV.get(`meta:${id}`),
      env.FILES_KV.get(`file:${id}`),
    ]);

    if (!metaStr || !base64) {
      return new Response('文件不存在', { status: 404 });
    }

    const meta = JSON.parse(metaStr);
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    return new Response(bytes, {
      headers: {
        'Content-Type': meta.type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(meta.name)}"`,
        'Cache-Control': 'public, max-age=31536000',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('获取文件失败', { status: 500 });
  }
};

// 删除文件
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const id = params.id as string;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    await env.FILES_KV.delete(`file:${id}`);
    await env.FILES_KV.delete(`meta:${id}`);

    const fileListStr = await env.FILES_KV.get('file_list');
    if (fileListStr) {
      const fileList: string[] = JSON.parse(fileListStr);
      const newList = fileList.filter(fid => fid !== id);
      await env.FILES_KV.put('file_list', JSON.stringify(newList));
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ success: false }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
