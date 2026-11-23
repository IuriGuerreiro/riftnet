# Adept brand

## Logo

| File | Use |
| --- | --- |
| `logo/adept-mark.svg` | Main "A" mark, transparent, for dark backgrounds |
| `logo/adept-mark-light-bg.svg` | Same mark with dark shards, for light backgrounds |
| `logo/adept-app-icon.svg` | Rounded dark tile, the source for app and Tauri icons |
| `logo/*-1024.png` | 1024px PNG exports of the above |
| `logo/adept-lockup-720.png` | Mark plus "ADEPT" wordmark |

Colors: white `#ffffff`, violet `#7c6cf2`, background `#0b0d12`.
Wordmark font: URW Gothic Bold, wide tracking, with the first "A" in violet.

## Animation

The five shards of the "A" morph through four states: A → Voice → Screen → Controller → A.

- `animation/adept-loop.gif`: 480px, 25fps, 7s loop
- `animation/adept-loop.mp4`: 720px
- `animation/adept-states.png`: all four states side by side
- `animation/render_adept_anim.py`: renders the frames (needs pycairo and ffmpeg)

```sh
python3 render_adept_anim.py /tmp/frames 480
ffmpeg -framerate 25 -i /tmp/frames/f_%04d.png \
  -vf "split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 adept-loop.gif
```
