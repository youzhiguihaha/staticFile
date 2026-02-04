<div align="center">
  <img width="1545" height="655" alt="项目效果展示1" src="https://gsyn-img.pages.dev/v2/QxxCc7A.png" />
  <br/>
  <img width="1290" height="884" alt="项目效果展示2" src="https://gsyn-img.pages.dev/v2/bZVdWnA.png" />
  <br/>
  <img width="1116" height="449" alt="项目效果展示3" src="https://gsyn-img.pages.dev/v2/p9jL6mL.png" />
</div>

<h1 align="center">自托管文件系统</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Cloudflare-Pages-F38020?style=flat-square&logo=cloudflare" alt="Cloudflare Pages">
  <img src="https://img.shields.io/badge/KV-Storage-EA4C89?style=flat-square" alt="KV Storage">
  <img src="https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js" alt="Vue 3">
</p>

> ⚠️ **声明**：本人小白，项目全部是用 GPT 和 Gemini 编写（存在部分小问题，但不影响日常使用体验），需要新功能和修复问题可以尝试自己在项目里更改。

---

## 📑 目录

- [✨ 功能特点](#-功能特点)
- [🚀 快速部署](#-快速部署)
  - [1. 准备工作](#1-准备工作)
  - [2. 创建 GitHub 仓库](#2-创建-github-仓库)
  - [3. Cloudflare Pages 项目配置](#3-cloudflare-pages-项目配置)
  - [4. 绑定 KV 存储（关键步骤，必做）](#4-绑定-kv-存储关键步骤必做)
  - [5. 配置管理员密码（补充方案）](#5-配置管理员密码补充方案)
  - [6. 重新部署（生效关键步骤）](#6-重新部署生效关键步骤)
- [💻 本地开发](#-本地开发)
- [🛠️ 故障排除](#️-故障排除)

---

## ✨ 功能特点

- 🔒 **安全访问**：必须输入管理员密码才能进入文件管理界面
- ⚡ **高速直链**：上传文件生成永久公开链接，无需登录即可访问（适配图床场景）
- ☁️ **Serverless 架构**：无需采购和维护服务器，利用 Cloudflare 免费额度即可运行
- 📱 **全端响应式**：兼容电脑、手机等不同尺寸设备，使用体验一致

---

## 🚀 快速部署

### 1. 准备工作

1. 拥有一个有效的 **Cloudflare 账号**（无账号可免费注册）
2. 可选：安装 **Node.js** 环境（仅用于本地构建项目，使用 GitHub 自动构建可忽略）

### 2. 创建 GitHub 仓库

将本项目代码克隆或直接上传至你的个人 GitHub 公共/私有仓库（确保 Cloudflare 能访问该仓库）

### 3. Cloudflare Pages 项目配置

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)
2. 点击左侧导航栏 **计算和AI** → **Workers 和 Pages**
3. 点击 **Connect to Git（创建应用程序）**，选择已上传项目的 GitHub 仓库

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/tAs295d.png" alt="选择Connect to Git" width="80%" style="margin: 8px 0;" />
     <img src="https://gsyn-img.pages.dev/v2/FCCRwxK.png" alt="关联GitHub仓库" width="80%" style="margin: 8px 0;" />
     <img src="https://gsyn-img.pages.dev/v2/wrv6zs8.png" alt="确认目标仓库" width="80%" style="margin: 8px 0;" />
   </div>

4. 进入 **构建配置** 页面，填写以下参数：

   | 配置项 | 值 |
   |--------|-----|
   | 项目模板 | `vue` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/qE4ovii.png" alt="构建配置填写" width="80%" style="margin: 8px 0;" />
   </div>

5. **同步配置管理员密码环境变量**（提前配置避免后续二次操作：例如下图的操作方法）

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/2HoSDCT.png" alt="配置密码环境变量" width="80%" style="margin: 8px 0;" />
   </div>
   在浏览器生成所需变量（不用终端）  
   - 打开任意网页 → 按 **F12** → **Console（控制台）**  
   - 粘贴运行下面代码，按提示输入你要设置的管理员密码：

`(async () => {
  const password = prompt("输入管理员密码：");
  if (!password) return;

  const iterations = 100000; // Cloudflare 限制：不要超过 100000
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const tokenSecretBytes = crypto.getRandomValues(new Uint8Array(32));

  const toHex = (u8) => Array.from(u8).map(b => b.toString(16).padStart(2,'0')).join('');
  const toB64url = (u8) => {
    let s=""; for (const b of u8) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  };

  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password.trim()),
    "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name:"PBKDF2", hash:"SHA-256", salt, iterations },
    keyMaterial, 32*8
  );

  globalThis.__SECRETS__ = {
    TOKEN_SECRET: toB64url(tokenSecretBytes),
    PASSWORD_SALT_HEX: toHex(salt),
    PASSWORD_HASH_HEX: toHex(new Uint8Array(bits)),
    PBKDF2_ITERATIONS: String(iterations),
  };

  console.log("生成完成，可分别复制：");
  console.log("__SECRETS__ =", __SECRETS__);
})();`

会弹窗让你输入要加密的密码，后面也是这个密码登录的，然后会出现下面的结果
   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/UQWVBeC.png" alt="变量名和对应的值" width="80%" style="margin: 8px 0;" />
   </div>
   | Key | Value（从 Console控制台 复制纯值，不需要引号） |
   |--------|-----|
   | TOKEN_SECRET | `__SECRETS__.TOKEN_SECRET` |
   | PASSWORD_SALT_HEX | `__SECRETS__.PASSWORD_SALT_HEX（长度应为 32）` |
   | PASSWORD_HASH_HEX | `__SECRETS__.PASSWORD_HASH_HEX（长度应为 64）` |
   | PBKDF2_ITERATIONS | `100000（不能超过这个数值）` |
   

   > 📌 **提示**：变量名需严格按照模板一模一样，弹窗输入需要加密的密码，就行加密，填写变量名和对应的值（四个都需要）

6. 点击 **Save and Deploy（保存并部署）**
7. 等待初始部署完成，继续进行后续 KV 存储绑定操作

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/uJiDrQV.png" alt="初始部署确认" width="80%" style="margin: 8px 0;" />
   </div>

### 4. 绑定 KV 存储（关键步骤，必做）

> ⚠️ 部署完成后必须绑定 KV 存储，否则会出现 `Error 1101` 或 KV 存储缺失报错。

1. 左侧导航栏进入 **Storage & Databases（存储和数据库）** → **KV（Workers KV）**
2. 点击 **Create a Namespace**，输入自定义命名空间名称（例如 `MY_FILES`），点击 `Add` 完成创建

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/AfYrxGs.png" alt="创建KV命名空间" width="80%" style="margin: 8px 0;" />
     <img src="https://gsyn-img.pages.dev/v2/Rr5mNAn.png" alt="确认创建KV命名空间" width="80%" style="margin: 8px 0;" />
   </div>

3. 返回你的 Pages 项目详情页面
4. 点击顶部导航 **Settings** → 左侧 **Functions**

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/CD2ZcjK.png" alt="进入Functions设置" width="80%" style="margin: 8px 0;" />
   </div>

5. 找到 **KV Namespace Bindings** 模块，点击 **Add binding**

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/tYGNPTv.png" alt="添加KV绑定" width="80%" style="margin: 8px 0;" />
     <img src="https://gsyn-img.pages.dev/v2/PfcKjUv.png" alt="KV绑定配置页面" width="80%" style="margin: 8px 0;" />
   </div>

6. 填写绑定参数（⚠️ **变量名必须完全一致，不可修改**）

   | 配置项 | 值 |
   |--------|-----|
   | Variable name | `MY_BUCKET` |
   | KV Namespace | 选择刚才创建的 `MY_FILES` |

7. 点击 **Save（保存）** 完成绑定

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/qyXb9Sh.png" alt="保存KV绑定配置" width="80%" style="margin: 8px 0;" />
   </div>

### 5. 配置管理员密码（补充方案）

> 若在步骤 3 中未配置密码环境变量，可通过此步骤补充配置。

1. 进入 Pages 项目详情页，点击 **Settings** → **Environment variables**
2. 点击 **Add variable**，填写以下参数：

   | Key | Value（从 Console控制台 复制纯值，不需要引号） |
   |--------|-----|
   | TOKEN_SECRET | `__SECRETS__.TOKEN_SECRET` |
   | PASSWORD_SALT_HEX | `__SECRETS__.PASSWORD_SALT_HEX（长度应为 32）` |
   | PASSWORD_HASH_HEX | `__SECRETS__.PASSWORD_HASH_HEX（长度应为 64）` |
   | PBKDF2_ITERATIONS | `100000（不能超过这个数值）` |

3. 点击 **Save** 完成配置（如下图的位置操作，变量名和值参考步骤洒获取，一定要那样获取，而且不能填错）

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/qSU7IE4.png" alt="添加密码环境变量" width="80%" style="margin: 8px 0;" />
     <img src="https://gsyn-img.pages.dev/v2/wGmgo7Z.png" alt="保存密码环境变量" width="80%" style="margin: 8px 0;" />
   </div>

### 6. 重新部署（生效关键步骤）

> 修改 KV 存储绑定或环境变量后，必须重新部署才能让配置生效。

1. 进入 Pages 项目详情页的 **Deployments** 标签页
2. 找到最新的一条部署记录，点击右侧「三个点」→ **Retry deployment**

   <div align="center">
     <img src="https://gsyn-img.pages.dev/v2/TKHc5Ns.png" alt="重新部署项目" width="80%" style="margin: 8px 0;" />
   </div>

3. 等待重新部署完成，即可正常访问和使用项目 🎉

---
# 列表加载失败可能时登录失效了，需要退出重新登录

## 💻 本地开发

# 安装依赖
npm install

# 启动开发服务器
npm run dev
<br>⚠️ 注意：本地开发模式无法连接真实的 Cloudflare KV，会自动使用浏览器 LocalStorage 模拟数据，仅供测试 UI。

🛠️ 故障排除
问题	原因	解决方案
Error 1101	KV 未正确绑定	检查 Variable name 是否为 MY_BUCKET
Login Failed	密码配置错误	检查环境变量 PASSWORD 是否设置正确（默认密码为 admin）
