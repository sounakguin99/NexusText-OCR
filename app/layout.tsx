import './globals.css';
import type { Metadata, Viewport } from 'next';

const BASE_URL = 'https://nexustext-ocr.vercel.app'; // ← update to your real domain

export const viewport: Viewport = {
  themeColor: '#3b82f6',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),

  // ── Core ──────────────────────────────────────────────────────────────────
  title: {
    default: 'NexusText OCR — Bulk Image to Data Extraction Tool',
    template: '%s | NexusText OCR',
  },
  description:
    'Free online OCR tool that extracts text, emails, phone numbers, company names and job data from 500+ images at once. Detects duplicates and exports results to Excel — all in your browser, no upload needed.',

  // ── Keywords ──────────────────────────────────────────────────────────────
  keywords: [
    'OCR tool', 'bulk image text extraction', 'image to text online',
    'Tesseract OCR', 'extract email from image', 'extract phone from image',
    'job data extraction', 'bulk OCR', 'image to Excel', 'duplicate detector',
    'LinkedIn post OCR', 'free OCR', 'no upload OCR', 'browser OCR',
    'image to spreadsheet', 'NexusText',
  ],

  // ── Authorship ────────────────────────────────────────────────────────────
  authors: [{ name: 'NexusText Team' }],
  creator: 'NexusText Team',
  publisher: 'NexusText',

  // ── Canonical + Alternate ─────────────────────────────────────────────────
  alternates: {
    canonical: '/',
  },

  // ── Open Graph ────────────────────────────────────────────────────────────
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'NexusText OCR',
    title: 'NexusText OCR — Bulk Image to Data Extraction Tool',
    description:
      'Extract text, emails, phone numbers and job data from 500+ images in seconds. Free, browser-based, no uploads required. Detects duplicates and exports to Excel.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'NexusText OCR – Bulk Image Data Extraction',
      },
    ],
    locale: 'en_US',
  },

  // ── Twitter Card ──────────────────────────────────────────────────────────
  twitter: {
    card: 'summary_large_image',
    site: '@nexustextocr',
    creator: '@nexustextocr',
    title: 'NexusText OCR — Bulk Image to Data Extraction Tool',
    description:
      'Extract text, emails, phone numbers and job data from 500+ images in seconds. Free, browser-based OCR with duplicate detection and Excel export.',
    images: ['/og-image.png'],
  },

  // ── Robots ────────────────────────────────────────────────────────────────
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },

  // ── App / PWA hints ───────────────────────────────────────────────────────
  applicationName: 'NexusText OCR',
  category: 'productivity',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Structured Data — WebApplication schema */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'NexusText OCR',
              url: BASE_URL,
              description:
                'Free browser-based OCR tool that bulk-extracts text, emails, phone numbers, and job data from images. Detects duplicates and exports to Excel.',
              applicationCategory: 'ProductivityApplication',
              operatingSystem: 'Any',
              browserRequirements: 'Requires JavaScript',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
              featureList: [
                'Bulk image text extraction (500+ images)',
                'Concurrent OCR processing (5 workers)',
                'Email, phone, and company detection',
                'Duplicate entry detection',
                'Excel export with highlighted duplicates',
                'No file upload — runs entirely in browser',
              ],
              screenshot: `${BASE_URL}/og-image.png`,
            }),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
