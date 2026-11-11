import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Audio → MIDI · Client-Side Transcription',
  description:
    'Convert sung melodies and instrument recordings into editable MIDI entirely in your browser. Private, fast, zero server upload.',
};

export const viewport: Viewport = {
  themeColor: '#08090c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#08090c] text-white antialiased">
        {children}
      </body>
    </html>
  );
}

