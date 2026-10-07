/**
 * 狗账的 service worker（手写，零依赖）。
 *
 * 目的只有一个：**断网也能打开**。这是个纯本地应用（数据全在 IndexedDB 里），
 * 联网只用来取那几个静态文件；只要把它们缓下来，飞机上、电梯里、乡下没信号都能记账。
 *
 * 用 `CACHE` 里的版本号而不是构建时注入：这是个 `public/` 下的静态文件，Vite 原样拷贝，
 * 不做任何处理。要发新版本就手动把 `CACHE` 尾部的 `v1` 往上加一位 —— 加完之后
 * `activate` 会把**本应用（`CACHE_PREFIX`）**名下的旧缓存删掉。**忘了加**的后果是用户
 * 拿到新 HTML 但里头引的 JS 还是旧的（见下面 fetch 的说明）。
 *
 * 这里没有前端路由，所有导航都回落到 `./index.html`。
 */

const CACHE_PREFIX = 'dog-ledger-'
const CACHE = CACHE_PREFIX + 'v1'

/** 首屏必需的那几个文件。`./` 与 `./index.html` 都要，因为二者是不同的 URL。 */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      // 只删**自己这个前缀**下的旧缓存。线上是 GitHub Pages，origin 是
      // `1792833687.github.io` —— 这个 origin 与作者名下别的项目共用，不带前缀地
      // 「删掉所有不等于 CACHE 的缓存」等于顺手把兄弟项目的离线能力一起毁了。
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map(key => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const request = event.request

  // 只碰同源的 GET。POST/PUT 之类的写请求、别的域（比如以后接入的接口）、
  // 浏览器扩展自己的请求，一律放行不干预 —— 缓存一条写请求会直接出错。
  if (request.method !== 'GET') return
  // 比的是解析后的 origin，不是前缀：`https://1792833687.github.io.evil.com/x.js`
  // 以 `https://1792833687.github.io` 开头，`startsWith` 会把它当成自家资源。
  if (new URL(request.url).origin !== self.location.origin) return

  // 页面本身（点开图标、刷新）走 network-first：**先试着拿新版本**，拿不到（断网）
  // 才回落缓存里的首页。
  //
  // 为什么不是 cache-first：这份 HTML 里写着 `assets/index-<哈希>.js` 的文件名。如果
  // 只认缓存，用户在服务器更新之后还会一直加载旧的 HTML，而旧 HTML 指向的那个哈希文件
  // 早就不在服务器上了 —— 结果就是「明明有网，却白屏」。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then(cache => cache.put(request, copy))
          }
          return response
        })
        .catch(() => caches.match('./index.html').then(hit => hit ?? Response.error())),
    )
    return
  }

  // 其余同源静态资源：cache-first，未命中再走网络并回填。
  // 带哈希的 `assets/*` 内容永不变，所以这一步几乎总是命中，页面也就快了。
  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit
      return fetch(request).then(response => {
        // 只缓存成功响应：2xx 以外（404、500、opaque 的 cross-origin 响应）存进来
        // 会让用户在下线后看到一张坏图或者一段坏 JS，且永远修不好。
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then(cache => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
