import type { GameState } from "../services/contract";
import { artAssets } from "../data/assets";
import { ArtSlot } from "./ArtSlot";

export function CameraArt({ className = "" }: { className?: string }) {
  return (
    <ArtSlot src={artAssets.camera} alt="老式相机" className={className}>
      <svg
        className={className}
        viewBox="0 0 300 210"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="wood" x2="1" y2="1">
            <stop stopColor="#ad7950" />
            <stop offset="1" stopColor="#765234" />
          </linearGradient>
          <radialGradient id="lens">
            <stop stopColor="#63726a" />
            <stop offset=".4" stopColor="#273d38" />
            <stop offset=".7" stopColor="#142522" />
            <stop offset="1" stopColor="#364a40" />
          </radialGradient>
        </defs>
        <path
          d="M58 99C7 94 2 175 38 187M251 99c49 0 44 72 15 89"
          stroke="#76553a"
          strokeWidth="9"
        />
        <ellipse
          cx="155"
          cy="193"
          rx="117"
          ry="12"
          fill="#243128"
          opacity=".13"
        />
        <path
          d="m100 55 9-20h68l16 20"
          fill="#6c6856"
          stroke="#3a3c32"
          strokeWidth="3"
        />
        <rect
          x="62"
          y="43"
          width="29"
          height="17"
          rx="4"
          fill="#b8a782"
          stroke="#544b39"
          strokeWidth="3"
        />
        <rect
          x="46"
          y="58"
          width="218"
          height="123"
          rx="10"
          fill="url(#wood)"
          stroke="#4c4232"
          strokeWidth="4"
        />
        <path d="M49 78h213M48 159h215" stroke="#c39869" strokeWidth="4" />
        <rect
          x="87"
          y="78"
          width="122"
          height="82"
          rx="6"
          fill="#3d4439"
          stroke="#252f28"
          strokeWidth="3"
        />
        <circle
          cx="149"
          cy="120"
          r="54"
          fill="#b6a47c"
          stroke="#3d3c30"
          strokeWidth="5"
        />
        <circle
          cx="149"
          cy="120"
          r="45"
          fill="#354033"
          stroke="#746f54"
          strokeWidth="4"
        />
        <circle
          cx="149"
          cy="120"
          r="32"
          fill="url(#lens)"
          stroke="#141f1a"
          strokeWidth="4"
        />
        <ellipse
          cx="140"
          cy="111"
          rx="11"
          ry="16"
          transform="rotate(35 140 111)"
          fill="#e4ead2"
          opacity=".22"
        />
        <rect x="220" y="89" width="24" height="14" rx="2" fill="#d6c3a0" />
        <path d="M59 89v54m7-57v30m169 9v21" stroke="#c89867" opacity=".7" />
        <circle cx="64" cy="164" r="3" fill="#e0c99d" />
        <circle cx="245" cy="164" r="3" fill="#e0c99d" />
      </svg>
    </ArtSlot>
  );
}
export function Kanshan({
  expression = "neutral",
}: {
  expression?: GameState["expression"];
}) {
  return (
    <ArtSlot src={artAssets.kanshan[expression]} alt={`看山 · ${expression}`}>
      <svg
        viewBox="0 0 260 320"
        fill="none"
        aria-label={`看山：${expression === "warm" ? "温暖" : expression === "thoughtful" ? "思索" : "平静"}`}
        role="img"
      >
        <path
          d="M74 121C60 59 79-7 107 48l20 35 33-2 27-41c33-47 34 54 25 85l8 117-8 65H51l9-127Z"
          fill="#ede9d7"
          stroke="#505747"
          strokeWidth="3"
        />
        <path
          d="M109 55 98 39 91 82m93-22 10-21 6 37"
          stroke="#d0baa0"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M76 209c38 21 86 11 133-22l-2 26c-45 40-92 43-132 20Z"
          fill="#768476"
        />
        <path
          d="M201 232c18 2 26 46 3 52l-40 5"
          fill="#e9e5d3"
          stroke="#505747"
          strokeWidth="3"
        />
        <ellipse
          cx="77"
          cy="274"
          rx="31"
          ry="16"
          fill="#ede9d7"
          stroke="#505747"
          strokeWidth="3"
        />
        <ellipse
          cx="175"
          cy="156"
          rx="47"
          ry="40"
          transform="rotate(-8 175 156)"
          fill="#30372f"
        />
        <ellipse cx="163" cy="140" rx="14" ry="7" fill="#54594a" opacity=".5" />
        {expression === "warm" ? (
          <path
            d="M94 142q8-10 16 0"
            stroke="#30372f"
            strokeWidth="4"
            strokeLinecap="round"
          />
        ) : (
          <ellipse cx="103" cy="143" rx="5" ry="7" fill="#30372f" />
        )}
        {expression === "thoughtful" && (
          <path
            d="m93 123 13-4"
            stroke="#505747"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}
        <ellipse
          cx="105"
          cy="169"
          rx="11"
          ry="5"
          fill="#c68d76"
          opacity=".25"
        />
        <path
          d="M136 197q9 8 18 1"
          stroke="#505747"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </ArtSlot>
  );
}

export function ShopScene({
  collected,
  expression,
  onInspect,
  onCollection,
  busy,
}: {
  collected: boolean;
  expression: GameState["expression"];
  onInspect: () => void;
  onCollection: () => void;
  busy: boolean;
}) {
  return (
    <div className={`shop-scene ${collected ? "collected" : ""}`}>
      <ArtSlot
        src={artAssets.shop}
        alt="旧货铺场景"
        className="shop-background"
      >
        <svg
          viewBox="0 0 1000 670"
          className="shop-background"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="wall" x2="0" y2="1">
              <stop stopColor="#bec4ac" />
              <stop offset="1" stopColor="#e0dac0" />
            </linearGradient>
            <linearGradient id="sun" x2="1" y2="1">
              <stop stopColor="#fff7ca" stopOpacity=".75" />
              <stop offset="1" stopColor="#fff7ca" stopOpacity="0" />
            </linearGradient>
            <pattern
              id="floor"
              width="200"
              height="80"
              patternUnits="userSpaceOnUse"
              patternTransform="skewX(-35)"
            >
              <rect width="200" height="80" fill="#8b7760" />
              <path
                d="M0 0h200v80"
                fill="none"
                stroke="#6d6150"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          <rect width="1000" height="670" fill="url(#wall)" />
          <rect y="514" width="1000" height="156" fill="url(#floor)" />
          <path d="M0 497h1000v22H0Z" fill="#777f66" />
          <rect
            x="27"
            y="73"
            width="357"
            height="440"
            rx="3"
            fill="#82775c"
            stroke="#605d47"
            strokeWidth="10"
          />
          <rect x="45" y="90" width="320" height="402" fill="#5e6753" />
          <path
            d="M45 227h320M45 360h320M193 90v404"
            stroke="#998766"
            strokeWidth="13"
          />
          <g fill="#b6a57c" stroke="#5a5d48" strokeWidth="2">
            <path d="M84 173q-5 26-22 45h77q-21-24-23-45l-3-27H87Z" />
            <ellipse cx="101" cy="146" rx="14" ry="4" />
            <path
              d="M248 161q-32 18-14 57h54q22-43-12-57l-4-34h-22Z"
              fill="#b8b6a0"
            />
          </g>
          <g transform="translate(76 267) rotate(-6)">
            <rect width="19" height="83" fill="#b89472" />
            <rect x="21" width="23" height="83" fill="#8b9b82" />
            <rect x="47" y="-8" width="18" height="91" fill="#c4b58d" />
            <path
              d="M4 9h11M24 10h15M51 3h10M4 71h11M24 70h15M51 72h10"
              stroke="#e1cf9e"
              strokeWidth="3"
            />
          </g>
          <g transform="translate(220 267)">
            <rect
              width="111"
              height="72"
              rx="7"
              fill="#877c59"
              stroke="#c0aa80"
              strokeWidth="3"
            />
            <rect x="9" y="10" width="68" height="50" fill="#625e46" />
            <path
              d="M16 12v47m8-47v47m8-47v47m8-47v47m8-47v47m8-47v47m8-47v47"
              stroke="#8b8868"
              strokeWidth="3"
            />
            <circle cx="94" cy="23" r="8" fill="#c6b994" />
            <circle cx="94" cy="48" r="8" fill="#c6b994" />
            <path d="m87 0 11-42" stroke="#575e4b" strokeWidth="3" />
          </g>
          <g transform="translate(81 392)">
            <rect width="68" height="82" fill="#b6a37a" />
            <rect x="8" y="8" width="52" height="65" fill="#d2c3a0" />
            <path d="M11 69 28 38l10 11 14-21 8 41Z" fill="#a2a287" />
            <circle cx="27" cy="24" r="8" fill="#e6d8b3" />
          </g>
          <rect
            x="714"
            y="71"
            width="264"
            height="357"
            fill="#e9dcab"
            stroke="#847e5e"
            strokeWidth="11"
          />
          <path d="M726 231q44-82 97-46t71-25 72 13V415H726Z" fill="#b6c49c" />
          <path d="M726 311q80-92 132-17t108-18v142H726Z" fill="#97ae8f" />
          <path
            d="M815 83v332m79-332v332M719 245h253"
            stroke="#9f9772"
            strokeWidth="8"
          />
          <path d="m725 75-314 505h516l44-505Z" fill="url(#sun)" />
          <path
            d="M723 71h256v47q-73 18-93-3t-63 5-57-8-43 7Z"
            fill="#d9d7b5"
          />
          <path
            d="M842 426v80m-27-60q-56 9-54-35 40-5 54 35m30 26q65 0 48-43-51 1-48 43m-1-41q-32-30-13-58 28 20 13 58"
            stroke="#657e5c"
            strokeWidth="4"
            fill="#849a6a"
          />
          <path d="m813 483 12 43h37l11-43Z" fill="#bd9875" />
          <path d="M538 0v81" stroke="#655f4c" strokeWidth="3" />
          <path
            d="M523 83h30l44 49H481Z"
            fill="#879379"
            stroke="#56634d"
            strokeWidth="3"
          />
          <ellipse cx="539" cy="133" rx="59" ry="9" fill="#ebdca1" />
          <rect
            x="417"
            y="211"
            width="200"
            height="107"
            transform="rotate(-3 417 211)"
            fill="#d4c59e"
            stroke="#a49670"
            strokeWidth="3"
          />
          <text
            x="510"
            y="252"
            textAnchor="middle"
            fill="#66694e"
            fontFamily="serif"
            fontSize="25"
            letterSpacing="5"
          >
            旧物有期
          </text>
          <text
            x="510"
            y="289"
            textAnchor="middle"
            fill="#66694e"
            fontFamily="serif"
            fontSize="25"
            letterSpacing="5"
          >
            故事无价
          </text>
          <path
            d="M151 474h673l63 46H94Z"
            fill="#b59c73"
            stroke="#736b50"
            strokeWidth="4"
          />
          <path d="M105 521h769v146H105Z" fill="#a18861" />
          <path d="M119 535h744v20H119Z" fill="#897553" />
          <path
            d="M143 568h298v99H143m42-82h213v82m78-99h351v99m-312-81h270v81"
            stroke="#bca37a"
            strokeWidth="4"
            fill="none"
          />
          <g transform="translate(625 463)">
            <ellipse cx="0" cy="9" rx="31" ry="8" fill="#918969" />
            <path d="M-21-24h37v29q-20 15-36 0Z" fill="#ddd4ae" />
            <path
              d="M17-20q26-6 17 15l-18 4"
              stroke="#ddd4ae"
              strokeWidth="6"
              fill="none"
            />
            <path
              d="M-8-37q-12-13 0-29m12 29q-8-17 4-26"
              stroke="#eee6c9"
              strokeWidth="3"
              fill="none"
              opacity=".6"
            />
          </g>
          <path
            d="m170 470 70-5 36 21-77 5Z"
            fill="#ece1bf"
            stroke="#c6b58c"
            strokeWidth="2"
          />
          <path d="m201 466 9-37" stroke="#5a6751" strokeWidth="5" />
        </svg>
      </ArtSlot>
      <div className="scene-plaque">
        <span className="tiny-dot" />{" "}
        {collected ? "今日的故事，已经有了归处" : "风铃轻响，有位老朋友来了"}
      </div>
      {!collected && (
        <div className="kanshan">
          <Kanshan expression={expression} />
        </div>
      )}
      <button
        className={`scene-camera ${collected ? "on-shelf" : ""}`}
        disabled={!collected && busy}
        onClick={collected ? onCollection : onInspect}
        aria-label={collected ? "查看已寄展的相机" : "检查相机"}
      >
        <CameraArt />
        <span>
          {collected ? "已寄展 · 老式相机" : "轻触，看看这台相机"}{" "}
          <span aria-hidden="true">↗</span>
        </span>
      </button>
      <div className="scene-caption">
        <span>STORY No. 001</span>
        <span>
          {collected ? "一件旧物，留在了这里。" : "光阴慢一点，故事长一点。"}
        </span>
      </div>
    </div>
  );
}

export function MemoryArt({
  scene = "street",
  purpose = "story",
}: {
  scene?: "street" | "sunny";
  purpose?: "photo" | "story";
}) {
  return (
    <ArtSlot
      src={artAssets[purpose][scene]}
      alt={scene === "street" ? "老街" : "江边"}
    >
      <svg
        viewBox="0 0 800 500"
        role="img"
        aria-label={
          scene === "street"
            ? "老街书店的开发占位插图"
            : "晴天江边的开发占位插图"
        }
      >
        <rect
          width="800"
          height="500"
          fill={scene === "street" ? "#c2c6a9" : "#d9c799"}
        />
        <circle cx="600" cy="127" r="66" fill="#f5e6b5" />
        {scene === "street" ? (
          <>
            <path d="M0 374h800v126H0Z" fill="#aaa68a" />
            <path d="m0 500 291-127h306l203 127" fill="#c8b897" />
            <rect x="212" y="132" width="371" height="282" fill="#c3b38b" />
            <path d="m196 132 200-71 203 71Z" fill="#74826d" />
            <rect x="344" y="239" width="100" height="175" fill="#737e62" />
            <rect x="229" y="241" width="96" height="129" fill="#e1d29f" />
            <rect x="462" y="241" width="102" height="129" fill="#e1d29f" />
            <path
              d="M276 242v128m238-128v128M231 298h92m141 0h99"
              stroke="#a69970"
              strokeWidth="7"
            />
            <path d="M201 208h395l-16 33H217Z" fill="#87967b" />
            <text
              x="397"
              y="194"
              textAnchor="middle"
              fontFamily="serif"
              letterSpacing="10"
              fontSize="24"
              fill="#5b634d"
            >
              老街书店
            </text>
            <path
              d="M97 408 115 62m588 343L681 74"
              stroke="#6f785a"
              strokeWidth="18"
            />
            <g fill="#839571">
              <circle cx="100" cy="90" r="97" />
              <circle cx="176" cy="68" r="68" />
              <circle cx="687" cy="74" r="95" />
              <circle cx="765" cy="135" r="98" />
            </g>
          </>
        ) : (
          <>
            <path d="M0 259q110-90 240-23t240-15 320 36v70H0Z" fill="#a4ab86" />
            <path d="M0 299h800v201H0Z" fill="#abbcb0" />
            <path
              d="M0 328h800m-700 33h500m-450 22h580m-684 44h702"
              stroke="#e6d7ae"
              strokeWidth="4"
              opacity=".6"
            />
            <path d="M0 464q350-90 800-5v41H0Z" fill="#7b8c71" />
            <path
              d="M0 450h800m-719-40v77m106-88v78m450-74v75m107-73v91"
              stroke="#7a7e5f"
              strokeWidth="8"
            />
          </>
        )}
        <g transform="translate(353 313)">
          <path d="m12 43-11 71h47l-8-71Z" fill="#ece7cf" />
          <circle cx="26" cy="29" r="20" fill="#c8a382" />
          <path d="M5 28q-4-28 24-25 25 2 20 27L39 17 7 21Z" fill="#5a5b49" />
          <path d="M6 19q-26-7-26 21l23-5" fill="#5a5b49" />
          <path d="m15 115-4 43m25-43 5 43" stroke="#6e7665" strokeWidth="10" />
        </g>
      </svg>
    </ArtSlot>
  );
}
