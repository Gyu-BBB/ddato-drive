export const folderColorOptions = [
  { id: "yellow", label: "노란색", body: "#f4c84f", tab: "#f8dd7a", stroke: "#c69324" },
  { id: "blue", label: "파란색", body: "#5aa9f8", tab: "#91cdfb", stroke: "#2f76bd" },
  { id: "green", label: "초록색", body: "#5fc779", tab: "#91e0a5", stroke: "#328e4a" },
  { id: "pink", label: "분홍색", body: "#f28ab4", tab: "#f7b0cd", stroke: "#bd5e87" },
  { id: "purple", label: "보라색", body: "#a78bfa", tab: "#c6b6fd", stroke: "#7656c9" },
  { id: "orange", label: "주황색", body: "#f4a044", tab: "#f8c071", stroke: "#bd6f1f" },
  { id: "gray", label: "회색", body: "#aab2bd", tab: "#c8ced6", stroke: "#727b87" }
];

export function folderColorValue(color) {
  return folderColorOptions.find((option) => option.id === color) || folderColorOptions[0];
}

export function FolderGlyph({ color = "yellow", size = 20 }) {
  const palette = folderColorValue(color);

  return (
    <svg className="folder-glyph" width={size} height={size} viewBox="0 0 64 52" aria-hidden="true" focusable="false">
      <path
        d="M4 13.5C4 9.9 6.9 7 10.5 7h14.1c2.2 0 4.2 1.1 5.4 2.9l2.1 3.1h21.4c3.6 0 6.5 2.9 6.5 6.5v2.9H4v-8.9Z"
        fill={palette.tab}
        stroke={palette.stroke}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M3.4 20.3c.4-3.2 3.2-5.6 6.4-5.6h44.4c3.2 0 5.9 2.4 6.4 5.6L63 39.5C63.6 44 60.1 48 55.6 48H8.4C3.9 48 .4 44 1 39.5l2.4-19.2Z"
        fill={palette.body}
        stroke={palette.stroke}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M8 22.5h48" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
