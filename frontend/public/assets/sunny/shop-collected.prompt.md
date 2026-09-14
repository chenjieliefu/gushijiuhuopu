# 收藏后的店铺场景

使用内置 imagegen 图像编辑工具。底图 `shop-tidy.png`，相机参考 `camera.webp`。

Use case: compositing. Edit target image 1 is the exact game shop background; image 2 is the camera design reference. Produce the SAME wide shop background with exactly one small vintage camera naturally resting INSIDE the large empty left cubby (bounds x192..381 y328..492 in 1672x941 reference). Camera feet and loose strap rest ON the horizontal shelf at y488, tucked a little behind its front lip. Entire camera and strap occupy roughly x223..358 y392..489, small, plausible collectible scale. Match camera perspective to cabinet, warm window sunlight from left, subdued brown material and soft ambient occlusion/contact shadow beneath and behind it. It must feel painted/rendered as part of this room, not a sharp pasted sticker. Preserve recognizable brown leather bellows camera brass details blue lens. Preserve ALL room geometry, exact crop, camera viewpoint, empty other cubbies, wall, counter, plants, lamp and original foreground tall cabinet staggered in front of rear low cabinet. Do not reveal or add any door. Do not add furniture, decorations, labels, characters or text. Change ONLY the small camera integration region. 16:9 full background, matching input dimensions as closely as possible.

保留底图和原始生成文件，新增 `shop-collected.png`。完成收藏后淡入这张场景，透明按钮负责打开收藏册。
