import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// 离线可打开靠 `public/sw.js`。只在生产构建里注册：开发时 Vite 的模块图与缓存天然冲突
// （改了源码却拿缓存里的旧文件，最典型的「我明明改了怎么没生效」）。
// `vite preview` 与 GitHub Pages 都是 PROD，所以走查和线上走的是同一条路径。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
