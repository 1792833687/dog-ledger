import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // 相对路径：同一份 dist 既能放在域名根（本地 preview / 阿里云 OSS 根目录），
  // 也能放在 GitHub Pages 的子路径 /dog-ledger/ 下面，不用为部署改配置。
  // 本应用没有前端路由（页面靠标签状态切换，不改 URL），所以相对 base 不会踩坑。
  base: './',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    globals: true,
  },
})
