# 静态文件管理系统 (Static File Manager)

一个可以部署到 Cloudflare Pages 的静态文件管理系统，支持登录保护、文件上传、直链分享。

## ✨ 功能特点

- 🔐 密码登录保护
- 📤 拖拽上传文件
- 📋 文件列表管理
- 🔗 一键复制直链（无需登录即可访问）
- ☁️ Cloudflare 全球 CDN 加速

---

## 🚀 Cloudflare 部署配置

### 第一步：创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单 → **Workers 和 Pages** → **KV**
3. 点击 **创建命名空间**
4. 名称填写：`FILES_KV`
5. 创建后，**复制 ID**（格式类似：`abc123def456...`）

### 第二步：修改 wrangler.toml

打开项目中的 `wrangler.toml` 文件，将 KV ID 替换为你刚才复制的：

```toml
[[kv_namespaces]]
binding = "FILES_KV"
id = "粘贴你的KV命名空间ID到这里"
```

### 第三步：Cloudflare Pages 配置

在 Cloudflare Pages 的配置界面填写：

| 配置项 | 值 |
|--------|-----|
| **项目名称** | `static-file` （或你喜欢的名字） |
| **构建命令** | `npm run build` |
| **部署命令** | `npx wrangler pages deploy dist --project-name=static-file` |
| **路径** | `/` |

### 第四步：配置环境变量

在配置界面的 **变量** 部分：

| 变量名称 | 变量值 |
|----------|--------|
| `AUTH_PASSWORD` | `你想设置的登录密码` |
| `CLOUDFLARE_ACCOUNT_ID` | `你的账户ID` |
| `CLOUDFLARE_API_TOKEN` | `你的API令牌` |

#### 如何获取 CLOUDFLARE_ACCOUNT_ID：
1. 登录 Cloudflare Dashboard
2. 右侧边栏可以看到 **账户 ID**
3. 复制它

#### 如何创建 API 令牌：
1. 点击右上角头像 → **我的个人资料**
2. 左侧选择 **API 令牌**
3. 点击 **创建令牌**
4. 选择 **编辑 Cloudflare Workers** 模板
5. 账户资源选择你的账户
6. 创建令牌并复制

---

## 📋 完整配置示例

```
项目名称: static-file
构建命令: npm run build
部署命令: npx wrangler pages deploy dist --project-name=static-file
路径: /

环境变量:
- AUTH_PASSWORD = mypassword123
- CLOUDFLARE_ACCOUNT_ID = 1234567890abcdef
- CLOUDFLARE_API_TOKEN = xxxxxxxxxxxxx
```

---

## 🔧 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建
npm run build
```

---

## 📁 项目结构

```
├── src/
│   ├── App.tsx              # 主应用
│   ├── components/
│   │   ├── Login.tsx        # 登录页面
│   │   ├── Dashboard.tsx    # 管理后台
│   │   ├── FileUpload.tsx   # 上传组件
│   │   └── FileList.tsx     # 文件列表
│   ├── hooks/
│   │   ├── useAuth.ts       # 认证Hook
│   │   └── useFiles.ts      # 文件操作Hook
│   └── types/
│       └── index.ts         # 类型定义
├── functions/               # Cloudflare Functions
│   └── api/
│       ├── auth.ts          # 登录接口
│       ├── upload.ts        # 上传接口
│       ├── files.ts         # 文件列表接口
│       └── files/
│           └── [id].ts      # 删除文件接口
│       └── file/
│           └── [id].ts      # 获取文件内容（公开）
├── wrangler.toml            # Cloudflare 配置
└── README.md
```

---

## 🔑 默认登录密码

如果没有设置 `AUTH_PASSWORD` 环境变量，默认密码是：`admin123`

---

## ⚠️ 注意事项

1. **KV 存储限制**：单个值最大 25MB，适合存储图片和小文件
2. **免费额度**：每天 100,000 次读取，1,000 次写入
3. **直链格式**：`https://你的域名/api/file/文件ID`

---

## 📝 License

MIT
