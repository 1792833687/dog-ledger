# 狗账 · 部署

构建产物是纯静态文件（`dist/`），放在任何 https 静态托管上即可。

## 当前线上地址

**https://1792833687.github.io/dog-ledger/** —— 托管在 GitHub Pages，源码仓库是 `1792833687/dog-ledger`（公开）。
Pages 发布的是 **`gh-pages` 分支**（里面直接放构建产物），`master` 分支是源码。

### 改了代码之后怎么重新上线

```bash
npm ci
npx vitest run && npm run lint && npm run build     # 三道门禁都要过
git add <改过的文件> && git commit -m "..."
git push origin master

# 把新产物推到 gh-pages（在临时目录里做，不动 master 的工作区）
$t = "$env:TEMP\dogledger-pages"
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $t | Out-Null
Copy-Item dist\* $t -Recurse
cd $t
git init -b gh-pages
git add -A
git commit -m "deploy: 狗账"
git remote add origin https://github.com/1792833687/dog-ledger.git
git push --force origin gh-pages
```

## 构建

```bash
npm ci
npm run build      # 产物在 dist/
```

> `vite.config.ts` 里 `base: './'` 是**故意**的相对路径：同一份 `dist/` 既能放在域名根（本地 preview、OSS 根目录），
> 也能放在 GitHub Pages 的子路径 `/dog-ledger/` 下，不用为部署改配置。本应用没有前端路由（靠标签状态切换、不改 URL），所以相对 base 不会踩坑。

## 其它托管（可选）

- **腾讯云 EdgeOne Pages**：免费额度，国内可访问。新建项目 → 关联 Git 仓库 → 构建命令 `npm run build` → 输出目录 `dist`。
- **阿里云 OSS 静态网站**：约几元/月，国内稳定。把 `dist/` 上传到 bucket，开启静态网站托管。

## 上线后必做

1. 用**你自己的手机**打开链接，加到桌面（iOS：分享 → 添加到主屏幕；安卓：菜单 → 添加到主屏幕）。
2. 立刻做一次「导出备份」，把文件存到微信文件传输助手 —— 验证备份真的能用。
3. 把链接发给伙伴，告诉他这是给你俩看账用的，数据以你手机上的为准。

> **数据不跟着网址走。** 账本存在浏览器里，按「网址」隔离：换网址、清浏览器数据、换手机都会看不到旧数据。
> 搬迁的办法只有一个 —— 旧网址导出备份文件，新网址用「从备份恢复」。
