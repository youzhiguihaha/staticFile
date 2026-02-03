// Cloudflare Pages Function - 认证接口
// 在 Cloudflare Pages 设置环境变量: AUTH_PASSWORD (管理密码)

interface Env {
  AUTH_PASSWORD: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const { password } = await context.request.json() as { password: string };
    const correctPassword = context.env.AUTH_PASSWORD || 'admin123';

    if (password === correctPassword) {
      // 生成简单的 token (生产环境建议使用 JWT)
      const token = btoa(`${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        token,
        message: '登录成功' 
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '密码错误' 
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '请求错误' 
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
};
