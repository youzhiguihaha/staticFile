interface Env {
  FILES_KV: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  try {
    const fileListStr = await env.FILES_KV.get('file_list');
    const fileList: string[] = fileListStr ? JSON.parse(fileListStr) : [];

    const files = await Promise.all(
      fileList.map(async (id) => {
        const metaStr = await env.FILES_KV.get(`meta:${id}`);
        if (metaStr) {
          const meta = JSON.parse(metaStr);
          const url = new URL(request.url);
          return { ...meta, url: `${url.origin}/api/file/${id}` };
        }
        return null;
      })
    );

    return new Response(JSON.stringify({ 
      success: true, 
      files: files.filter(Boolean) 
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, files: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
