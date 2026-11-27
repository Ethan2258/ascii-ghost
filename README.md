# ascii-ghost

字符拼成的鬼域：灰黑的墓地、枯树和低伏的雾，幽灵在页面上四处飘荡、忽隐忽现。指针停太久，它们会转过头来看你；点一下，就吓跑了。

在线：<https://ghost.deawie.com>

- 纯 ES Module + 单个 `<canvas>`，无构建、无依赖
- `src/scene.js` 场景、渲染与幽灵的来去；`src/wraith.js` 幽灵的形状（密度场，脸是挖空的）；`src/util.js` 噪声与工具函数
- 幽灵数量随时间起伏：会从边缘飘进来、淡入、游荡，再溶解或飘走；移动时留下残影，闪烁时字符行会错位
- 天空、墓碑和暗角每个主题只绘制一次，字符按颜色批量绘制，60/120Hz 下单帧约 4ms
- 明暗主题切换在场景内逐帧平滑过渡配色，并与页面 CSS 颜色同步；尊重 `prefers-reduced-motion`

## 嵌入到别的页面

`src/` 可以直接拿去用，画布放在页面任何位置、任何大小都行：

```js
import { mount } from "./src/scene.js";
const sky = mount(document.querySelector("canvas"), { theme: "dark" });
sky.setTheme(true, { duration: 560 }); // 换成浅色并平滑过渡配色；不传 duration 则立即切换
sky.measure();        // 页面布局变了（滚动、加载完数据）之后重新读取文字位置
sky.destroy();        // 停掉动画、观察器和所有事件监听
```

- 画布按自己的尺寸排版，尺寸变化时自动重排；滚出视野时暂停，不占 CPU
- `data-sky-avoid`：幽灵绕开这个元素（并在下面变淡），适合导航、按钮这类小块
- `data-sky-dim`：幽灵可以从文字下面飘过，只是逐行变淡、不被推开，适合大段正文和数字
- `data-sky-ignore`：在这个元素上点击不会吓散幽灵
- `mount(canvas, { leftTree: false })`：不画左边那棵小枯树，适合文字靠左排、会被树压住的页面
- `mount(canvas, { fps: 30 })`：每秒最多画几帧，来得太早的帧跳过、时间计入下一步；不传或 0 为跟随屏幕刷新
- `mount(canvas, { maxDpr: 1 })`：最高按几倍像素密度绘制，默认 2；也可以传函数，每次尺寸变化时重新读取，例如手机上取 1 省电

本地预览：

```bash
python -m http.server 8899
```

检查：起好上面的本地服务后运行 `node tools/smoke.mjs`（需要 `playwright-core` 和 Chromium，`CHROME=` 指定浏览器路径）。它在真实浏览器里确认页面能画出来、没有控制台报错、主题切换和路由正常、嵌入选项 `fps`、`maxDpr` 和 `destroy()` 有效、录制模式首尾帧能接上。每次推送和 PR 由 GitHub Actions 自动跑。

录制主页动图：打开 `index.html?record=1320,450,240,24&theme=dark`，调用 `window.__sky.frame(i)` 逐帧取 PNG（`tools/record.mjs`），再用 `tools/encode.py` 编码为无缝循环的 WebP。

布局与思路参考 [stqfdyr/ascii-pond](https://github.com/stqfdyr/ascii-pond)。字体 Geist Mono（SIL OFL 1.1，见 `fonts/GEIST-LICENSE`）。
