import "./globals.css";

export const metadata = {
  title: "Gemma · TAAP",
  description: "Preview sperimentale dell'assistente conversazionale Gemma",
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
