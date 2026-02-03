# 自托管文件系统 (Cloudflare Pages + KV)

这是一个基于 Cloudflare Pages 和 KV 存储的简单文件管理系统。支持文件上传、列表查看、删除以及文件直链访问。

## 功能特点
- 🔒 **安全访问**：必须输入密码才能管理文件。
- ⚡ **高速直链**：上传文件后生成永久链接，无需登录即可访问（适合做图床）。
- ☁️ **Serverless**：无需购买服务器，利用 Cloudflare 免费额度即可运行。
- 📱 **响应式设计**：手机和电脑均可完美使用。

## 部署指南

### 1. 准备工作
确保你拥有一个 Cloudflare 账号，并安装了 Node.js 环境（用于本地构建，如果使用 GitHub 自动构建则不需要）。

### 2. 创建 GitHub 仓库
将本项目代码上传到你的 GitHub 仓库。

### 3. Cloudflare Pages 设置
1. 登录 Cloudflare Dashboard。
2. 进入 **Compute (Workers & Pages)** -> **Pages**。
3. 点击 **Connect to Git**，选择你的仓库。
4. **构建配置**：
   - **模板选择**: vue
   - **Framework preset**: None
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
6. 点击 **Save and Deploy**。

### 4. 绑定 KV 存储 (关键步骤)
部署完成后，你必须绑定 KV 存储，否则会报错 `Error 1101` 或提示 KV 缺失。

1. 在 Cloudflare 侧边栏，进入 **Storage & Databases** -> **KV**。
2. 点击 **Create a Namespace**，输入名称（例如 `MY_FILES`），点击 Add。
3. 回到你的 Pages 项目页面。
4. 点击 **Settings** -> **Functions**。
5. 找到 **KV Namespace Bindings** 部分，点击 **Add binding**。
   - **Variable name**: `MY_BUCKET` (⚠️ 必须完全一致，不能改名)
   - **KV Namespace**: 选择你刚才创建的 `MY_FILES`。
6. 点击 **Save**。

### 5. 设置访问密码
1. 在 Pages 项目页面，点击 **Settings** -> **Environment variables**。
2. 点击 **Add variable**。
   - **Key**: `PASSWORD`
   - **Value**: 设置你的管理员密码（例如 `MySuperSecretPass`）。
3. 点击 **Save**。

### 6. 重新部署
修改绑定和环境变量后，必须**重新部署**才能生效。
- 进入 **Deployments** 标签页。
- 在最新的部署记录右侧点击三个点 -> **Retry deployment**。

## 本地开发
1. 安装依赖: `npm install`
2. 启动开发服务器: `npm run dev`
   - *注意：本地开发模式无法连接真实的 Cloudflare KV，会自动使用浏览器 LocalStorage 模拟数据，仅供测试 UI。*

## 故障排除
- **Error 1101**: 通常是因为没有正确绑定 KV。请检查 `Variable name` 是否为 `MY_BUCKET`。
- **Login Failed**: 检查环境变量 `PASSWORD` 是否设置正确。默认密码为 `admin`。
