# ascii-ghost

字符拼成的鬼域：灰黑的墓地、枯树和低伏的雾，幽灵在页面上四处飘荡、忽隐忽现。指针停太久，它们会转过头来看你；点一下，就吓跑了。

在线：<https://ghost.deawie.com>

- 纯 ES Module + 单个 `<canvas>`，无构建、无依赖
- `src/scene.js` 场景、渲染与幽灵的来去；`src/wraith.js` 幽灵的形状（密度场，脸是挖空的）；`src/util.js` 噪声与工具函数
- 幽灵数量随时间起伏：会从边缘飘进来、淡入、游荡，再溶解或飘走；移动时留下残影，闪烁时字符行会错位
- 天空、墓碑和暗角每个主题只绘制一次，字符按颜色批量绘制，60/120Hz 下单帧约 4ms
- 明暗主题切换用 View Transitions 从按钮处圆形展开；尊重 `prefers-reduced-motion`

本地预览：

```bash
python -m http.server 8899
```

录制主页动图：打开 `index.html?record=1320,450,240,24&theme=dark`，调用 `window.__sky.frame(i)` 逐帧取 PNG（`tools/record.mjs`），再用 `tools/encode.py` 编码为无缝循环的 WebP。

布局与思路参考 [stqfdyr/ascii-pond](https://github.com/stqfdyr/ascii-pond)。字体 Geist Mono（SIL OFL 1.1，见 `fonts/GEIST-LICENSE`）。
