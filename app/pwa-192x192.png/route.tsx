import {ImageResponse} from "next/og";

export function GET() {
  const size = {
    width: 192,
    height: 192
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #fffefb 0%, #f4f1e8 100%)",
          position: "relative",
          fontFamily: "Trebuchet MS, Segoe UI, sans-serif"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 18,
            borderRadius: 34,
            background: "#dce5dd"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 24,
            borderRadius: 30,
            background: "linear-gradient(180deg, #fffefb 0%, #f4f1e8 100%)",
            border: "2px solid rgba(80, 96, 111, 0.18)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 54,
            top: 34,
            width: 10,
            height: 124,
            borderRadius: 999,
            background: "rgba(213, 111, 60, 0.5)"
          }}
        />
        {[70, 98, 126].map((top) => (
          <div
            key={top}
            style={{
              position: "absolute",
              left: 36,
              right: 36,
              top,
              height: 4,
              borderRadius: 999,
              background: "#a6c5df"
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 72,
            top: 72,
            color: "#1f2d3d",
            fontSize: 54,
            fontWeight: 700
          }}
        >
          Dy
        </div>
      </div>
    ),
    {
      ...size
    }
  );
}
