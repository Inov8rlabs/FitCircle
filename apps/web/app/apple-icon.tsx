import { ImageResponse } from 'next/og';

// Image metadata
export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

// Image generation
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
        }}
      >
        <div
          style={{
            color: 'white',
            fontSize: 100,
            fontWeight: 800,
            fontFamily: 'Inter, sans-serif',
            display: 'flex',
            letterSpacing: '-0.05em',
          }}
        >
          f
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
