# 云存储文件管理系统

基于 Cloudflare Pages + KV 构建的自托管静态文件存储系统。

## 功能特性

- 🔐 **密码保护**: 管理后台需要密码登录才能操作
- 📤 **文件上传**: 支持拖拽上传，支持任意文件类型
- 📋 **文件管理**: 查看已上传文件列表，支持删除
- 🔗 **直链分享**: 点击复制文件直链，无需登录即可访问
- ☁️ **CDN 加速**: 利用 Cloudflare 全球 CDN 加速文件访问
- 💾 **持久存储**: 文件存储在 Cloudflare KV 中

## 部署步骤

### 1. Fork 或 Clone 项目

```bash
git clone <your-repo-url>
cd <project-folder>
```

### 2. 安装依赖并构建

```bash
npm install
npm run build
```

### 3. 创建 Cloudflare Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Pages** > **Create a project**
3. 连接你的 Git 仓库
4. 构建设置:
   - **Framework preset**: `None`
   - **构建命令**: `npm run build`
   - **构建输出目录**: `dist`
   - **根目录**: `/` (留空)
   - ⚠️ **不要设置 Deploy command**，留空即可！

### 4. 创建 KV 命名空间

1. 在 Cloudflare Dashboard 进入 **Workers & Pages** > **KV**
2. 点击 **Create namespace**
3. 输入名称，例如: `FILES_KV`
4. 记下创建的 KV 命名空间 ID

### 5. 绑定 KV 到 Pages

1. 进入你的 Pages 项目 > **Settings** > **Functions**
2. 在 **KV namespace bindings** 中:
   - **Variable name**: `FILES_KV`
   - **KV namespace**: 选择你创建的命名空间

### 6. 设置环境变量

1. 在 Pages 项目 > **Settings** > **Environment variables**
2. 添加变量:
   - **Variable name**: `AUTH_PASSWORD`
   - **Value**: 你的管理密码 (例如: `your-secure-password`)
3. 建议分别为 Production 和 Preview 环境设置

### 7. 重新部署

1. 提交一个新的 commit 触发部署
2. 或在 Pages 控制台手动触发重新部署

## 项目结构

```
├── src/                    # 前端源码
│   ├── components/        # React 组件
│   │   ├── Login.tsx      # 登录页面
│   │   ├── Dashboard.tsx  # 管理后台
│   │   ├── FileUpload.tsx # 文件上传组件
│   │   └── FileList.tsx   # 文件列表组件
│   ├── hooks/             # 自定义 Hooks
│   │   ├── useAuth.ts     # 认证状态管理
│   │   └── useFiles.ts    # 文件操作
│   ├── types/             # TypeScript 类型定义
│   └── App.tsx            # 主应用组件
├── functions/              # Cloudflare Pages Functions
│   └── api/
│       ├── auth.ts        # 登录认证接口
│       ├── upload.ts      # 文件上传接口
│       ├── files.ts       # 获取文件列表接口
│       ├── files/[id].ts  # 删除文件接口
│       └── file/[id].ts   # 获取文件内容接口 (公开)
└── README.md
```

## API 接口

| 接口 | 方法 | 说明 | 需要认证 |
|------|------|------|----------|
| `/api/auth` | POST | 登录认证 | ❌ |
| `/api/upload` | POST | 上传文件 | ✅ |
| `/api/files` | GET | 获取文件列表 | ✅ |
| `/api/files/:id` | DELETE | 删除文件 | ✅ |
| `/api/file/:id` | GET | 获取文件内容 | ❌ |

## 注意事项

1. **KV 存储限制**:
   - 免费版每个值最大 25MB
   - 付费版每个值最大 25MB (可申请提升)
   - 建议上传小于 25MB 的文件

2. **安全建议**:
   - 使用强密码
   - 定期更换密码
   - 生产环境建议使用更安全的认证方案

3. **直链访问**:
   - 文件直链无需登录即可访问
   - 链接格式: `https://your-domain.pages.dev/api/file/{file-id}`
   - 自动设置缓存头，利用 Cloudflare CDN 加速

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

注意: 本地开发时 API 接口需要 Cloudflare 环境支持，可以使用 `wrangler pages dev` 进行本地测试。

## License

MIT
