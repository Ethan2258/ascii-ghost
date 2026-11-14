# ascii-bloodmoon

字符拼成的血月与鸦群：一轮暗红的月亮在翻涌的红云里，乌鸦从头顶掠过。指针会拨开云，点一下夜空会惊起鸦群。

在线：<https://ghost.deawie.com>

- 纯 ES Module + 单个 `<canvas>`，无构建、无依赖
- `src/scene.js` 场景与渲染，`src/crow.js` 乌鸦剪影与扇翅姿态，`src/util.js` 噪声与工具函数
- 明暗两套主题，切换时从按钮处圆形擦除过渡；尊重 `prefers-reduced-motion`

本地预览：

```bash
python -m http.server 8899
```

录制主页动图：`index.html?record=1320,450,240,24&theme=dark` 打开后调用 `window.__sky.frame(i)` 逐帧取 PNG（`tools/record.mjs`），再用 `tools/encode.py` 编码为循环 WebP。

布局与思路参考 [stqfdyr/ascii-pond](https://github.com/stqfdyr/ascii-pond)。字体 Geist Mono（SIL OFL 1.1，见 `fonts/GEIST-LICENSE`）。
