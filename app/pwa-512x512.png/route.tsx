import {ImageResponse} from "next/og";

export function GET() {
  const size = {
    width: 512,
    height: 512
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
            inset: 42,
            borderRadius: 84,
            background: "#dce5dd"
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 56,
            borderRadius: 74,
            background: "linear-gradient(180deg, #fffefb 0%, #f4f1e8 100%)",
            border: "4px solid rgba(80, 96, 111, 0.18)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 146,
            top: 88,
            width: 24,
            height: 336,
            borderRadius: 999,
            background: "rgba(213, 111, 60, 0.5)"
          }}
        />
        {[184, 256, 328].map((top) => (
          <div
            key={top}
            style={{
              position: "absolute",
              left: 96,
              right: 96,
              top,
              height: 10,
              borderRadius: 999,
              background: "#a6c5df"
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 196,
            top: 186,
            color: "#1f2d3d",
            fontSize: 150,
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
